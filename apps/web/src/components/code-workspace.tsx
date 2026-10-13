import {
  FileCssIcon,
  FileHtmlIcon,
  FileJsIcon,
  FileIcon,
  FoldersIcon,
  FolderIcon,
  FileTsIcon,
  FileTsxIcon,
} from "@phosphor-icons/react";
import {
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
} from "@web-starter/ui/components/sidebar";
import { Separator } from "@web-starter/ui/components/separator";
import type { AppBundle } from "../lib/contracts";
import { SourceViewer } from "./source-viewer";

export type SourcePath = string;

function fileIcon(path: string) {
  if (path.endsWith(".tsx")) return FileTsxIcon;
  if (path.endsWith(".ts")) return FileTsIcon;
  if (path.endsWith(".js")) return FileJsIcon;
  if (path.endsWith(".html")) return FileHtmlIcon;
  if (path.endsWith(".css")) return FileCssIcon;
  return FileIcon;
}

type FileTree = { files: string[]; folders: Map<string, FileTree> };

function sourceTree(paths: string[]) {
  const root: FileTree = { files: [], folders: new Map() };
  for (const path of paths) {
    const segments = path.split("/");
    let node = root;
    for (const segment of segments.slice(0, -1)) {
      if (!node.folders.has(segment)) node.folders.set(segment, { files: [], folders: new Map() });
      const child = node.folders.get(segment);
      if (child) node = child;
    }
    node.files.push(path);
  }
  return root;
}

function FileEntries({
  tree,
  selected,
  onSelect,
}: {
  tree: FileTree;
  selected: string;
  onSelect: (path: string) => void;
}) {
  return (
    <>
      {[...tree.folders].map(([name, children]) => (
        <SidebarMenuItem key={name}>
          <details open>
            <SidebarMenuButton render={<summary />}>
              <FolderIcon />
              <span>{name}</span>
            </SidebarMenuButton>
            <div className="pl-3">
              <SidebarMenu>
                <FileEntries tree={children} selected={selected} onSelect={onSelect} />
              </SidebarMenu>
            </div>
          </details>
        </SidebarMenuItem>
      ))}
      {tree.files.map((path) => {
        const Icon = fileIcon(path);
        return (
          <SidebarMenuItem key={path}>
            <SidebarMenuButton
              isActive={selected === path}
              aria-current={selected === path ? "page" : undefined}
              onClick={() => onSelect(path)}
              title={path}
            >
              <Icon />
              <span>{path.split("/").at(-1)}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        );
      })}
    </>
  );
}

// The explorer follows the actual source paths, including nested TSX components.
export function CodeWorkspace({
  bundle,
  workspaceId,
  activeFile,
  onSelectFile,
}: {
  bundle: AppBundle;
  workspaceId: string;
  activeFile: SourcePath;
  onSelectFile: (path: SourcePath) => void;
}) {
  const files: Record<string, string> = bundle.files;
  const selected =
    activeFile in files || activeFile === "cd80.json"
      ? activeFile
      : bundle.manifest.schemaVersion === 2
        ? "src/App.tsx"
        : "app.js";
  const content =
    selected === "cd80.json" ? JSON.stringify(bundle.manifest, null, 2) : (files[selected] ?? "");
  const tree = sourceTree([...Object.keys(files).sort(), "cd80.json"]);
  return (
    <section aria-label="Source workspace" className="flex min-h-0 min-w-0 flex-1">
      <aside aria-label="Source files" className="flex w-32 shrink-0 flex-col md:w-56">
        <div className="flex min-h-10 items-center gap-2 px-3 text-sm">
          <FoldersIcon className="size-4" />
          Files
        </div>
        <Separator />
        <div className="min-h-0 flex-1 overflow-y-auto py-1">
          <SidebarMenu aria-label="Application files">
            <FileEntries tree={tree} selected={selected} onSelect={onSelectFile} />
          </SidebarMenu>
        </div>
      </aside>
      <Separator orientation="vertical" />
      <SourceViewer path={`${workspaceId}/${selected}`} fileName={selected} content={content} />
    </section>
  );
}
