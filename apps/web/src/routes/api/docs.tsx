import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import {
  bundleSchema,
  capabilities,
  capabilityContracts,
  protocols,
  specSchema,
} from "../../lib/contracts";
import { protocolInstructions } from "../../lib/samples";
import starterPackage from "../../../starter/project/package.json";
export const Route = createFileRoute("/api/docs")({
  server: {
    handlers: {
      GET: () =>
        Response.json(
          {
            name: "Chengdu80 application contract",
            version: 3,
            project: {
              framework: "TanStack Start",
              indexRoute: "src/routes/index.tsx",
              rootRoute: "src/routes/__root.tsx",
              appComponent: "src/App.tsx",
              styles: "src/styles.css",
              sdk: "src/lib/cd80.ts",
              ui: "src/components/ui/",
              scripts: starterPackage.scripts,
              dependencies: starterPackage.dependencies,
              devDependencies: starterPackage.devDependencies,
            },
            sourceBundleSchema: z.toJSONSchema(bundleSchema),
            productSpecSchema: z.toJSONSchema(specSchema),
            capabilities,
            capabilityContracts,
            protocols: protocols.map((p) => ({
              ...p,
              instructions: protocolInstructions(p.defaultSpec),
            })),
            browserSDK:
              "Import cd80 and typed schemas/hooks from @/lib/cd80. Actual shadcn components live in src/components/ui; capability components use @/components/capabilities. The TanStack root route reports readiness after hydration.",
            privacy:
              "Login is deferred in shared-demo mode: all visitors share apps and data. Authenticated mode scopes apps to their owning account. Active apps can write shared data through declared platform capabilities; failed builds cannot activate.",
            import:
              "Upload a JSON bundle containing metadata and React/TSX source files. Metadata is not an editable workspace file; permissions use set_permissions. Source-only import is supported; specification-only import is deferred.",
          },
          { headers: { "cache-control": "public, max-age=300" } },
        ),
    },
  },
});
