// Adapted from Cloudflare VibeSDK's Monaco editor (MIT).
// https://github.com/cloudflare/vibesdk/blob/9da158d/src/components/monaco-editor/monaco-editor.tsx
// Copyright (c) 2025 Cloudflare. License: third-party/vibesdk.LICENSE.
import * as monaco from "monaco-editor/editor/editor.api";
import "monaco-editor/languages/definitions/javascript/register.js";
import "monaco-editor/languages/definitions/typescript/register.js";
import "monaco-editor/languages/definitions/css/register.js";
import "monaco-editor/languages/definitions/html/register.js";
import "monaco-editor/language/json/monaco.contribution";
import EditorWorker from "monaco-editor/editor/editor.worker?worker";
import JsonWorker from "monaco-editor/language/json/json.worker?worker";
import { vesperTheme } from "./vesper-theme";

self.MonacoEnvironment = {
  getWorker(_workerId, label) {
    return label === "json" ? new JsonWorker() : new EditorWorker();
  },
};
monaco.editor.defineTheme("vesper", vesperTheme);

export function mountSourceViewer(
  container: HTMLElement,
  path: string,
  fileName: string,
  content: string,
) {
  const language = /\.(?:tsx?|mts)$/.test(fileName)
    ? "typescript"
    : fileName.endsWith(".json") || fileName.endsWith("bun.lock")
      ? "json"
      : fileName.endsWith(".css")
        ? "css"
        : fileName.endsWith(".html")
          ? "html"
          : "javascript";
  const model = monaco.editor.createModel(
    content,
    language,
    monaco.Uri.parse(`inmemory://source/${crypto.randomUUID()}/${path}`),
  );
  const editor = monaco.editor.create(container, {
    model,
    readOnly: true,
    domReadOnly: true,
    editContext: false,
    automaticLayout: true,
    minimap: { enabled: false },
    lineNumbers: "on",
    fontSize: 13,
    scrollBeyondLastLine: false,
    cursorBlinking: "solid",
    renderValidationDecorations: "off",
    stickyScroll: { enabled: false },
    ariaLabel: `${fileName} source (read-only)`,
    theme: document.documentElement.classList.contains("dark") ? "vesper" : "vs",
  });
  const themeObserver = new MutationObserver(() => {
    editor.updateOptions({
      theme: document.documentElement.classList.contains("dark") ? "vesper" : "vs",
    });
  });
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  return () => {
    themeObserver.disconnect();
    editor.setModel(null);
    editor.dispose();
    // Detach before disposing so outstanding worker callbacks can finish.
    window.setTimeout(() => {
      if (!model.isDisposed()) model.dispose();
    }, 0);
  };
}
