import { useEffect, useMemo, useRef, useState } from "react";
import type { Application, Release } from "../lib/contracts";
import { Alert, AlertTitle, AlertDescription } from "@web-starter/ui/components/alert";
import { api } from "../lib/client";

export function AppFrame({ app, release }: { app: Application; release: Release }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [assets, setAssets] = useState<{ releaseId: string; javascript: string; css: string }>();
  const nonce = useMemo(() => crypto.randomUUID().replaceAll("-", ""), [release.id]);
  const onFrameLoad = useMemo(() => {
    let loads = 0;
    return () => {
      if (++loads > 1) {
        setReady(false);
        setError(
          "Application navigation was blocked or left the isolated preview. Review the app source.",
        );
      }
    };
  }, [nonce]);
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
      15000,
    );
    return () => {
      window.removeEventListener("message", receive);
      clearTimeout(timer);
    };
  }, [app.id, release.id, nonce]);
  useEffect(() => {
    const controller = new AbortController();
    const query = new URLSearchParams({ appId: app.id, releaseId: release.id });
    void fetch(`/api/app-assets?${query}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok)
          throw new Error("Compiled preview could not load. Try refreshing the preview.");
        const result: unknown = await response.json();
        if (
          !result ||
          typeof result !== "object" ||
          !("javascript" in result) ||
          !("css" in result) ||
          typeof result.javascript !== "string" ||
          typeof result.css !== "string"
        ) {
          throw new Error("Invalid compiled preview assets");
        }
        if (!controller.signal.aborted)
          setAssets({ releaseId: release.id, javascript: result.javascript, css: result.css });
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted)
          setError(reason instanceof Error ? reason.message : "Compiled preview could not load");
      });
    return () => controller.abort();
  }, [app.id, release.id]);
  const doc = useMemo(() => {
    const compiled = assets?.releaseId === release.id ? assets : undefined;
    if (!compiled) return undefined;
    const sdk = `const report=message=>parent.postMessage({channel:'cd80',nonce:'${nonce}',log:{message:String(message)}},'*');window.addEventListener('error',e=>report(e.message));window.addEventListener('unhandledrejection',e=>report(e.reason instanceof Error?e.reason.message:e.reason));const pending=new Map();let count=0;window.cd80={call(capability,input={}){return new Promise((resolve,reject)=>{const id=String(++count);const timer=setTimeout(()=>{pending.delete(id);reject(new Error('Capability request timed out'));},100000);pending.set(id,{resolve,reject,timer});parent.postMessage({channel:'cd80',nonce:'${nonce}',id,capability,input},'*');});},ready(){parent.postMessage({channel:'cd80',nonce:'${nonce}',ready:true},'*');}};window.addEventListener('message',e=>{const m=e.data;if(e.source!==parent||!m||m.channel!=='cd80-result'||m.nonce!=='${nonce}')return;const p=pending.get(m.id);if(!p)return;clearTimeout(p.timer);pending.delete(m.id);m.error?p.reject(new Error(m.error)):p.resolve(m.result);});`;
    const csp = `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none';`;
    const javascript = compiled.javascript;
    const css = compiled.css;
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><meta name="viewport" content="width=device-width, initial-scale=1"><style>html,textarea{scrollbar-gutter:stable}${css.replace(/<\/style/gi, "<\\/style")}</style></head><body><div id="root"></div><script nonce="${nonce}">${sdk}</script><script nonce="${nonce}" >${javascript.replace(/<\/script/gi, "<\\/script")}</script></body></html>`;
  }, [nonce, release.id, assets]);
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      {!ready && !error && (
        <p role="status" className="text-sm text-muted-foreground">
          Loading preview…
        </p>
      )}
      {!ready && error && (
        <Alert>
          <AlertTitle>Preview needs review</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {doc && (
        <iframe
          ref={frame}
          onLoad={onFrameLoad}
          key={release.id}
          title={`${app.name} application`}
          aria-busy={!ready}
          srcDoc={doc}
          sandbox="allow-scripts"
          referrerPolicy="no-referrer"
          className="min-h-0 w-full flex-1 border-0"
        />
      )}
    </div>
  );
}
