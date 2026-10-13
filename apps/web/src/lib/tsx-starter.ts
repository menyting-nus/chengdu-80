import type { AppBundle, ProductSpec } from "./contracts";
import { appProjectTemplateFiles } from "./app-project-template";

// Each app starts as a complete TanStack Start checkout. Metadata is persisted
// separately; every displayed file is actual application source/configuration.
export function tsxStarter(spec: ProductSpec): AppBundle {
  return {
    manifest: { schemaVersion: 3, name: spec.name, protocol: spec.protocol, permissions: [] },
    files: { ...appProjectTemplateFiles },
  };
}
