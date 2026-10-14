import { useState } from "react";
import { Code2, Layers, Plus, Settings, Trash2 } from "lucide-react";
import { Button } from "@web-starter/ui/components/button";
import {
  Sidebar,
  SidebarHeader,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarMenuAction,
  useSidebar,
} from "@web-starter/ui/components/sidebar";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@web-starter/ui/components/dialog";
import { Alert, AlertDescription } from "@web-starter/ui/components/alert";
import type { Application } from "../lib/contracts";

export function ConversationNavigation({
  apps,
  selected,
  select,
  busy,
  openSettings,
  deleteThread,
}: {
  apps: Pick<Application, "id" | "name" | "chatTitle">[];
  selected: string | null;
  select: (id: string | null) => void;
  busy: boolean;
  openSettings: () => void;
  deleteThread?: (appId: string) => Promise<void>;
}) {
  const { setOpenMobile } = useSidebar();
  const [deleting, setDeleting] = useState<Pick<Application, "id" | "name" | "chatTitle"> | null>(
    null,
  );
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  function navigate(id: string | null) {
    select(id);
    setOpenMobile(false);
  }
  return (
    <>
      <Sidebar collapsible="offcanvas">
        <SidebarHeader>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton render={<a href="/" />} tooltip="Chengdu80">
                <Layers />
                <span>Chengdu80</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <Button
                className="w-full justify-start"
                disabled={busy}
                onClick={() => navigate(null)}
              >
                <Plus data-icon="inline-start" />
                <span>New chat</span>
              </Button>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarHeader>
        <SidebarContent aria-label="Conversations">
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu>
                {apps.map((app) => (
                  <SidebarMenuItem key={app.id}>
                    <SidebarMenuButton
                      isActive={selected === app.id}
                      disabled={busy}
                      onClick={() => navigate(app.id)}
                      tooltip={app.chatTitle ?? app.name}
                    >
                      <span>{app.chatTitle ?? app.name}</span>
                    </SidebarMenuButton>
                    {deleteThread && (
                      <SidebarMenuAction
                        showOnHover
                        aria-label={`Delete ${app.chatTitle ?? app.name}`}
                        onClick={() => {
                          setDeleting(app);
                          setError(undefined);
                        }}
                      >
                        <Trash2 />
                      </SidebarMenuAction>
                    )}
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
        <SidebarFooter>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                onClick={() => {
                  openSettings();
                  setOpenMobile(false);
                }}
                tooltip="Connections"
              >
                <Settings />
                <span>Connections</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton render={<a href="/docs" />} tooltip="Developer docs">
                <Code2 />
                <span>Developer docs</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>
      </Sidebar>
      <Dialog
        open={!!deleting}
        onOpenChange={(open) => {
          if (!open && !pending) setDeleting(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete conversation?</DialogTitle>
            <DialogDescription>
              This deletes {deleting?.chatTitle ?? deleting?.name}, its messages and its app. This
              cannot be undone.
            </DialogDescription>
          </DialogHeader>
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <DialogFooter>
            <Button variant="outline" disabled={pending} onClick={() => setDeleting(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={pending}
              onClick={async () => {
                if (!deleting || !deleteThread) return;
                setPending(true);
                setError(undefined);
                try {
                  await deleteThread(deleting.id);
                  setDeleting(null);
                } catch (cause) {
                  setError(
                    cause instanceof Error ? cause.message : "Could not delete conversation",
                  );
                } finally {
                  setPending(false);
                }
              }}
            >
              {pending ? "Deleting…" : "Delete conversation"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
