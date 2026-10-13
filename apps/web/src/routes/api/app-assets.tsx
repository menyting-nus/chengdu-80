import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { accessFor } from "../../server/platform";
import { findApp } from "../../server/repository";
import { sourceHash } from "../../server/runtime";
import { compileTsx } from "../../server/tsx-compiler";

const querySchema = z.object({ appId: z.string().uuid(), releaseId: z.string().uuid() });
const headers = { "cache-control": "private, no-store", "x-content-type-options": "nosniff" };

export const Route = createFileRoute("/api/app-assets")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const origin = request.headers.get("origin");
        if (origin && origin !== url.origin)
          return Response.json(
            { error: "Cross-origin requests are not allowed" },
            { status: 403, headers },
          );
        const query = querySchema.safeParse(Object.fromEntries(url.searchParams));
        if (!query.success)
          return Response.json(
            { error: "Application and release IDs are required" },
            { status: 400, headers },
          );
        let access: Awaited<ReturnType<typeof accessFor>>;
        try {
          access = await accessFor(request);
        } catch {
          return Response.json({ error: "Authentication is required" }, { status: 401, headers });
        }
        try {
          const app = await findApp(access, query.data.appId);
          if (app.ownerId !== access.ownerId)
            return Response.json(
              { error: "Application not found or access denied" },
              { status: 404, headers },
            );
          const release = [app.current, app.preview].find(
            (item) => item?.id === query.data.releaseId,
          );
          if (!release)
            return Response.json({ error: "Release not found" }, { status: 404, headers });
          if (
            !release.verification.passed ||
            release.verification.sourceHash !== (await sourceHash(release.bundle))
          )
            return Response.json(
              { error: "A verified, unchanged release is required" },
              { status: 409, headers },
            );
          if (release.bundle.manifest.schemaVersion !== 2)
            return Response.json(
              { error: "This release does not use the React starter" },
              { status: 400, headers },
            );
          return Response.json(await compileTsx(release.bundle), { headers });
        } catch {
          // Compiler/backend errors can contain source or configuration details.
          // The owning chat receives build diagnostics during verification.
          return Response.json(
            { error: "Compiled preview is unavailable. Refresh the preview or rebuild the app." },
            { status: 400, headers },
          );
        }
      },
    },
  },
});
