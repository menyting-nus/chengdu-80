import { createFileRoute } from "@tanstack/react-router";
import { resolvePreviewSession, previewBridge } from "../../server/preview-session";
import { requestWorkspace } from "../../server/app-workspaces";

const previewHeaders = {
  "cache-control": "private, no-store",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, HEAD, POST, OPTIONS",
  "access-control-allow-headers": "content-type, x-tsr-redirect, x-tsr-serverfn",
  "access-control-expose-headers": "x-tss-serialized, x-tss-raw, x-tsr-redirect",
};

async function previewRequest({ request }: { request: Request }) {
  const url = new URL(request.url);
  const token = url.pathname.slice("/api/app-preview/".length).split("/")[0];
  try {
    const { grant, release, basePath } = await resolvePreviewSession(token, url.origin);
    const withinWorkspace = (pathname: string) =>
      pathname === basePath.slice(0, -1) || pathname.startsWith(basePath);
    if (!withinWorkspace(url.pathname)) throw new Error("Invalid preview path");
    if (request.method === "OPTIONS")
      return new Response(null, { status: 204, headers: previewHeaders });
    if (request.headers.get("upgrade"))
      return Response.json(
        { error: "Preview websocket transport is disabled" },
        { status: 400, headers: previewHeaders },
      );
    if (Number(request.headers.get("content-length")) > 1_000_000)
      return Response.json(
        { error: "Preview request is too large" },
        { status: 413, headers: previewHeaders },
      );
    const body = request.method === "POST" ? await request.arrayBuffer() : undefined;
    if (body && body.byteLength > 1_000_000)
      return Response.json(
        { error: "Preview request is too large" },
        { status: 413, headers: previewHeaders },
      );
    const forwarded = new Headers();
    // Platform cookies, authorization and credentials never reach generated code.
    for (const name of ["accept", "content-type", "x-tsr-redirect", "x-tsr-serverfn"]) {
      const value = request.headers.get(name);
      if (value) forwarded.set(name, value);
    }
    const upstream = await requestWorkspace(
      release.bundle,
      basePath,
      new Request(url, { method: request.method, headers: forwarded, body }),
    );
    const headers = new Headers(previewHeaders);
    const contentType = upstream.headers.get("content-type") ?? "application/octet-stream";
    headers.set("content-type", contentType);
    for (const [name, value] of upstream.headers)
      if (/^x-(?:tss|tsr)-/.test(name)) headers.set(name, value);
    const resourceBase = `${grant.origin}${basePath}`;
    headers.set(
      "content-security-policy",
      `sandbox allow-scripts; default-src 'none'; script-src 'nonce-${grant.nonce}' ${resourceBase}; style-src 'unsafe-inline' ${resourceBase}; img-src data: ${resourceBase}; font-src ${resourceBase}; connect-src ${resourceBase}; frame-src 'none'; worker-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'self';`,
    );
    if (upstream.status >= 300 && upstream.status < 400) {
      const redirect = upstream.headers.get("location");
      const destination = redirect ? new URL(redirect, url) : undefined;
      if (
        !destination ||
        destination.origin !== url.origin ||
        !withinWorkspace(destination.pathname)
      )
        throw new Error("Preview redirect left its workspace");
      headers.set("location", destination.href);
    }
    if (request.method === "HEAD" || upstream.status === 204 || upstream.status === 304)
      return new Response(null, { status: upstream.status, headers });
    if (!contentType.includes("text/html"))
      return new Response(upstream.body, { status: upstream.status, headers });
    let html = await upstream.text();
    html = html.replace(
      /<script\b([^>]*)>/gi,
      (_match, attrs: string) =>
        `<script${attrs.replace(/\snonce=(?:"[^"]*"|'[^']*'|[^\s>]*)/gi, "")} nonce="${grant.nonce}">`,
    );
    html = html.replace(
      /<head\b[^>]*>/i,
      (head) => `${head}<script nonce="${grant.nonce}">${previewBridge(grant.nonce)}</script>`,
    );
    return new Response(html, { status: upstream.status, headers });
  } catch {
    return Response.json(
      {
        error:
          "Preview session expired or its verified workspace is unavailable. Refresh the preview.",
      },
      { status: 404, headers: previewHeaders },
    );
  }
}
export const Route = createFileRoute("/api/app-preview/$")({
  server: {
    handlers: {
      GET: previewRequest,
      HEAD: previewRequest,
      POST: previewRequest,
      OPTIONS: previewRequest,
    },
  },
});
