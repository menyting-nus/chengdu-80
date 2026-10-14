import { Link, useLocation, useRouteContext } from "@tanstack/react-router";
import { buttonVariants } from "@web-starter/ui/components/button";
import { cn } from "@web-starter/ui/lib/utils";

import { auth } from "../integrations/auth";

export default function Header() {
  const { viewer } = useRouteContext({ from: "__root__" });
  const { pathname } = useLocation();
  if (
    pathname === "/" ||
    pathname === "/docs" ||
    pathname.startsWith("/docs/") ||
    pathname.startsWith("/app/")
  )
    return null;
  const links = [
    { to: "/", label: "Workspace" },
    { to: "/docs", label: "Developer docs" },
  ] as const;

  return (
    <header className="border-b">
      <div className="mx-auto flex min-h-14 w-full max-w-6xl flex-wrap items-center justify-between gap-2 px-4 py-2">
        <nav className="flex items-center gap-1 text-sm">
          <Link to="/" className="mr-3 font-medium">
            Chengdu80
          </Link>
          {links.map(({ to, label }) => {
            return (
              <Link key={to} to={to} className={buttonVariants({ variant: "ghost", size: "sm" })}>
                {label}
              </Link>
            );
          })}
        </nav>
        <div className="flex items-center gap-2">
          {import.meta.env.VITE_LOCAL_MODE === "1" ? (
            <span className="text-xs text-muted-foreground">Local prototype · Single owner</span>
          ) : import.meta.env.VITE_DEMO_MODE === "1" ? (
            <span className="text-xs text-muted-foreground">Shared demo · No login</span>
          ) : viewer ? (
            <a
              href={auth.signOutHref}
              className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
            >
              Sign out
            </a>
          ) : (
            <>
              <a
                href={auth.signInHref()}
                className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}
              >
                Sign in
              </a>
              <a href={auth.signUpHref} className={cn(buttonVariants({ size: "sm" }))}>
                Sign up
              </a>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
