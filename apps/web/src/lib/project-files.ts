import { z } from "zod";

// Paths belong to a standalone application checkout. Runtime caches, installed
// dependencies and environment files are managed outside its persisted source.
export function isProjectFile(path: string) {
  if (path === ".gitignore") return true;
  if (path.length > 240 || path.startsWith("/") || path.includes("\\")) return false;
  const parts = path.split("/");
  if (
    parts.some(
      (part) =>
        !part ||
        part === "." ||
        part === ".." ||
        part.startsWith(".") ||
        ["node_modules", "dist", "build", "coverage"].includes(part),
    )
  )
    return false;
  return (
    /^[A-Za-z0-9_$@()[\].+/-]+$/.test(path) &&
    /\.(?:[cm]?[jt]sx?|json|css|md|svg|html|txt|lock)$/.test(path)
  );
}
export const projectFilePathSchema = z
  .string()
  .max(240)
  .refine(
    isProjectFile,
    "Use a relative application source path, excluding dependencies, build output and environment files.",
  );
