import type { AppBundle, ProductSpec } from "./contracts";
import { sampleBundle } from "./samples";

// Compiler entry, dependencies, SDK and shadcn sources are supplied by the platform.
// Editable TSX is stored separately from the compiled browser assets.
export function tsxStarter(spec: ProductSpec): AppBundle {
  const base = sampleBundle(spec);
  return {
    manifest: { ...base.manifest, schemaVersion: 2 },
    files: {
      "index.html": '<div id="root"></div>',
      "app.js": "// React entry is compiled by the platform.",
      "calculations.js": base.files["calculations.js"],
      "style.css": "",
      "src/App.tsx": `import { Empty, EmptyHeader, EmptyTitle } from '@/components/ui/empty';

export default function App() {
  return <Empty className="min-h-screen"><EmptyHeader><EmptyTitle>Start building your app</EmptyTitle></EmptyHeader></Empty>;
}
`,
    },
  };
}
