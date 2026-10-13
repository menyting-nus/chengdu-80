import { createFileRoute } from "@tanstack/react-router";
import { accessFor, dispatch, snapshot } from "../../server/platform";
import { settings } from "../../server/settings";

function response(data: unknown, status = 200) {
  return Response.json(data, { status, headers: { "cache-control": "no-store" } });
}
export const Route = createFileRoute("/api/platform")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          return response(
            await snapshot(
              await accessFor(request),
              new URL(request.url).searchParams.get("summary") !== "1",
            ),
          );
        } catch {
          return response({ error: "Authentication or platform configuration is required" }, 401);
        }
      },
      POST: async ({ request }) => {
        try {
          const origin = request.headers.get("origin");
          if (origin && origin !== new URL(request.url).origin)
            return response({ error: "Cross-origin requests are not allowed" }, 403);
          if (!request.headers.get("content-type")?.startsWith("application/json"))
            return response({ error: "JSON content type required" }, 415);
          if (Number(request.headers.get("content-length")) > 300000)
            return response({ error: "Source bundle is too large" }, 413);
          const body = await request.text();
          if (body.length > 300000) return response({ error: "Source bundle is too large" }, 413);
          return response(await dispatch(await accessFor(request), JSON.parse(body)));
        } catch (e) {
          let message = e instanceof Error ? e.message : "Platform request failed";
          const config = await settings();
          for (const [key, value] of Object.entries(config))
            if (value && /KEY|TOKEN|PASSWORD|SECRET/.test(key))
              message = message.replaceAll(value, "[redacted]");
          message = message.replace(/sk-[a-zA-Z0-9_-]{8,}/g, "[redacted]").slice(0, 2000);
          return response({ error: message }, 400);
        }
      },
    },
  },
});
