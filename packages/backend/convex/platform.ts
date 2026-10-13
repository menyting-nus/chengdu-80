import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import {
  action,
  internalMutation,
  internalQuery,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { internal } from "./_generated/api";
import type { Application } from "../../../apps/web/src/lib/contracts";

type Messages = NonNullable<Application["conversation"]>;
type ThreadMetadata = Pick<Application, "turns" | "agentTurn">;

function appSize(app: Application) {
  const { conversation: _conversation, ...payload } = app;
  return JSON.stringify(payload).length;
}

async function threadFor(ctx: QueryCtx, threadId: string) {
  return ctx.db
    .query("threads")
    .withIndex("by_thread", (q) => q.eq("threadId", threadId))
    .unique();
}

async function withThread(ctx: QueryCtx, payload: Application): Promise<Application> {
  const thread = await threadFor(ctx, payload.id);
  return thread
    ? { ...payload, chatTitle: thread.title, ...(JSON.parse(thread.metadata) as ThreadMetadata) }
    : payload;
}

async function storeThread(ctx: MutationCtx, app: Application, ownerId: string) {
  const existing = await threadFor(ctx, app.id);
  if (existing && existing.ownerId !== ownerId) throw new Error("Access denied");
  const previous: ThreadMetadata = existing ? JSON.parse(existing.metadata) : {};
  const title = app.chatTitle ?? existing?.title ?? app.name;
  const metadata = JSON.stringify({
    turns: app.turns ?? previous.turns,
    agentTurn: app.agentTurn ?? previous.agentTurn,
  });
  if (!existing)
    await ctx.db.insert("threads", {
      threadId: app.id,
      appId: app.id,
      ownerId,
      title,
      metadata,
      updatedAt: Date.now(),
    });
  else if (existing.title !== title || existing.metadata !== metadata)
    await ctx.db.patch(existing._id, { title, metadata, updatedAt: Date.now() });
}

async function readMessages(ctx: QueryCtx, threadId: string): Promise<Messages> {
  const rows = await ctx.db
    .query("messages")
    .withIndex("by_thread_order", (q) => q.eq("threadId", threadId))
    .collect();
  return rows.map((row) => JSON.parse(row.payload) as Messages[number]);
}

async function hydrateApp(ctx: QueryCtx, payload: Application): Promise<Application> {
  // Legacy history remains readable until the explicit migration has completed.
  return {
    ...(await withThread(ctx, payload)),
    conversation: payload.conversation ?? (await readMessages(ctx, payload.id)),
  };
}

async function storeMessages(ctx: MutationCtx, threadId: string, messages: Messages) {
  const rows = await ctx.db
    .query("messages")
    .withIndex("by_thread_order", (q) => q.eq("threadId", threadId))
    .collect();
  const existing = new Map(rows.map((row) => [row.messageId, row]));
  const seen = new Set<string>();
  for (const [order, message] of messages.entries()) {
    if (!message.id || seen.has(message.id)) throw new Error("Invalid conversation message IDs");
    seen.add(message.id);
    const payload = JSON.stringify(message);
    if (payload.length > 700000) throw new Error("Conversation message is too large");
    const row = existing.get(message.id);
    if (!row) await ctx.db.insert("messages", { threadId, messageId: message.id, order, payload });
    else if (row.payload !== payload || row.order !== order)
      await ctx.db.patch(row._id, { order, payload });
  }
  // An explicitly shortened authoritative transcript removes its old rows atomically.
  for (const row of rows) if (!seen.has(row.messageId)) await ctx.db.delete(row._id);
}

async function studioOwner(ctx: QueryCtx) {
  const identity = await ctx.auth.getUserIdentity();
  if (identity) return identity.subject;
  if (process.env.CD80_DEMO_MODE === "1") return demoOwnerId;
  throw new Error("Authentication required");
}

// Public subscriptions only expose the current account or the explicitly shared demo workspace.
export const studioThreads = query({
  args: {},
  handler: async (ctx): Promise<{ id: string; name: string; chatTitle: string }[]> => {
    const ownerId = await studioOwner(ctx);
    const rows = await ctx.db
      .query("threads")
      .withIndex("by_owner", (q) => q.eq("ownerId", ownerId))
      .collect();
    return rows.map((row) => ({ id: row.threadId, name: row.title, chatTitle: row.title }));
  },
});

export const studioApp = query({
  args: { appId: v.string() },
  handler: async (ctx, { appId }): Promise<Application | null> => {
    const ownerId = await studioOwner(ctx);
    const row = await ctx.db
      .query("apps")
      .withIndex("by_app", (q) => q.eq("appId", appId))
      .unique();
    if (!row || row.ownerId !== ownerId) return null;
    const { conversation: _conversation, ...app } = row.payload as Application;
    return withThread(ctx, app);
  },
});

export const studioApps = query({
  args: {},
  handler: async (ctx): Promise<Application[]> => {
    const ownerId = await studioOwner(ctx);
    const rows = await ctx.db
      .query("apps")
      .withIndex("by_owner", (q) => q.eq("ownerId", ownerId))
      .collect();
    return Promise.all(
      rows.map(async (row) => {
        const { conversation: _conversation, ...app } = row.payload as Application;
        return withThread(ctx, app);
      }),
    );
  },
});

export const studioMessages = query({
  args: { appId: v.string() },
  handler: async (ctx, { appId }): Promise<Messages> => {
    const ownerId = await studioOwner(ctx);
    const row = await ctx.db
      .query("apps")
      .withIndex("by_app", (q) => q.eq("appId", appId))
      .unique();
    if (!row || row.ownerId !== ownerId) throw new Error("Application not found");
    return (row.payload as Application).conversation ?? readMessages(ctx, appId);
  },
});

export const list = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Authentication required");
    const rows = await ctx.db
      .query("apps")
      .withIndex("by_owner", (q) => q.eq("ownerId", identity.subject))
      .collect();
    return Promise.all(rows.map((r) => hydrateApp(ctx, r.payload as Application)));
  },
});
export const get = query({
  args: { appId: v.string() },
  handler: async (ctx, { appId }): Promise<Application | null> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Authentication required");
    const row = await ctx.db
      .query("apps")
      .withIndex("by_app", (q) => q.eq("appId", appId))
      .unique();
    if (!row || row.ownerId !== identity.subject) return null;
    return hydrateApp(ctx, row.payload as Application);
  },
});
export const save = action({
  args: { app: v.any(), expectedRevision: v.union(v.number(), v.null()), serverKey: v.string() },
  handler: async (ctx, args): Promise<any> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Authentication required");
    const expected = process.env.PLATFORM_INTERNAL_KEY;
    if (!expected || expected.length < 32 || args.serverKey !== expected)
      throw new Error("Trusted platform server required");
    if (args.app.ownerId !== identity.subject || appSize(args.app as Application) > 700000)
      throw new Error("Invalid app ownership or size");
    return ctx.runMutation(internal.platform.commit, {
      app: args.app,
      expectedRevision: args.expectedRevision,
      ownerId: identity.subject,
    });
  },
});
export const commit = internalMutation({
  args: { app: v.any(), expectedRevision: v.union(v.number(), v.null()), ownerId: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("apps")
      .withIndex("by_app", (q) => q.eq("appId", args.app.id))
      .unique();
    if (row && row.ownerId !== args.ownerId) throw new Error("Access denied");
    if (args.expectedRevision === null ? row : !row || row.revision !== args.expectedRevision)
      throw new Error("Application changed. Refresh and try again.");
    const revision = (args.expectedRevision ?? 0) + 1;
    const {
      conversation,
      chatTitle: _chatTitle,
      turns: _turns,
      agentTurn: _agentTurn,
      ...app
    } = args.app as Application;
    const payload = { ...app, revision };
    // Metadata-only saves preserve history; supplied history is the authoritative transcript.
    const messages = conversation ?? (row?.payload as Application | undefined)?.conversation;
    if (messages) await storeMessages(ctx, payload.id, messages);
    await storeThread(ctx, args.app as Application, args.ownerId);
    if (row) await ctx.db.patch(row._id, { payload, revision });
    else
      await ctx.db.insert("apps", { appId: payload.id, ownerId: args.ownerId, revision, payload });
    return hydrateApp(ctx, payload);
  },
});

