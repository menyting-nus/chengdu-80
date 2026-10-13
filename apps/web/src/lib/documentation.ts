import type { Root } from "fumadocs-core/page-tree";

export const documentation = [
  {
    slug: "",
    title: "Build an app. Bring its source.",
    navigation: "Overview",
    description: "The Chengdu80 application contract and developer reference.",
    toc: [
      { title: "Getting started", url: "#getting-started", depth: 2 },
      { title: "Reference", url: "#reference", depth: 2 },
    ],
  },
  {
    slug: "source",
    title: "Source format",
    navigation: "Source format",
    description: "React/TSX starter, legacy browser bundles, permissions and import limits.",
    toc: [],
  },
  {
    slug: "sdk",
    title: "Browser SDK",
    navigation: "Browser SDK",
    description: "Typed React capabilities and the isolated browser message bridge.",
    toc: [],
  },
  {
    slug: "capabilities",
    title: "Capability catalog",
    navigation: "Capabilities",
    description: "Market data, calculations, storage, and managed AI.",
    toc: [],
  },
  {
    slug: "protocols",
    title: "Application protocols",
    navigation: "Protocols",
    description: "Calculation rules and independent verification fixtures.",
    toc: [
      { title: "Portfolio analysis", url: "#portfolio", depth: 2 },
      { title: "Asset screening", url: "#screening", depth: 2 },
      { title: "Strategy comparison", url: "#strategy", depth: 2 },
    ],
  },
  {
    slug: "verification",
    title: "Release checks",
    navigation: "Verification",
    description: "How source code is checked before automatic activation.",
    toc: [],
  },
  {
    slug: "plugins",
    title: "OpenAPI plugins",
    navigation: "Plugins",
    description: "System registration, AI tools, and app runtime API calls.",
    toc: [],
  },
  {
    slug: "conversation",
    title: "Conversation agent",
    navigation: "Conversation agent",
    description: "Persistent streamed conversations and workspace tools.",
    toc: [],
  },
  {
    slug: "privacy",
    title: "Privacy and updates",
    navigation: "Privacy and updates",
    description: "Workspace access, preview isolation, and retained app data.",
    toc: [],
  },
];

export function documentationUrl(slug: string) {
  return slug ? `/docs/${slug}` : "/docs";
}

export const documentationTree: Root = {
  name: "Chengdu80",
  children: documentation.map((page) => ({
    type: "page",
    name: page.navigation,
    url: documentationUrl(page.slug),
  })),
};
