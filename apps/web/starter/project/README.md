# App project

This is a normal TanStack Start, React 19, TypeScript and Tailwind v4 project.
Run `bun run dev`, `bun run build` and `bun run check`. Exact installed versions
are in package.json. Dependencies are preinstalled; the isolated runtime has no
outbound network or package-install step.

## Finance toolkit

- TanStack Charts 1.1: import `defineChart`, `lineY`, `barY` from
  `@tanstack/charts` and `Chart` from `@tanstack/charts/react`. Use
  `definition`, `height` and `ariaLabel` props. Do not use the old react-charts API.
  Compact numeric scales are separate `@tanstack/charts/scales/linear` and
  `@tanstack/charts/scales/band` imports. Time series can use `scaleUtc` from
  `d3-scale`; import `tooltip` from `@tanstack/charts/tooltip` when needed.
  Memoize definitions capturing changing data. Give responsive charts a height.
- TanStack Table 9: use `tableFeatures`, `useTable` and `ColumnDef`. Register
  sorting/filtering features explicitly. Render cells with `table.FlexRender`
  and local shadcn Table primitives. This is v9, not the v8 useReactTable API.
- TanStack Form: `useForm` from `@tanstack/react-form`, with Zod validation and
  local Field/Input primitives for holdings, targets and scenario forms.
- TanStack Virtual: `useVirtualizer` from `@tanstack/react-virtual` for large
  scrollable tables. Give its scroll element a real bounded height.
- TanStack Query: the router already provides QueryClientProvider. Use
  useQuery/useMutation and invalidate affected queries after saving changes.
- Decimal.js: `import Decimal from 'decimal.js'` for exact monetary arithmetic.
  Persist decimal values as strings. Convert to numbers only at chart/platform
  boundaries that require finite numbers, not throughout calculations.
- Date-fns: explicit date parsing/formatting and time interval utilities.
- Papa Parse: `import Papa from 'papaparse'` for CSV parse/unparse. Validate
  parsed rows with Zod. Surface row errors instead of guessing missing values.
  Escape spreadsheet formula cells when exporting untrusted text.
- Intl.NumberFormat provides currency and percentage formatting without an
  additional formatting package.
- TanStack AI and AI React are installed. Provider credentials stay on the
  platform. Use `cd80.explain(question, result)` from `@/lib/cd80` for managed
  financial explanations and declare `ai.explain`; do not call providers directly.

Charts 1.1 and Table 9 APIs are version-specific. Installed package declarations
and Charts' bundled docs are available in node_modules for inspection through
Bash; keep the public file tree limited to project source.

## Platform capabilities and UI

Import the typed SDK from `@/lib/cd80` and reusable capability components from
`@/components/capabilities`. Portfolio valuations, screening and backtests use
trusted platform finance capabilities. OpenAPI plugins are registered by the
system and accessed through the SDK. Declare permissions before using them.
Label synthetic data and actual provider/currency provenance accurately.

Use the actual local shadcn sources in src/components/ui. Tabs, select, dialogs,
checkboxes, sliders, switches, popovers, tooltips and dropdown menus are included.
Financial data libraries provide behavior; shadcn provides the interface.

Maintain app-specific title, description and Open Graph/Twitter metadata in
src/routes/__root.tsx. Add public/favicon.svg for the app's own icon. The standalone
publication derives its top-level metadata from the current specification name
and purpose; keep those accurate. Never use a temporary preview URL as canonical.
