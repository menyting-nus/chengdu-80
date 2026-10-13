import { createFileRoute } from "@tanstack/react-router";
import { AppFrame } from "../components/app-frame";
import { Alert, AlertTitle, AlertDescription } from "@web-starter/ui/components/alert";
import { loadPublishedApp } from "../server/published-app";

export const Route = createFileRoute("/app/$appId")({
  loader: ({ params }) => loadPublishedApp({ data: { appId: params.appId } }),
  head: ({ loaderData }) =>
    loaderData
      ? {
          meta: [
            { title: loaderData.title },
            { name: "description", content: loaderData.description },
            { property: "og:title", content: loaderData.title },
            { property: "og:description", content: loaderData.description },
            { property: "og:type", content: "website" },
            { property: "og:url", content: loaderData.canonical },
            { name: "twitter:card", content: "summary" },
            { name: "twitter:title", content: loaderData.title },
            { name: "twitter:description", content: loaderData.description },
          ],
          links: [
            { rel: "canonical", href: loaderData.canonical },
            { rel: "icon", type: "image/svg+xml", href: loaderData.icon },
          ],
        }
      : {},
  component: PublishedApp,
  errorComponent: ({ error }) => (
    <Alert variant="destructive">
      <AlertTitle>Application unavailable</AlertTitle>
      <AlertDescription>{error.message}</AlertDescription>
    </Alert>
  ),
});

function PublishedApp() {
  const { app, release } = Route.useLoaderData();
  return (
    <main aria-label="Standalone application" className="flex h-svh min-h-0 min-w-0 flex-col">
      <AppFrame app={app} release={release} />
    </main>
  );
}
