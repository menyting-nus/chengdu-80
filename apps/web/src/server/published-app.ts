import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { accessFor } from "./platform";
import { findApp } from "./repository";

// Publication metadata comes from the owned, active release. The page needs
// only identities and metadata, not its source, conversation or saved data.
export const loadPublishedApp = createServerFn({ method: "GET" })
  .validator(z.object({ appId: z.string().uuid() }))
  .handler(async ({ data }) => {
    const request = getRequest();
    const app = await findApp(await accessFor(request), data.appId);
    if (!app.current) throw new Error("Application not found or access denied");
    const title = app.current.spec.name;
    const description = app.current.spec.purpose.slice(0, 300);
    const suppliedIcon = app.current.bundle.files["public/favicon.svg"];
    const initial = (
      new Intl.Segmenter().segment(title.trim()).containing(0)?.segment ?? "A"
    ).replace(/[<>&"']/g, "");
    const icon =
      suppliedIcon ??
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="12" fill="black"/><text x="32" y="43" text-anchor="middle" font-family="sans-serif" font-size="36" fill="white">${initial}</text></svg>`;
    return {
      app: { id: app.id, name: app.name },
      release: { id: app.current.id },
      title,
      description,
      canonical: new URL(`/app/${app.id}`, request.url).href,
      icon: `data:image/svg+xml,${encodeURIComponent(icon)}`,
    };
  });
