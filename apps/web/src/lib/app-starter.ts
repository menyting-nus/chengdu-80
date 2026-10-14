import { access, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

async function webRoot() {
  for (const root of [process.cwd(), path.resolve(process.cwd(), "apps/web")]) {
    try {
      await access(path.join(root, "starter/project/package.json"));
      return root;
    } catch {
      // The platform starts from the monorepo root in development and apps/web in Docker.
    }
  }
  throw new Error("The app project template is missing from this installation");
}

// Read the actual starter project, preserving paths shown to the agent and user.
export async function collectAppProjectTemplate(): Promise<Record<string, string>> {
  const directory = path.join(await webRoot(), "starter/project");
  const files: Record<string, string> = {};
  async function visit(relative: string) {
    const entries = (await readdir(path.join(directory, relative), { withFileTypes: true })).sort(
      (left, right) => left.name.localeCompare(right.name),
    );
    for (const entry of entries) {
      if (
        ["node_modules", "dist", ".output", ".tanstack", ".git"].includes(entry.name) ||
        entry.name.startsWith(".env")
      )
        continue;
      const filename = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await visit(filename);
      else if (entry.isFile())
        files[filename] = await readFile(path.join(directory, filename), "utf8");
      else throw new Error(`Unsupported app project template entry: ${filename}`);
    }
  }
  await visit("");
  return files;
}

// Convex cannot read the Node filesystem. Regenerate its exact file map when
// changing the checked-in project template; creation never generates UI facsimiles.
export async function regenerateAppProjectTemplate() {
  const files = await collectAppProjectTemplate();
  const source = `// Generated from apps/web/starter/project by regenerateAppProjectTemplate().\n// Edit the project files, then regenerate this map.\nexport const appProjectTemplateFiles = ${JSON.stringify(files, null, 2)} as const;\n`;
  await writeFile(path.join(await webRoot(), "src/lib/app-project-template.ts"), source);
  return files;
}
