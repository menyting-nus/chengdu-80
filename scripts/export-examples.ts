import { mkdir, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { bundleSchema, capabilityContracts, protocols } from "../apps/web/src/lib/contracts";
import { protocolInstructions, sampleBundle } from "../apps/web/src/lib/samples";
import { z } from "zod";
const dir = fileURLToPath(new URL("../.local/examples", import.meta.url).href);
await mkdir(dir, { recursive: true });
for (const p of protocols) {
  const bundle = sampleBundle(p.defaultSpec);
  const appDir = join(dir, p.id);
  await rm(appDir, { recursive: true, force: true });
  await rm(join(dir, `${p.id}.cd80.json`), { force: true });
  await mkdir(appDir, { recursive: true });
  await writeFile(join(dir, `${p.id}.bundle.json`), JSON.stringify(bundle, null, 2) + "\n");
  for (const [name, content] of Object.entries(bundle.files)) {
    const filename = join(appDir, name);
    await mkdir(dirname(filename), { recursive: true });
    await writeFile(filename, content);
  }
  await writeFile(join(appDir, "protocol.txt"), protocolInstructions(p.defaultSpec));
}
await writeFile(
  join(dir, "source-bundle.schema.json"),
  JSON.stringify(z.toJSONSchema(bundleSchema), null, 2) + "\n",
);
await writeFile(
  join(dir, "capabilities.json"),
  JSON.stringify(capabilityContracts, null, 2) + "\n",
);
console.log(
  "Exported three working source examples, public schemas, and protocol instructions to .local/examples/.",
);
