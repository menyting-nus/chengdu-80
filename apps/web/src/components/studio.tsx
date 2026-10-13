import { AgentChat } from "./agent-chat";
import { ConversationNavigation } from "./conversation-navigation";
import { PluginSettings } from "./plugin-settings";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "@tanstack/react-router";
import type { UIMessage } from "@tanstack/ai-react";
import { api as convexApi } from "@web-starter/backend/convex/_generated/api";
import { StudioSubscriptions } from "../lib/use-studio-data";
import {
  ArrowUpRight,
  Eye,
  Database,
  MoreHorizontal,
  Maximize,
  Minimize,
  Code2,
  RefreshCw,
  ShieldCheck,
  X,
} from "lucide-react";
import { Button, buttonVariants } from "@web-starter/ui/components/button";

import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
} from "@web-starter/ui/components/dropdown-menu";
import { cn } from "@web-starter/ui/lib/utils";
import { Alert, AlertAction, AlertTitle, AlertDescription } from "@web-starter/ui/components/alert";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@web-starter/ui/components/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@web-starter/ui/components/table";
import { SidebarProvider, SidebarTrigger } from "@web-starter/ui/components/sidebar";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@web-starter/ui/components/dialog";
import {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
  EmptyContent,
  EmptyMedia,
} from "@web-starter/ui/components/empty";
import { Separator } from "@web-starter/ui/components/separator";

import { api, download } from "../lib/client";
import {
  bundleSchema,
  protocolFor,
  type AppBundle,
  type Application,
  type ProductSpec,
  type Release,
} from "../lib/contracts";
import { CodeWorkspace, type SourcePath } from "./code-workspace";
import { AppFrame } from "./app-frame";

