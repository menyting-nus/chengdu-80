import { ConvexHttpClient } from "convex/browser";
import { api } from "@web-starter/backend/convex/_generated/api";
import type { Application } from "../lib/contracts";
import { demoMode, demoOwnerId, localMode, settings } from "./settings";

let queue: Promise<unknown> = Promise.resolve();
export type Access = { ownerId: string; accessToken: string | null };
async function client(access: Access) {
  const config = await settings();
  const demo = await demoMode();
  if (demo && access.ownerId !== demoOwnerId) throw new Error("Invalid demo workspace");
  if (!config.VITE_CONVEX_URL || (!access.accessToken && !(demo && access.ownerId === demoOwnerId)))
    throw new Error("Hosted database and an authenticated or explicit demo session are required");
  const c = new ConvexHttpClient(config.VITE_CONVEX_URL);
  if (access.accessToken) c.setAuth(access.accessToken);
  return c;
}
async function localStore<T>(
  fn: (apps: Application[]) => Promise<T> | T,
  write = false,
): Promise<T> {
  const task = queue.then(async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const dir = (await settings()).CD80_DATA_DIR ?? path.resolve(process.cwd(), "../../.local");
    await fs.mkdir(dir, { recursive: true, mode: 0o700 });
    const file = path.join(dir, "apps.json");
    let apps: Application[] = [];
    try {
      apps = JSON.parse(await fs.readFile(file, "utf8"));
    } catch (e) {
      if ((e as any).code !== "ENOENT") throw e;
    }
    const result = await fn(apps);
    if (write) {
      const temp = file + ".tmp";
      await fs.writeFile(temp, JSON.stringify(apps), { mode: 0o600 });
      await fs.rename(temp, file);
    }
    return result;
  });
  queue = task.catch(() => {});
  return task;
}
export async function listApps(access: Access): Promise<Application[]> {
  if (await localMode())
    return localStore((apps) => apps.filter((a) => a.ownerId === access.ownerId));
  const c = await client(access);
  if (await demoMode()) {
    const config = await settings();
    if (!config.PLATFORM_INTERNAL_KEY) throw new Error("PLATFORM_INTERNAL_KEY is missing");
    return c.action(api.platform.listDemo, { serverKey: config.PLATFORM_INTERNAL_KEY });
  }
  return c.query(api.platform.list, {});
}
export async function findApp(access: Access, id: string): Promise<Application> {
  const app = (await listApps(access)).find((a) => a.id === id);
  if (!app) throw new Error("Application not found or access denied");
  return app;
}
export async function saveApp(access: Access, app: Application, expectedRevision: number | null) {
  if (app.ownerId !== access.ownerId) throw new Error("Account ownership mismatch");
  if (JSON.stringify(app).length > 700000)
    throw new Error("Application exceeds prototype storage limit");
  if (await localMode())
    return localStore((apps) => {
      const i = apps.findIndex((a) => a.id === app.id);
      if (i >= 0 && apps[i].ownerId !== access.ownerId) throw new Error("Access denied");
      if (expectedRevision === null ? i >= 0 : i < 0 || apps[i].revision !== expectedRevision)
        throw new Error("Application changed during this operation. Refresh and try again.");
      app.revision = (expectedRevision ?? 0) + 1;
      if (i >= 0) apps[i] = app;
      else apps.push(app);
      return app;
    }, true);
  const config = await settings();
  if (!config.PLATFORM_INTERNAL_KEY)
    throw new Error("PLATFORM_INTERNAL_KEY is missing from hosted configuration");
  // TanStack AI uses Date instances for message timestamps. Match the JSON
  // persistence contract before passing values to Convex's stricter serializer.
  const persistedApp: Application = JSON.parse(JSON.stringify(app));
  return (await client(access)).action(
    (await demoMode()) ? api.platform.saveDemo : api.platform.save,
    {
      app: persistedApp,
      expectedRevision,
      serverKey: config.PLATFORM_INTERNAL_KEY,
    },
  );
}
export function event(app: Application, message: string) {
  app.events = [{ at: new Date().toISOString(), message }, ...app.events].slice(0, 50);
}

// Retry field merges after another writer (title, tools, or app data) advances the revision.
export async function mutateApp(
  access: Access,
  id: string,
  change: (app: Application) => void | Promise<void>,
) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const app = await findApp(access, id);
    await change(app);
    try {
      return await saveApp(access, app, app.revision);
    } catch (error) {
      if (
        !(error instanceof Error) ||
        !error.message.includes("Application changed") ||
        attempt === 4
      )
        throw error;
    }
  }
  throw new Error("Application changed during this operation.");
}
