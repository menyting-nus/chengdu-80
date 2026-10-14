import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig, lazyPlugins } from "vite-plus";

export default defineConfig({
  base: process.env.APP_BASE_PATH ?? "/",
  server: { hmr: false },
  resolve: { tsconfigPaths: true },
  plugins: lazyPlugins(() => [tailwindcss(), tanstackStart(), viteReact()]),
  fmt: { ignorePatterns: ["src/routeTree.gen.ts"] },
  lint: {
    ignorePatterns: ["src/routeTree.gen.ts"],
    options: { typeAware: true, typeCheck: true },
  },
});