type Snapshot = {
  apps: Application[];
  status: {
    local: boolean;
    demo: boolean;
    model: string;
    modelConfigured: boolean;
    tushareConfigured: boolean;
    runtime: string;
  };
};
type Tab = "preview" | "source" | "data";
const workspaceTabs = [
  { value: "preview", label: "Preview", Icon: Eye },
  { value: "source", label: "Code", Icon: Code2 },
  { value: "data", label: "Database (read-only)", Icon: Database },
] as const;
export function Studio() {
  const convexClient = useRouter().options.context.convexClient;
  const convexConfigured = !!convexClient;
  const [subscribedThreads, setSubscribedThreads] =
    useState<Pick<Application, "id" | "name" | "chatTitle">[]>();
  const [subscribedApp, setSubscribedApp] = useState<{ appId: string; app: Application | null }>();
  const receiveApp = useCallback((appId: string, app: Application | null) => {
    setSubscribedApp({ appId, app });
  }, []);
  const [subscribedMessages, setSubscribedMessages] = useState<{
    appId: string;
    messages: UIMessage[];
  }>();
  const receiveMessages = useCallback((appId: string, messages: UIMessage[]) => {
    setSubscribedMessages({ appId, messages });
  }, []);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const reactive = convexConfigured && snapshot?.status.local !== true;
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [tab, setTab] = useState<Tab>("preview");
  const [activeSourceFile, setActiveSourceFile] = useState<SourcePath>("app.js");
  const [review, setReview] = useState<"checks" | "spec" | null>(null);
  const [imported, setImported] = useState<AppBundle | null>(null);
  const [providerResult, setProviderResult] = useState<unknown>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [chatKey, setChatKey] = useState("new");
  const [agentBusy, setAgentBusy] = useState(false);
  const [previewRevision, setPreviewRevision] = useState(0);
  const file = useRef<HTMLInputElement>(null);
  const workspace = useRef<HTMLElement>(null);
  const [fullscreen, setFullscreen] = useState(false);
  useEffect(() => {
    const syncFullscreen = () => setFullscreen(document.fullscreenElement === workspace.current);
    document.addEventListener("fullscreenchange", syncFullscreen);
    return () => document.removeEventListener("fullscreenchange", syncFullscreen);
  }, []);
  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await workspace.current?.requestFullscreen();
    } catch {
      setError("Fullscreen could not open.");
    }
  }
  const apps = subscribedThreads ?? snapshot?.apps ?? [];
  const fallbackApp = snapshot?.apps.find((a) => a.id === selected) ?? null;
  const selectedApp =
    reactive && subscribedApp?.appId === selected ? subscribedApp.app : fallbackApp;
  const messagesReady =
    !reactive || !selected || (!!selectedApp && subscribedMessages?.appId === selected);
  const app =
    selectedApp && reactive
      ? {
          ...selectedApp,
          conversation:
            subscribedMessages?.appId === selected ? subscribedMessages.messages : undefined,
        }
      : selectedApp;
  const release = app && (app.current ?? app.preview);
  const workspaceBundle = app?.workspace ?? release?.bundle;
  const refreshVersion = useRef(0);
  async function refresh() {
    if (reactive && snapshot) return snapshot;
    const version = ++refreshVersion.current;
    const data = await api<Snapshot>();
    if (version === refreshVersion.current) setSnapshot(data);
    return data;
  }
  useEffect(() => {
    let mounted = true;
    api<Snapshot>(undefined, { statusOnly: reactive })
      .then((data) => {
        if (!mounted) return;
        setSnapshot(data);
        const id = new URLSearchParams(window.location.hash.slice(1)).get("app");
        if (id && (reactive || data.apps.some((a) => a.id === id))) {
          setSelected(id);
          setChatKey(id);
        }
      })
      .catch((e) => mounted && setError(e.message));
    return () => {
      mounted = false;
    };
  }, []);
  useEffect(() => {
    if (reactive || !app || app.chatTitle !== "New chat") return;
    let stopped = false;
    let attempts = 0;
    const timer = setInterval(() => {
      if (++attempts > 20) {
        clearInterval(timer);
        return;
      }
      void api<Snapshot>().then((data) => {
        if (!stopped) setSnapshot(data);
      });
    }, 2000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [reactive, app?.id, app?.chatTitle]);
  const select = useCallback((id: string | null) => {
    setSelected(id);
    setImported(null);
    setError("");
    setChatKey(id ?? crypto.randomUUID());
    setTab("preview");
    setReview(null);
    setActiveSourceFile("app.js");
    window.history.replaceState(null, "", id ? `/#app=${id}` : "/");
  }, []);
  useEffect(() => {
    // Another tab can delete the selected thread while this tab is open.
    if (reactive && selected && subscribedApp?.appId === selected && subscribedApp.app === null) {
      select(null);
    }
  }, [reactive, selected, subscribedApp, select]);
  async function run<T>(label: string, task: () => Promise<T>) {
    if (busy || agentBusy) return;
    setBusy(label);
    setError("");
    try {
      return await task();
    } catch (e) {
      const message = e instanceof Error ? e.message : "Operation failed";
      setError(message);
    } finally {
      setBusy("");
    }
  }
  async function createExample(spec: ProductSpec) {
    await run("Installing example…", async () => {
      const next = await api<Application>({ action: "create", spec, mode: "sample" });
      await refresh();
      select(next.id);
    });
  }
  async function importFiles(files: FileList | null) {
    if (!files?.length) return;
    await run("Reading application source…", async () => {
      if (
        Array.from(files).some((f) => f.size > 200000) ||
        Array.from(files).reduce((n, f) => n + f.size, 0) > 250000
      )
        throw new Error("Source upload exceeds 250 KB.");
      let bundle;
      if (files.length === 1 && files[0].name.endsWith(".json"))
        bundle = JSON.parse(await files[0].text());
      else {
        const entries = await Promise.all(
          Array.from(files).map(async (f) => [f.name, await f.text()] as const),
        );
        const map = Object.fromEntries(entries);
        if (!map["cd80.json"])
          throw new Error(
            "Select cd80.json, index.html, app.js, calculations.js, and style.css together.",
          );
        bundle = {
          manifest: JSON.parse(map["cd80.json"]),
          files: Object.fromEntries(entries.filter(([name]) => name !== "cd80.json")),
        };
      }
      setImported(bundleSchema.parse(bundle));
    });
    if (file.current) file.current.value = "";
  }
  async function confirmImport() {
    if (!imported) return;
    await run("Verifying imported application source…", async () => {
      const next = await api<Application>({ action: "import", bundle: imported, appId: app?.id });
      await refresh();
      select(next.id);
      setTab("preview");
    });
  }
  return (
    <SidebarProvider
      className="h-svh min-h-0 overflow-hidden"
      style={{ "--sidebar-width": "16rem" } as React.CSSProperties}
    >
      {reactive && snapshot && (
        <StudioSubscriptions
          selected={selected}
          demo={snapshot.status.demo}
          onThreads={setSubscribedThreads}
          onApp={receiveApp}
          onMessages={receiveMessages}
        />
      )}
      <ConversationNavigation
        apps={apps}
        selected={selected}
        select={select}
        busy={!!busy || agentBusy}
        openSettings={() => setSettingsOpen(true)}
        deleteThread={
          reactive
            ? async (appId) => {
                await convexClient!.mutation(convexApi.platform.deleteThread, { appId });
                if (selected === appId) select(null);
              }
            : undefined
        }
      />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <header className="flex min-h-12 shrink-0 flex-wrap items-center justify-between gap-2 px-3 py-2">
          <div className="flex min-w-0 items-center gap-2">
            <SidebarTrigger />
            <h1 className="truncate font-medium">{app?.chatTitle ?? app?.name ?? "New chat"}</h1>
          </div>
          <div className="flex items-center gap-2">
            {release && (
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  download(
                    `${app!.name.replaceAll(/[^a-zA-Z0-9]/g, "-")}.cd80.json`,
                    JSON.stringify(release.bundle, null, 2),
                  )
                }
              >
                Export source
              </Button>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger
                render={<Button variant="ghost" size="icon-sm" aria-label="More actions" />}
              >
                <MoreHorizontal />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuGroup>
                  <DropdownMenuItem disabled={!!busy} onClick={() => file.current?.click()}>
                    Import source
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    disabled={!!busy || !snapshot}
                    onClick={() =>
                      void run("Installing examples…", async () => {
                        const added = await api<Application[]>({ action: "seed" });
                        const next = await refresh();
                        select(added[0]?.id ?? next.apps[0]?.id);
                      })
                    }
                  >
                    Install all examples
                  </DropdownMenuItem>
                  {release && (
                    <>
                      <DropdownMenuItem onClick={() => setReview("checks")}>
                        Release checks
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => setReview("spec")}>
                        Specification
                      </DropdownMenuItem>
                    </>
                  )}
                  <DropdownMenuItem onClick={() => setSettingsOpen(true)}>
                    Connections
                  </DropdownMenuItem>
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>
        <Separator />
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto md:flex-row md:overflow-hidden">
          <aside
            aria-label="Application chat"
            className="flex w-full shrink-0 flex-col gap-4 p-4 md:w-120 md:overflow-hidden"
          >
            <AgentChat
              key={chatKey}
              app={app}
              reactive={reactive}
              messagesReady={messagesReady}
              connected={!!snapshot?.status.modelConfigured}
              disabled={
                !!busy ||
                !messagesReady ||
                (reactive &&
                  ["queued", "running"].includes(app?.agentTurn?.status ?? "") &&
                  !agentBusy)
              }
              modelName={snapshot?.status.model ?? "AI"}
              onBusyChange={setAgentBusy}
              onImport={() => file.current?.click()}
              onExample={(spec) => void createExample(spec)}
              onWorkspaceCreated={(next) => {
                setSnapshot((current) =>
                  current ? { ...current, apps: [...current.apps, next] } : current,
                );
                setSelected(next.id);
                window.history.replaceState(null, "", `/#app=${next.id}`);
              }}
              onFinish={async () => {
                await refresh();
              }}
            />
          </aside>
          <Separator orientation="vertical" className="hidden md:block" />
          <Separator className="md:hidden" />
          <main
            ref={workspace}
            aria-label="Application workspace"
            className={cn(
              "flex min-h-80 min-w-0 flex-1 flex-col md:min-h-0 [&:fullscreen]:h-svh [&:fullscreen]:bg-background",
              app && !imported && tab !== "data" ? "overflow-hidden" : "overflow-y-auto",
            )}
          >
            <input
              ref={file}
              type="file"
              accept=".json,.html,.js,.css"
              multiple
              hidden
              onChange={(e) => void importFiles(e.target.files)}
            />
            {error && (
              <Alert variant="destructive" className="self-center w-[calc(100%-2rem)]">
                <AlertTitle>Operation failed</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
                <AlertAction>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Dismiss error"
                    onClick={() => setError("")}
                  >
                    <X />
                  </Button>
                </AlertAction>
              </Alert>
            )}
            {imported ? (
              <section className="flex flex-col gap-5 p-4">
                <h2>Import {imported.manifest.name}</h2>
                <p className="text-sm">
                  {app ? `Apply imported source to ${app.name}.` : "Create a new application."}
                </p>
                <Table>
                  <TableBody>
                    <TableRow>
                      <TableCell>Protocol</TableCell>
                      <TableCell>{imported.manifest.protocol}</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell>Files</TableCell>
                      <TableCell>{Object.keys(imported.files).join(", ")}</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell>Capabilities</TableCell>
                      <TableCell className="whitespace-normal">
                        {imported.manifest.permissions.join(", ")}
                      </TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
                <div className="flex flex-wrap gap-2">
                  <Button disabled={!!busy} onClick={() => void confirmImport()}>
                    <ShieldCheck data-icon="inline-start" />
                    Verify imported app
                  </Button>
                  <Button variant="ghost" disabled={!!busy} onClick={() => setImported(null)}>
                    Cancel
                  </Button>
                </div>
              </section>
            ) : app ? (
              <Tabs
                value={tab}
                onValueChange={(value) => {
                  if (isTab(value)) {
                    setTab(value);
                    if (value === "data") void run("Refreshing shared data…", refresh);
                  }
                }}
                className="min-h-0 min-w-0 flex-1 gap-0"
              >
                <div className="grid shrink-0 grid-cols-[auto_minmax(0,1fr)_auto] md:grid-cols-3 items-center gap-2 px-3 py-2">
                  <TabsList aria-label="Workspace views">
                    {workspaceTabs.map(({ value, label, Icon }) => (
                      <TabsTrigger value={value} key={value} aria-label={label} title={label}>
                        <Icon />
                      </TabsTrigger>
                    ))}
                  </TabsList>
                  <div className="flex min-w-0 items-center justify-center gap-2">
                    <span
                      className="truncate text-sm font-mono"
                      title={tab === "source" ? activeSourceFile : app.name}
                    >
                      {tab === "source" ? activeSourceFile : app.name}
                    </span>
                    {tab !== "source" && (
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={tab === "data" ? "Refresh database" : "Refresh preview"}
                        title={tab === "data" ? "Refresh database" : "Refresh preview"}
                        disabled={!!busy || (tab === "preview" && !release?.verification.passed)}
                        onClick={() => {
                          if (tab === "data") void run("Refreshing shared data…", refresh);
                          else setPreviewRevision((revision) => revision + 1);
                        }}
                      >
                        <RefreshCw />
                      </Button>
                    )}
                  </div>
                  <div className="flex items-center justify-end gap-2">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={fullscreen ? "Exit fullscreen" : "Enter fullscreen"}
                      title={fullscreen ? "Exit fullscreen" : "Enter fullscreen"}
                      onClick={() => void toggleFullscreen()}
                    >
                      {fullscreen ? <Minimize /> : <Maximize />}
                    </Button>
                    {app.current && (
                      <a
                        href={`/app/${app.id}`}
                        target="_blank"
                        rel="noreferrer"
                        aria-label="Open app"
                        title="Open app"
                        className={buttonVariants({ variant: "ghost", size: "icon-sm" })}
                      >
                        <ArrowUpRight />
                      </a>
                    )}
                  </div>
                </div>
                <Separator />
                <TabsContent value="preview" className="flex min-h-0 flex-col">
                  {release?.verification.passed ? (
                    <AppFrame
                      key={`${release.id}:${previewRevision}`}
                      app={app}
                      release={release}
                    />
                  ) : (
                    <Empty>
                      <EmptyHeader>
                        <EmptyMedia variant="icon">
                          <ShieldCheck />
                        </EmptyMedia>
                        <EmptyTitle>
                          {release ? "Review the failed checks" : "No release yet"}
                        </EmptyTitle>
                        <EmptyDescription>
                          {release
                            ? "Execution is disabled until verification passes."
                            : "Request a build or import source."}
                        </EmptyDescription>
                      </EmptyHeader>
                      {release && (
                        <EmptyContent>
                          <Button variant="outline" onClick={() => setReview("checks")}>
                            View checks
                          </Button>
                        </EmptyContent>
                      )}
                    </Empty>
                  )}
                </TabsContent>
                <TabsContent value="source" className="flex min-h-0 flex-col">
                  {workspaceBundle && (
                    <CodeWorkspace
                      bundle={workspaceBundle}
                      workspaceId={`${app.id}:${app.revision}`}
                      activeFile={activeSourceFile}
                      onSelectFile={setActiveSourceFile}
                    />
                  )}
                </TabsContent>
                <TabsContent value="data" className="p-4">
                  <p className="text-sm text-muted-foreground">Read-only application data.</p>
                  <pre className="max-w-full overflow-x-auto py-4 text-xs">
                    {JSON.stringify(app.data, null, 2)}
                  </pre>
                </TabsContent>
              </Tabs>
            ) : (
              <Empty className="flex-1">
                <EmptyHeader>
                  <EmptyTitle>Preview</EmptyTitle>
                </EmptyHeader>
              </Empty>
            )}
          </main>
        </div>
      </div>
      <Dialog
        open={review !== null}
        onOpenChange={(open) => {
          if (!open) setReview(null);
        }}
      >
        <DialogContent className="max-h-[85svh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>{review === "checks" ? "Release checks" : "Specification"}</DialogTitle>
            <DialogDescription>{app?.name}</DialogDescription>
          </DialogHeader>
          {release &&
            (review === "checks" ? (
              <Checks release={app?.preview ?? release} />
            ) : (
              <SpecView spec={release.spec} />
            ))}
        </DialogContent>
      </Dialog>
      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent className="max-h-[85svh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Connections</DialogTitle>
            <DialogDescription>
              {snapshot?.status.local
                ? "Single-owner workspace stored on this computer."
                : snapshot?.status.demo
                  ? "All visitors share this demo workspace and its Convex data."
                  : "Account mode uses WorkOS identity and Convex storage."}
            </DialogDescription>
          </DialogHeader>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Connection</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow>
                <TableCell>Model</TableCell>
                <TableCell className="whitespace-normal">
                  {snapshot?.status.model} ·{" "}
                  {snapshot?.status.modelConfigured ? "Key configured" : "Key required"}
                </TableCell>
              </TableRow>
              <TableRow>
                <TableCell>Runtime</TableCell>
                <TableCell className="whitespace-normal">{snapshot?.status.runtime}</TableCell>
              </TableRow>
              <TableRow>
                <TableCell>Market data</TableCell>
                <TableCell>
                  {snapshot?.status.tushareConfigured ? "Tushare + fixtures" : "Synthetic fixtures"}
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
          <PluginSettings />
          <div className="flex flex-wrap gap-2">
            {app?.current && app.spec.protocol === "strategy" && (
              <Button
                variant="outline"
                disabled={!!busy}
                onClick={() =>
                  void run("Loading daily prices…", async () => {
                    await api({
                      action: "load-prices",
                      appId: app.id,
                      provider: snapshot?.status.local ? "alpha-demo" : "tushare",
                    });
                    await refresh();
                  })
                }
              >
                Load real prices into app
              </Button>
            )}
            <Button
              variant="outline"
              disabled={!!busy}
              onClick={() =>
                void run("Testing financial API…", async () =>
                  setProviderResult(
                    await api<unknown>({ action: "test-provider", provider: "alpha-demo" }),
                  ),
                )
              }
            >
              Test financial API
            </Button>
            <Button
              variant="ghost"
              disabled={!!busy}
              onClick={() => void run("Refreshing connections…", refresh)}
            >
              <RefreshCw data-icon="inline-start" />
              Refresh
            </Button>
          </div>
          {providerResult != null && (
            <pre className="max-w-full overflow-x-auto text-xs">
              {JSON.stringify(providerResult, null, 2)}
            </pre>
          )}
          {busy && <p role="status">{busy}</p>}
          {error && (
            <Alert variant="destructive">
              <AlertTitle>Connection failed</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
        </DialogContent>
      </Dialog>
    </SidebarProvider>
  );
}

function isTab(value: unknown): value is Tab {
  return value === "preview" || value === "source" || value === "data";
}

function Checks({ release }: { release: Release }) {
  return (
    <section className="flex min-w-0 flex-col gap-4">
      <Alert variant={release.verification.passed ? "default" : "destructive"}>
        <ShieldCheck />
        <AlertTitle>
          {release.verification.passed ? "Mandatory checks passed" : "Release blocked"}
        </AlertTitle>
        <AlertDescription>
          Fixtures validate the protocol contract. Passing builds activate automatically; failed
          changes leave the working app in place.
        </AlertDescription>
      </Alert>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Result</TableHead>
            <TableHead>Check</TableHead>
            <TableHead>Details</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {release.verification.checks.map((check, index) => (
            <TableRow key={index}>
              <TableCell>{check.passed ? "Pass" : "Fail"}</TableCell>
              <TableCell className="whitespace-normal">{check.name}</TableCell>
              <TableCell className="whitespace-normal">{check.detail}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <p className="break-all text-xs text-muted-foreground">
        SHA-256 {release.verification.sourceHash}
        <br />
        Checked {new Date(release.verification.checkedAt).toLocaleString()}
      </p>
    </section>
  );
}

function SpecView({ spec }: { spec: ProductSpec }) {
  const protocol = protocolFor(spec.protocol);
  return (
    <section className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2>{spec.name}</h2>
        <Button
          variant="outline"
          onClick={() => download("product-spec.json", JSON.stringify(spec, null, 2))}
        >
          Export specification
        </Button>
      </div>
      <p>{spec.purpose}</p>
      {(["inputs", "outputs", "constraints"] as const).map((key) => (
        <section key={key} className="flex flex-col gap-2">
          <h3>{key[0].toUpperCase() + key.slice(1)}</h3>
          <ul className="ml-4 list-disc">
            {spec[key].map((v, i) => (
              <li key={i}>{v}</li>
            ))}
          </ul>
        </section>
      ))}
      <section className="flex flex-col gap-2">
        <h3>{protocol.name} protocol rules</h3>
        <ul className="ml-4 list-disc">
          {protocol.rules.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      </section>
    </section>
  );
}
