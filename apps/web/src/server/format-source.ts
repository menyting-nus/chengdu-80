import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

// Format a display copy with the same Oxfmt formatter used by Vite+.
// This never reads files or changes a release's source or verification hash.
export const formatSource = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      fileName: z
        .string()
        .max(300)
        .regex(/^(?:[\w$().[\]-]+\/)*[\w$().[\]-]+\.(?:tsx?|[cm]?js|html|css|jsonc?)$/)
        .refine((name) => !name.split("/").some((segment) => segment === "." || segment === "..")),
      content: z.string().max(250000),
    }),
  )
  .handler(async ({ data }) => {
    const { format } = await import("oxfmt");
    const result = await format(data.fileName, data.content, { printWidth: 80, tabWidth: 2 });
    // Invalid source must still be inspectable in the read-only viewer.
    return result.errors.length ? data.content : result.code;
  });
