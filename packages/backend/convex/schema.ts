import { defineSchema } from "convex/server";
import { defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  apps: defineTable({
    appId: v.string(),
    ownerId: v.string(),
    revision: v.number(),
    payload: v.any(),
  })
    .index("by_owner", ["ownerId"])
    .index("by_app", ["appId"]),
  threads: defineTable({
    threadId: v.string(),
    appId: v.string(),
    ownerId: v.string(),
    title: v.string(),
    metadata: v.string(),
    updatedAt: v.number(),
  })
    .index("by_owner", ["ownerId"])
    .index("by_thread", ["threadId"]),
  messages: defineTable({
    threadId: v.string(),
    messageId: v.string(),
    order: v.number(),
    // TanStack message parts evolve independently; JSON keeps their wire representation intact.
    payload: v.string(),
  })
    .index("by_thread_order", ["threadId", "order"])
    .index("by_thread_message", ["threadId", "messageId"]),
  plugins: defineTable({
    pluginId: v.string(),
    ownerId: v.string(),
    payload: v.string(),
  })
    .index("by_owner", ["ownerId"])
    .index("by_plugin", ["pluginId"]),
  users: defineTable({
    authSubject: v.string(),
    email: v.optional(v.string()),
    name: v.optional(v.string()),
    organizationId: v.optional(v.string()),
    role: v.optional(v.string()),
    lastSeenAt: v.number(),
  })
    .index("by_auth_subject", ["authSubject"])
    .index("by_email", ["email"]),
});
