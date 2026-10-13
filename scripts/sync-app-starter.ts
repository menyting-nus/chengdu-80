import { regenerateAppProjectTemplate } from "../apps/web/src/lib/app-starter";
const files = await regenerateAppProjectTemplate();
console.log(`Synced ${Object.keys(files).length} actual starter files for Convex app creation.`);
