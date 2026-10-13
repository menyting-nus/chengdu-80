import { Code2, Layers, Plus, Settings } from "lucide-react";
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
  useSidebar,
} from "@web-starter/ui/components/sidebar";
import type { Application } from "../lib/contracts";

export function ConversationNavigation({
  apps,
  selected,
  select,
  busy,
  openSettings,
}: {
  apps: Pick<Application, "id" | "name" | "chatTitle">[];
  selected: string | null;
  select: (id: string | null) => void;
  busy: boolean;
  openSettings: () => void;
}) {
  const { setOpenMobile } = useSidebar();
  function navigate(id: string | null) {
    select(id);
    setOpenMobile(false);
  }
  return (
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
            <Button className="w-full justify-start" disabled={busy} onClick={() => navigate(null)}>
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
  );
}
