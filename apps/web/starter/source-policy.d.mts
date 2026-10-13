export function isGeneratedSource(name: string): boolean;
export function resolveGeneratedImport(
  from: string,
  specifier: string,
  files: Record<string, string>,
): string | undefined;
export function inspectSources(files: Record<string, string>): string[];