// Only the platform server can access the explicitly enabled shared demo workspace.
const demoOwnerId = "shared-prototype-owner";
function requireDemo(serverKey: string) {
  const expected = process.env.PLATFORM_INTERNAL_KEY;
  if (process.env.CD80_DEMO_MODE !== "1") throw new Error("Shared demo mode is disabled");
  if (!expected || expected.length < 32 || serverKey !== expected)
    throw new Error("Trusted platform server required");
}
export const listDemo = action({
  args: { serverKey: v.string() },
  handler: async (ctx, args): Promise<any> => {
    requireDemo(args.serverKey);
    return ctx.runQuery(internal.platform.demoRows, {});
  },
});
export const demoRows = internalQuery({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db
      .query("apps")
      .withIndex("by_owner", (q) => q.eq("ownerId", demoOwnerId))
      .collect();
    return Promise.all(rows.map((r) => hydrateApp(ctx, r.payload as Application)));
  },
});
export const getDemo = action({
  args: { appId: v.string(), serverKey: v.string() },
  handler: async (ctx, args): Promise<Application | null> => {
    requireDemo(args.serverKey);
    return ctx.runQuery(internal.platform.demoApp, { appId: args.appId });
  },
});
export const demoApp = internalQuery({
  args: { appId: v.string() },
  handler: async (ctx, { appId }): Promise<Application | null> => {
    const row = await ctx.db
      .query("apps")
      .withIndex("by_app", (q) => q.eq("appId", appId))
      .unique();
    if (!row || row.ownerId !== demoOwnerId) return null;
    return hydrateApp(ctx, row.payload as Application);
  },
});
export const saveDemo = action({
  args: { app: v.any(), expectedRevision: v.union(v.number(), v.null()), serverKey: v.string() },
  handler: async (ctx, args): Promise<any> => {
    requireDemo(args.serverKey);
    if (args.app.ownerId !== demoOwnerId || appSize(args.app as Application) > 700000)
      throw new Error("Invalid demo ownership or size");
    return ctx.runMutation(internal.platform.commit, {
      app: args.app,
      expectedRevision: args.expectedRevision,
      ownerId: demoOwnerId,
    });
  },
});

