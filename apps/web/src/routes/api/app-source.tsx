import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { accessFor } from "../../server/platform";
import { findApp } from "../../server/repository";
import { starterSourceFiles } from "../../server/tsx-compiler";

export const Route = createFileRoute("/api/app-source")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const appId = z.string().uuid().safeParse(new URL(request.url).searchParams.get("appId"));
        const headers = {
          "cache-control": "private, no-store",
          "x-content-type-options": "nosniff",
        };
        if (!appId.success)
          return Response.json({ error: "Application ID is required" }, { status: 400, headers });
        try {
          const access = await accessFor(request);
          const app = await findApp(access, appId.data);
          const bundle = app.workspace ?? app.current?.bundle ?? app.preview?.bundle;
          if (bundle?.manifest.schemaVersion !== 2)
            return Response.json({ files: {} }, { headers });
          return Response.json({ files: await starterSourceFiles() }, { headers });
        } catch {
          return Response.json(
            { error: "Starter source is unavailable" },
            { status: 404, headers },
          );
        }
      },
    },
  },
});
