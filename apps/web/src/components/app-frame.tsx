import { useEffect, useMemo, useRef, useState } from "react";
import type { Application, Release } from "../lib/contracts";
import { Alert, AlertTitle, AlertDescription } from "@web-starter/ui/components/alert";
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from "@web-starter/ui/components/empty";
import { Spinner } from "@web-starter/ui/components/spinner";
import { api } from "../lib/client";

export function AppFrame({ app, release }: { app: Application; release: Release }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [session, setSession] = useState<{ releaseId: string; url: string }>();
  const nonce = useMemo(() => crypto.randomUUID().replaceAll("-", ""), [release.id]);
  useEffect(() => {
    setReady(false);
    setError("");
    let calls = 0;
    let outstanding = 0;
    let logCount = 0;
    const receive = async (event: MessageEvent) => {
      const m = event.data;
      if (
        event.source !== frame.current?.contentWindow ||
        event.origin !== "null" ||
        !m ||
        m.channel !== "cd80" ||
        m.nonce !== nonce
      )
        return;
      if (m.log && typeof m.log.message === "string" && ++logCount <= 20) {
        void api({
          action: "browser-log",
          appId: app.id,
          releaseId: release.id,
          level: "error",
          message: m.log.message.slice(0, 2000),
        }).catch(() => {});
        return;
      }
      if (m.ready) {
        setReady(true);
        return;
      }
      if (typeof m.id !== "string" || typeof m.capability !== "string") return;
      if (++calls > 250 || outstanding >= 5) {
        event.source?.postMessage(
          {
            channel: "cd80-result",
            nonce,
            id: m.id,
            error: "Preview capability rate limit reached",
          },
          { targetOrigin: "*" },
        );
        return;
      }
      outstanding++;
      try {
        const result = await api({
          action: "rpc",
          appId: app.id,
          releaseId: release.id,
          capability: m.capability,
          input: m.input,
        });
        frame.current?.contentWindow?.postMessage(
          { channel: "cd80-result", nonce, id: m.id, result },
          "*",
        );
      } catch (e) {
        frame.current?.contentWindow?.postMessage(
          {
            channel: "cd80-result",
            nonce,
            id: m.id,
            error: e instanceof Error ? e.message : "Capability failed",
          },
          "*",
        );
      } finally {
        outstanding--;
      }
    };
    window.addEventListener("message", receive);
    const timer = setTimeout(
      () =>
        setError(
          "If the app stays blank, review its source and browser behavior before continuing.",
        ),
      60000,
    );
    return () => {
      window.removeEventListener("message", receive);
      clearTimeout(timer);
    };
  }, [app.id, release.id, nonce]);
  useEffect(() => {
    const controller = new AbortController();
    const query = new URLSearchParams({ appId: app.id, releaseId: release.id, nonce });
    void fetch(`/api/app-preview-session?${query}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok)
          throw new Error("Verified preview could not load. Refresh or rebuild the app.");
        const result: unknown = await response.json();
        if (
          !result ||
          typeof result !== "object" ||
          !("url" in result) ||
          typeof result.url !== "string" ||
          !/^\/api\/app-preview\/[a-f0-9]{32}\.[A-Za-z0-9_-]{43}\/$/.test(result.url)
        )
          throw new Error("Invalid preview session");
        if (!controller.signal.aborted) setSession({ releaseId: release.id, url: result.url });
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted)
          setError(reason instanceof Error ? reason.message : "Preview could not load");
      });
    return () => controller.abort();
  }, [app.id, release.id, nonce]);
  const previewUrl = session?.releaseId === release.id ? session.url : undefined;
  return (
    <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
      {!ready && !error && (
        <Empty className="absolute inset-0 bg-background" role="status" aria-live="polite">
          <EmptyHeader>
            <EmptyMedia>
              <Spinner className="size-6 motion-reduce:animate-none" aria-hidden="true" />
            </EmptyMedia>
            <EmptyTitle>Loading preview</EmptyTitle>
          </EmptyHeader>
        </Empty>
      )}
      {!ready && error && (
        <Alert>
          <AlertTitle>Preview needs review</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {previewUrl && (
        <iframe
          ref={frame}
          key={release.id}
          title={`${app.name} application`}
          aria-busy={!ready}
          src={previewUrl}
          sandbox="allow-scripts"
          referrerPolicy="no-referrer"
          className="min-h-0 w-full flex-1 border-0"
        />
      )}
    </div>
  );
}
