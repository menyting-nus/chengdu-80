import type { AppBundle, ProductSpec } from "./contracts";

// Compiler entry, dependencies, SDK and shadcn sources are supplied by the platform.
// Editable TSX is stored separately from the compiled browser assets.
export function tsxStarter(spec: ProductSpec): AppBundle {
  return {
    manifest: { schemaVersion: 2, name: spec.name, protocol: spec.protocol, permissions: [] },
    files: {
      "src/App.tsx": `import { Empty, EmptyHeader, EmptyTitle } from '@/components/ui/empty';

export default function App() {
  return <Empty className="min-h-screen"><EmptyHeader><EmptyTitle>Start building your app</EmptyTitle></EmptyHeader></Empty>;
}
`,
    },
  };
}
