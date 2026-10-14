# AGENTS.md

## Stack

Bun monorepo:

- TanStack Start in `apps/web`, built as a standalone Node server and deployed via Docker/docker-compose (`apps/web/Dockerfile`, `docker-compose.yml`) — no Cloudflare/Alchemy
- Tailwind CSS v4 and shadcn/ui primitives in `packages/ui`
- Vite+ (`vp`) for dev, build, lint, format, type checks, and task running. Lint and format config lives in the root `vite.config.ts`
- Convex backend in `packages/backend/convex` (Convex Cloud or a self-hosted Convex backend container, see `docker-compose.yml`)
- WorkOS AuthKit for auth (bypassed entirely in demo mode; see Auth Notes)
- TanStack AI chat route in `apps/web/src/routes/api/ai/chat.tsx`

## Required Rules

- Use Bun commands: `bun install`, `bun run dev`, `bun run build`, `bun run check`.
- Do not introduce another backend, auth provider, formatter, or linter.
- Use shadcn primitives from `@web-starter/ui/components/*` before adding custom UI.
- This shadcn setup uses Base UI. Use exported class helpers like `buttonVariants` for link-styled buttons instead of Radix `asChild`.
- Deployment target is a self-hosted Node server (Docker/docker-compose, e.g. Coolify or k3s); no Cloudflare/Alchemy dependency remains.
- Read configuration via `settings()` in `apps/web/src/server/settings.ts` (plain `process.env`), not provider-specific bindings.
- Do not put secrets in public `VITE_` variables.
- Keep Convex functions in `packages/backend/convex` and import APIs from `@web-starter/backend/convex/_generated/api`.
- Run `bun run codegen` after adding or renaming Convex functions.

## Environment

Local env lives in `apps/web/.env` (examples in `apps/web/.env.example`). `settings()` reads env vars directly from `process.env` at runtime — no provider-specific binding layer.

Prototype launchers also read `platform/.env` and the workspace `../.env`, with non-empty workspace values taking precedence. Never print secret values. `setup:env` only creates a missing workspace file. Use `dev:hosted` / `deploy:hosted` to load workspace credentials and build/run the self-hosted `docker-compose.yml` stack.

`dev:local` uses an explicit single-owner loopback demo and a file persistence adapter. It is not another production backend or authentication provider. Self-hosted mode continues using Convex (Convex Cloud, or the self-hosted Convex backend container in `docker-compose.yml`). The user explicitly deferred login on 2026-10-13: self-hosted launchers default to `CD80_DEMO_MODE=1` and `VITE_DEMO_MODE=1`, using a shared demo workspace and server-key-protected Convex actions. WorkOS remains available when demo mode is explicitly disabled. Do not claim account privacy in demo mode. Do not claim cloud isolation based on local tests or ship `VITE_LOCAL_MODE=1` as the authenticated product.

Convex deployment env is set with `bunx convex env set` from `packages/backend`; see `packages/backend/.env.example`.

## Auth Notes

The active provider implements `AuthIntegration` (`apps/web/src/integrations/auth/types.ts`). Use `auth` from `apps/web/src/integrations/auth` instead of provider SDKs in shared code. Its middleware is registered in `apps/web/src/start.ts`, and must stay in Start request middleware.

Protected pages read `context.viewer` in `beforeLoad` and redirect to `auth.signInHref(location.pathname)` when it is null (see `routes/dashboard.tsx`).

WorkOS routes: `/api/auth/sign-in`, `/api/auth/sign-up`, `/api/auth/callback`, `/sign-out`.

Convex validates auth JWTs in `packages/backend/convex/auth.config.ts`. Use `ctx.auth.getUserIdentity()` in Convex functions and prefer explicit auth checks over client state.

## Verification

Before handing off meaningful changes, run:

```bash
bun run codegen
bun run check
```

Run `bun run build` when touching routing, auth, deployment, or Vite config.

If Convex codegen needs missing deployment credentials, record that exact limitation instead of claiming it passed.
