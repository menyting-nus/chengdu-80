import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { accessFor } from "../../server/platform";
import { createPreviewSession } from "../../server/preview-session";
const headers = { "cache-control": "private, no-store", "x-content-type-options": "nosniff" };
const querySchema = z.object({
  appId: z.string().uuid(),
  releaseId: z.string().uuid(),
  nonce: z.string().regex(/^[a-f0-9]{32}$/),
});
export const Route = createFileRoute("/api/app-preview-session")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const origin = request.headers.get("origin");
        if (
          (origin && origin !== url.origin) ||
          request.headers.get("sec-fetch-site") === "cross-site"
        )
          return Response.json(
            { error: "Cross-origin requests are not allowed" },
            { status: 403, headers },
          );
        const query = querySchema.safeParse(Object.fromEntries(url.searchParams));
        if (!query.success)
          return Response.json(
            { error: "Application, release and preview nonce are required" },
            { status: 400, headers },
          );
        try {
          const session = await createPreviewSession(
            await accessFor(request),
            query.data.appId,
            query.data.releaseId,
            query.data.nonce,
            url.origin,
          );
          return Response.json(session, { headers });
        } catch {
          return Response.json(
            { error: "Verified preview is unavailable. Refresh or rebuild the app." },
            { status: 404, headers },
          );
        }
      },
    },
  },
});