// Explicit local-demo migration. Every batch atomically stores chat rows before stripping legacy fields.
export const migrateChatStorage = action({
  args: { serverKey: v.string() },
  handler: async (ctx, args): Promise<{ apps: number; messages: number; threads: number }> => {
    requireDemo(args.serverKey);
    let cursor: string | null = null;
    const counts = { apps: 0, messages: 0, threads: 0 };
    let done = false;
    while (!done) {
      const batch: {
        apps: number;
        messages: number;
        threads: number;
        cursor: string;
        done: boolean;
      } = await ctx.runMutation(internal.platform.migrateChatBatch, {
        paginationOpts: { cursor, numItems: 5 },
      });
      counts.apps += batch.apps;
      counts.messages += batch.messages;
      counts.threads += batch.threads;
      cursor = batch.cursor;
      done = batch.done;
    }
    return counts;
  },
});

export const migrateChatBatch = internalMutation({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, { paginationOpts }) => {
    const page = await ctx.db
      .query("apps")
      .withIndex("by_owner", (q) => q.eq("ownerId", demoOwnerId))
      .paginate(paginationOpts);
    let apps = 0;
    let messages = 0;
    let threads = 0;
    for (const row of page.page) {
      const legacy = row.payload as Application;
      if (!(await threadFor(ctx, row.appId))) {
        await storeThread(ctx, legacy, row.ownerId);
        threads++;
      }
      if (!["conversation", "chatTitle", "turns", "agentTurn"].some((key) => key in legacy))
        continue;
      for (const [order, message] of (legacy.conversation ?? []).entries()) {
        const existing = await ctx.db
          .query("messages")
          .withIndex("by_thread_message", (q) =>
            q.eq("threadId", row.appId).eq("messageId", message.id),
          )
          .unique();
        // A retried migration never overwrites an already normalized message.
        if (!existing) {
          await ctx.db.insert("messages", {
            threadId: row.appId,
            messageId: message.id,
            order,
            payload: JSON.stringify(message),
          });
          messages++;
        }
      }
      const {
        conversation: _conversation,
        chatTitle: _chatTitle,
        turns: _turns,
        agentTurn: _agentTurn,
        ...payload
      } = legacy;
      await ctx.db.patch(row._id, { payload });
      apps++;
    }
    return { apps, messages, threads, cursor: page.continueCursor, done: page.isDone };
  },
});

// Registry writes are system actions, never model tools. Payloads contain credential names only.
export const plugins = action({
  args: { serverKey: v.string(), demo: v.boolean(), payload: v.optional(v.string()) },
  handler: async (ctx, args): Promise<string[]> => {
    const expected = process.env.PLATFORM_INTERNAL_KEY;
    if (!expected || expected.length < 32 || args.serverKey !== expected)
      throw new Error("Trusted platform server required");
    let ownerId: string;
    if (args.demo) {
      requireDemo(args.serverKey);
      ownerId = demoOwnerId;
    } else {
      const identity = await ctx.auth.getUserIdentity();
      if (!identity) throw new Error("Authentication required");
      ownerId = identity.subject;
    }
    if (args.payload) {
      if (args.payload.length > 300000) throw new Error("Plugin is too large");
      const payload: unknown = JSON.parse(args.payload);
      if (
        !payload ||
        typeof payload !== "object" ||
        !("ownerId" in payload) ||
        payload.ownerId !== ownerId ||
        !("id" in payload) ||
        typeof payload.id !== "string"
      )
        throw new Error("Invalid plugin ownership");
      await ctx.runMutation(internal.platform.commitPlugin, {
        ownerId,
        pluginId: payload.id,
        payload: args.payload,
      });
    }
    return ctx.runQuery(internal.platform.pluginRows, { ownerId });
  },
});
export const pluginRows = internalQuery({
  args: { ownerId: v.string() },
  handler: async (ctx, { ownerId }) => {
    const rows = await ctx.db
      .query("plugins")
      .withIndex("by_owner", (q) => q.eq("ownerId", ownerId))
      .collect();
    return rows.map((row) => row.payload);
  },
});
export const commitPlugin = internalMutation({
  args: { ownerId: v.string(), pluginId: v.string(), payload: v.string() },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("plugins")
      .withIndex("by_plugin", (q) => q.eq("pluginId", args.pluginId))
      .unique();
    if (existing) throw new Error("Plugin already exists");
    await ctx.db.insert("plugins", args);
  },
});
