import { useEffect } from "react";
import { useConvexAuth, useQuery } from "convex/react";
import type { UIMessage } from "@tanstack/ai-react";
import { api } from "@web-starter/backend/convex/_generated/api";
import type { Application } from "./contracts";

// Mount only inside the configured Convex provider. Demo queries are explicitly
// enabled server-side; authenticated queries wait for Convex to accept the token.
export function StudioSubscriptions({
  selected,
  demo,
  onThreads,
  onApp,
  onMessages,
}: {
  selected: string | null;
  demo: boolean;
  onThreads: (threads: Pick<Application, "id" | "name" | "chatTitle">[]) => void;
  onApp: (appId: string, app: Application | null) => void;
  onMessages: (appId: string, messages: UIMessage[]) => void;
}) {
  const auth = useConvexAuth();
  const enabled = demo || (!auth.isLoading && auth.isAuthenticated);
  const threads = useQuery(api.platform.studioThreads, enabled ? {} : "skip");
  const app = useQuery(api.platform.studioApp, enabled && selected ? { appId: selected } : "skip");
  const messages = useQuery(
    api.platform.studioMessages,
    enabled && selected ? { appId: selected } : "skip",
  );
  useEffect(() => {
    if (threads !== undefined) onThreads(threads);
  }, [threads, onThreads]);
  useEffect(() => {
    if (selected && app !== undefined) onApp(selected, app);
  }, [selected, app, onApp]);
  useEffect(() => {
    if (selected && messages !== undefined) onMessages(selected, messages);
  }, [selected, messages, onMessages]);
  return null;
}
