import path from "node:path";
import ts from "typescript";

const packages = new Set([
  "react",
  "lucide-react",
  "zod",
  "@tanstack/react-query",
  "@cd80/sdk",
  "@cd80/components",
]);
const forbidden = new Set([
  "eval",
  "Function",
  "fetch",
  "WebSocket",
  "XMLHttpRequest",
  "Worker",
  "SharedWorker",
  "importScripts",
  "require",
  "process",
  "Bun",
  "Deno",
  "module",
  "__dirname",
  "__filename",
]);

export function isGeneratedSource(name) {
  return (
    name === "src/App.tsx" ||
    /^src\/components\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+\.tsx?$/.test(name)
  );
}

export function resolveGeneratedImport(from, specifier, files) {
  if (!specifier.startsWith(".")) return undefined;
  const target = path.posix.normalize(path.posix.join(path.posix.dirname(from), specifier));
  return [
    target,
    `${target}.tsx`,
    `${target}.ts`,
    `${target}/index.tsx`,
    `${target}/index.ts`,
  ].find((name) => isGeneratedSource(name) && Object.hasOwn(files, name));
}

// Only browser source and explicit starter modules enter the fixed build graph.
// This is a build policy, not an OS sandbox or a browser security boundary.
export function inspectSources(files) {
  const issues = [];
  for (const [name, content] of Object.entries(files)) {
    if (!isGeneratedSource(name)) continue;
    const source = ts.createSourceFile(
      name,
      content,
      ts.ScriptTarget.Latest,
      true,
      name.endsWith("tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );
    if (
      source.referencedFiles.length ||
      source.typeReferenceDirectives.length ||
      source.libReferenceDirectives.length ||
      source.hasNoDefaultLib
    )
      issues.push(`${name}: triple-slash compiler directives are unsupported`);
    const visit = (node) => {
      if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
        if (node.attributes) issues.push(`${name}: import attributes and macros are unsupported`);
        if (node.moduleSpecifier) {
          const specifier = ts.isStringLiteral(node.moduleSpecifier)
            ? node.moduleSpecifier.text
            : "";
          const allowedUi = /^@\/components\/ui\/[a-z0-9-]+$/.test(specifier);
          if (
            !packages.has(specifier) &&
            !allowedUi &&
            specifier !== "@/lib/utils" &&
            !resolveGeneratedImport(name, specifier, files)
          )
            issues.push(`${name}: unsupported import ${JSON.stringify(specifier)}`);
        }
      }
      if (
        ts.isImportEqualsDeclaration(node) ||
        ts.isImportTypeNode(node) ||
        (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword)
      )
        issues.push(`${name}: dynamic imports and import assignments are unsupported`);
      if (ts.isMetaProperty(node)) issues.push(`${name}: import.meta is unsupported`);
      if (ts.isIdentifier(node) && forbidden.has(node.text))
        issues.push(`${name}: ${node.text} is unavailable; use the typed platform SDK`);
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return [...new Set(issues)].slice(0, 12);
}
