# Chengdu80 prototype

A financial application studio using the selected [web-starter](https://github.com/adityamiskin/web-starter): Bun, TanStack Start, React, Tailwind 4, shadcn, Convex, WorkOS, TanStack AI, deployed as a self-hosted Node server (Docker/docker-compose). Previously deployed to Cloudflare through Alchemy 2; see "Historical Cloudflare deployment" below.

The studio builds and updates apps through conversation. The AI edits actual source files with TanStack AI tools, verifies the changes and activates passing releases automatically. Login is deferred in demo mode: visitors share the same workspace.

## Run locally

```bash
bun install --frozen-lockfile
bun run dev:convex
```

Open http://127.0.0.1:3001. This starts the real local Convex backend and the Vite development server, with a shared demo workspace and login deferred. No Docker or Convex Cloud account is required. Convex stores apps, releases and plugin registrations. Thread titles and turn state live in `threads`; complete TanStack AI messages live in `messages`, indexed by thread and order. Each message retains its ordered text, thinking and tool parts. The sidebar subscribes to thread summaries, while the workspace subscribes only to the selected app and its messages. Backend state lives in `packages/backend/.convex/local/`; keep it to preserve data across restarts.

To import an existing file-backed workspace once, use `bun run dev:convex --import-files .local/review-instance`. Existing IDs are skipped and source files are retained. `CD80_PORT=3002` selects a different frontend port.

Existing embedded chat histories can be migrated through the trusted `platform.migrateChatStorage` action. It is idempotent and preserves source files and message IDs. Creating threads, saving prompts, renaming, stopping and deleting use controlled Convex mutations. Every tab, including the sender, renders the same subscribed message records. The sidebar delete action confirms removal of a thread, its messages and its associated app.

Generation runs through TanStack AI on the Node server after it claims a saved queued turn. SSE is consumed only for execution status and errors; streaming message text is checkpointed to Convex once per second and flushed when the turn ends. Model context is compacted separately from stored conversation history. Verification, shell tools, external plugin calls and permission-checked app runtime operations continue on Node.

Agent runs have no overall time or iteration cap. Stop cancels a run; sending another message interrupts it and continues from the saved conversation and workspace. The previous writer finishes before the replacement starts. Individual shell/build commands retain resource limits. Consecutive tool calls appear in one expandable activity group between assistant text messages.

`bun run dev:local` remains an explicit file-backed prototype launcher for local development. It does not use Convex.

The launcher reads `apps/web/.env`, root `.env`, then the workspace `../.env`. Non-empty workspace values take precedence. Secrets stay server-side.

```bash
bun run setup:env      # Creates ../.env only when absent, with local secrets
bun run credentials    # Reports variable names, never values
```

Set `GLM_API_KEY` in `../.env` and restart for live specification creation, source generation, iterative changes, and app explanations. `GLM_MODEL=GLM-5.3` and `GLM_BASE_URL=https://ai.gitee.com/v1` select the current Gitee AI provider. TanStack AI uses compatible Chat Completions with reasoning enabled and schema-validated JSON. Set `MODEL_PROVIDER=openai` to use the optional OpenAI Responses fallback.

For Node 24+ using an HTTP proxy, set `NODE_USE_ENV_PROXY=1`, `HTTPS_PROXY`, `HTTP_PROXY`, and `NO_PROXY=127.0.0.1,localhost` before starting. Use your proxy's current URL. These affect this process, not system settings. Connectivity failures are reported in the UI.

## Try the product

1. Start a new chat and describe the app. The thread and prompt are saved in Convex.
2. The agent edits source, runs checks and activates passing changes automatically.
3. Use Preview to interact with the app, or Code to inspect its read-only source tree.
4. Request changes in the same conversation. Failed updates retain the working release and shared data.
5. Register an OpenAPI plugin in Connections. The agent can discover and enable it, and generated apps use the permission-checked SDK to call its operations.

Portfolio, screening and strategy protocols are provisional feasibility examples. Final application categories remain open. Additional compatible apps can be imported and run.

## Source and runtime

Public docs: `/docs` and `/api/docs`. Each new app is an actual TanStack Start project, with `package.json`, `vite.config.ts`, `tsconfig.json`, routes, router, Tailwind stylesheet, local shadcn Nova components and a typed SDK. The agent edits these files through source tools and real Bash commands. The Code tree shows only actual app files, including its framework configuration; platform runner internals stay outside the app.

The finance starter preinstalls TanStack Charts, Table, Form, Virtual, Query and AI/AI React, plus Decimal.js, date-fns, Papa Parse and D3 time scales. Its README records version-specific APIs; `read_starter_reference` exposes that guide and pinned package versions to the builder. Stock shadcn controls are included as source. Run `bun run starter:sync` after editing the starter files, then regenerate Convex bindings.

Standalone `/app/:appId` pages show only the application. Their server-rendered title, description, Open Graph/Twitter tags and canonical URL come from the active specification; the favicon comes from the app's public SVG or its initial. The builder also maintains metadata in the generated app's root route.

Source snapshots and metadata are stored in Convex. The Node platform materializes each app/turn/release in its own checkout and runs the project's standard `bun run build` and `bun run check` commands. Its Vite development server provides the live preview, including SSR, routing and server functions. The project uses pinned, preinstalled dependencies; build-time outbound networking is disabled. Dependency/build caches and environment files are excluded from persisted source. Source limits are 200 files, 200 KB total, and 60 KB per file; JSON uploads remain limited to 250 KB.

Generated configuration, build scripts and server code run inside Bubblewrap user, mount, PID and network namespaces. Only the app checkout, its own temporary directories, runtime binaries and read-only installed packages are mounted. Platform environment variables, credentials, host project files and host networking are unavailable. Processes have time, memory, process-count, file-size and output limits. Linux user namespaces, `bwrap` and `prlimit` are required; unsupported isolation fails closed.

Previews use signed, short-lived, owner-scoped URLs through a Unix-socket proxy. Platform cookies and authorization are stripped before forwarding to the app. An opaque iframe and restrictive CSP keep the existing permission-checked browser SDK bridge: plugin credentials and financial/storage/AI operations remain on the platform. Financial capabilities use trusted functions. Browser logs return to the conversation.

Passing project builds activate automatically; failed builds retain the working release and saved data. Source hashes bind checks to the exact project snapshot. The full framework workspace supersedes the earlier source-bundle compiler; legacy project formats are unsupported.

Nine capabilities cover normalized market data, reusable financial functions, custom calculations, shared storage and managed AI. New providers require adapters. `_provenance` is reserved; edited inputs are labelled user-entered. AI explanations use server-recomputed saved inputs.

## Verification

```bash
bun run codegen             # Requires configured Convex deployment
bun run check
bun run build
```

`bun run examples` exports complete source bundles, schemas and protocol instructions to ignored `.local/examples/`. Documentation downloads assemble examples from the shared starter at runtime.

## Self-hosted deployment

```bash
bun run setup:env             # Creates workspace ../.env with local secrets
bun run dev:hosted             # Smoke-test the Node build with hosted/demo env
bun run deploy:hosted          # Builds and starts docker-compose: app + self-hosted Convex
```

`docker-compose.yml` runs the app (`apps/web/Dockerfile`, a standalone Node server) alongside the
open-source self-hosted Convex backend (`ghcr.io/get-convex/convex-backend`). No Cloudflare account,
Alchemy, or Convex Cloud subscription is required. See [docker-compose.yml](docker-compose.yml) for
first-run setup (generating a Convex admin key, pushing functions).

Self-hosted launchers default to a shared demo without login (`CD80_DEMO_MODE=1`). Set a matching
`PLATFORM_INTERNAL_KEY` and `CD80_DEMO_MODE=1` in your self-hosted Convex deployment too. All visitors
share apps and data. WorkOS stays available for account mode when demo mode is explicitly disabled —
set the `WORKOS_*` variables and point `WORKOS_REDIRECT_URI` at your deployed domain.

For Coolify: point it at this repo with `apps/web/Dockerfile`, add the self-hosted Convex backend as a
second service (same image/env as in `docker-compose.yml`), and set env vars in its UI. For k3s/Argo CD:
translate `docker-compose.yml`'s two services into Deployments/Services/Ingress manifests and an
Argo CD Application pointing at this repo.

### Historical Cloudflare deployment

The prototype was previously deployed at [Chengdu80 studio](https://chengdu80-web-live-ananthacharya-mb7epyiddt4jehqm.chengdu80-1610dcd1.workers.dev) via Cloudflare Workers through Alchemy. That deployment path (`apps/web/alchemy.run.ts`, the `APP_LOADER` Worker Loader binding) has been removed from the codebase in favor of the self-hosted Docker/docker-compose path above; the notes below describe that earlier, now-historical deployment.

Hosted launchers default to a shared demo without login. Set `CD80_DEMO_MODE=1` and matching `PLATFORM_INTERNAL_KEY` in Convex, then generate bindings before deployment. All visitors share apps and data. WorkOS is deferred; the authenticated path remains available when demo mode is explicitly disabled. Dynamic Workers requires a paid Cloudflare account; Alchemy state bootstrap needs additional resource permissions.

The Convex development backend and Cloudflare application are deployed. Fifteen live hosted checks passed for numerical calculations, import, acceptance, updates, persistence, version separation, denied egress, CPU limits and recovery. The portfolio app rendered in the hosted browser. Storage-order hashing and returned-error handling bugs were fixed with regression checks. Live Gitee GLM clarification, explanations, source import, fresh generation and a built-in revision succeeded. The fresh model preview passes all eleven checks and is ready for review; the earlier model revision has been accepted. The latest source-generation trial timed out, so generation reliability remains unresolved. Broader requests and the model apps' rendered UI require further evaluation. Tushare remains unverified. This is a pre-competition prototype using the user's selected GLM-5.3 through Gitee AI. The competition's Qwen development requirement still applies during the competition.

The supplied token and Workers upgrade were sufficient. Deployment from China used the existing HTTP proxy. No GitLab connection or additional Cloudflare credentials are required for the deployed prototype.

## Layout

- `apps/web/src/components`: studio and isolated app frame
- `apps/web/src/lib`: contracts, protocols, calculations and examples
- `apps/web/src/server`: generation, providers, verification, runtime and persistence
- `packages/backend/convex`: hosted account-owned storage
- `apps/web/Dockerfile`, `docker-compose.yml`: self-hosted Node build and deployment stack
- `scripts`: launchers, credential checks, exports and verification
- `patches`: persisted TanStack query-stream fix for closed-stream hydration.
