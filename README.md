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

`bun run dev:local` remains an explicit file-backed prototype launcher for isolated fixture tests. It does not use Convex.

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

Public docs: `/docs` and `/api/docs`. New apps use a React-only source format: `src/App.tsx`, optional `src/styles.css` and nested `src/components/*.tsx` or `.ts` files. Titles, protocols and capability permissions are system metadata in Convex, managed by agent tools rather than source files. The AI writes real TypeScript/JSX rather than a composition-only configuration. The platform supplies React, Tailwind v4, shadcn Nova, TanStack Query, Zod, Lucide icons, the typed `@cd80/sdk` and reusable `@cd80/components`. It supplies the React root and QueryClientProvider too. Code shows the app source alongside a read-only `starter/` tree containing the exact shadcn TSX, Tailwind preset, SDK, entry template, compiler, dependency manifests and lockfile used by the installed starter. These are source files, not compiled JS/CSS; environment files and host paths are never exposed.

A fixed worker run by Bun typechecks and bundles these sources with the existing Vite toolchain before activation. It parses browser source without importing or running generated code on the server. The worker receives a scrubbed environment, approved imports and a fixed build configuration; arbitrary packages, macros, dynamic imports and compiler directives are rejected. Builds run serially with a 60-second deadline. This is a bounded compiler subprocess, not an OS sandbox or a separate container per app.

Source and data stay in Convex. Compiled JS/CSS are cached on Node and served through an ownership-checked asset endpoint; they are rebuilt from verified source after restart. Legacy bundle formats are unsupported. JSON bundle uploads contain React source and system metadata, up to 250 KB; format 2 permits at most 44 source files and 200 KB of source.

Browser apps run in opaque-origin iframes with restrictive CSP and a permission-checked `cd80.call()` bridge. Financial capabilities use trusted platform functions; generated code executes only in the browser. App sources, releases and shared data are in Convex.

Releases require source policy, metadata consistency, credential-pattern, TypeScript and compilation checks. Browser smoke tests separately verify actual React rendering, SDK calls, shadcn styling and iframe networking restrictions; compilation alone does not certify rendered behavior. SHA-256 binds checks to exact source. Passing establishes the tested protocol contract, not certification of every additional calculation or the full specification. Review custom logic and rendered previews.

Nine capabilities cover normalized market data, reusable financial functions, custom calculations, shared storage and managed AI. New providers require adapters. `_provenance` is reserved; edited inputs are labelled user-entered. AI explanations use server-recomputed saved inputs.

## Verification

With the local Convex-backed dev server running and an existing generated conversation, `bun run test:convex` checks normalized storage, migration, access checks, direct mutations, reactive messages across two Chrome tabs, transport failure recovery and thread deletion. It also verifies that client-bound SSE text cannot override the Convex transcript. It makes one live model call and writes screenshots/results to `.local/convex-tests/`. Set `PLAYWRIGHT_CHROMIUM_EXECUTABLE` when using an existing Chrome installation.

```bash
bun scripts/test-tsx.ts      # React/shadcn browser E2E; build first with VITE_LOCAL_MODE=1
bun run test:prototype       # Fixed financial functions, source hash/policy and persistence checks
bun run test:flow            # 13 HTTP lifecycle checks on temporary data
bun run test:model-contract  # 3 mock Responses transport checks, not live inference
bun run test:glm-contract    # 10 mock GLM format/recovery/deadline checks
bun run test:query-stream    # 2 query-stream hydration regressions
bun run check
bun run build
bun run codegen             # Requires configured Convex deployment
bun run deploy:backend      # Loads workspace credentials; development deployments only
```

Lifecycle tests do not modify workspace apps. `bun run examples` regenerates bundles, split source, schemas and protocol instructions.

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
- `patches`: persisted TanStack query-stream fix; `bun run test:query-stream` checks closed-stream hydration. GLM malformed JSON gets one format recovery within its existing deadline, checked by `bun run test:glm-contract`.
