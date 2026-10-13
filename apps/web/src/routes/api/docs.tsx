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
export const Route = createFileRoute("/api/docs")({
  server: {
    handlers: {
      GET: () =>
        Response.json(
          {
            name: "Chengdu80 application contract",
            version: 2,
            sourceFormats: {
              react: 2,
              reactEntry: "src/App.tsx",
              optionalStyles: "src/styles.css",
              componentPaths: "src/components/**/*.tsx or .ts",
              maximumFiles: 44,
              maximumSourceCharacters: 200000,
              fixedDependencies: [
                "react",
                "lucide-react",
                "zod",
                "@tanstack/react-query",
                "@/components/ui/*",
                "@/lib/utils",
                "@cd80/sdk",
                "@cd80/components",
              ],
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
              "React apps import cd80 and typed schemas/hooks from @cd80/sdk. Stock shadcn components use @/components/ui/*; capability components use @cd80/components. The trusted React root signals ready after mounting.",
            privacy:
              "Login is deferred in shared-demo mode: all visitors share apps and data. Authenticated mode scopes apps to their owning account. Preview writes are disabled.",
            import:
              "Upload a JSON bundle containing metadata and React/TSX source files. Metadata is not an editable workspace file; permissions use set_permissions. Source-only import is supported; specification-only import is deferred.",
          },
          { headers: { "cache-control": "public, max-age=300" } },
        ),
    },
  },
});
