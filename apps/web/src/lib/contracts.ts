import type { UIMessage } from "@tanstack/ai";
import { z } from "zod";

export const capabilities = [
  "market.prices",
  "market.assets",
  "finance.calculate",
  "finance.portfolio",
  "finance.screen",
  "finance.backtest",
  "storage.read",
  "storage.write",
  "ai.explain",
  "plugin.call",
] as const;
export const protocolIds = ["portfolio", "screening", "strategy"] as const;
export type ProtocolId = (typeof protocolIds)[number];
export const capabilityContracts = {
  "plugin.call": {
    input:
      "{pluginId:string, operationId:string, parameters:object}. Only system-registered plugins enabled for this app.",
    output: "JSON response from the plugin operation. Provider credentials stay on the server.",
  },
  "market.prices": {
    input: "{symbol:string, provider:'fixtures'|'tushare'}",
    output:
      "{symbol, prices:[{date:'YYYY-MM-DD',close:number}], meta:{provider,synthetic,currency,coverage,warning}}",
  },
  "market.assets": {
    input: "{}",
    output:
      "{assets:[{symbol,name,sector,price,pe:number|null,dividendYield:number|null}],meta:{provider,synthetic,currency,coverage,warning}}",
  },
  "finance.calculate": {
    input: "Selected protocol input object",
    output: "Your calculations.js analyze(input) result",
  },
  "finance.portfolio": {
    input:
      "{holdings:[{symbol,units,cost,price}],cash:number}. Cost and price are CNY per unit; units is the quantity held.",
    output:
      "{totalValue,profit,returnPct,concentrationPct,positions:[{symbol,value,invested,weightPct}]}",
  },
  "finance.screen": {
    input:
      "{assets:[{symbol,pe:number|null,dividendYield:number|null}],maxPE:number,minYield:number}",
    output: "{selected:string[],missing:number}",
  },
  "finance.backtest": {
    input: "{prices:number[],feeBps:number}",
    output: "{grossReturnPct,maxDrawdownPct,netReturnPct}",
  },
  "storage.read": {
    input: "{key:string}",
    output: "JSON value or null. The initial key 'inputs' contains default protocol inputs.",
  },
  "storage.write": {
    input: "{key:string,value:JSON}",
    output: "{saved:true}. Active verified releases only; failed builds cannot write.",
  },
  "ai.explain": {
    input: "{question:string,result:JSON}",
    output: "String explanation of server-calculated saved inputs. Model configuration required.",
  },
};
export const specSchema = z
  .object({
    name: z.string().min(3).max(80),
    purpose: z.string().min(10).max(4000),
    protocol: z.enum(protocolIds),
    inputs: z.array(z.string().max(300)).min(1).max(12),
    outputs: z.array(z.string().max(300)).min(1).max(12),
    constraints: z.array(z.string().max(500)).min(1).max(20),
  })
  .strict();
export type ProductSpec = z.infer<typeof specSchema>;
export const bundleSchema = z
  .object({
    manifest: z
      .object({
        schemaVersion: z.literal(1),
        name: z.string().min(3).max(80),
        protocol: z.enum(protocolIds),
        permissions: z.array(z.enum(capabilities)).max(10),
      })
      .strict(),
    files: z
      .object({
        "index.html": z.string().min(20).max(60000),
        "app.js": z.string().min(10).max(60000),
        "calculations.js": z.string().min(10).max(30000),
        "style.css": z.string().max(30000),
      })
      .strict(),
  })
  .strict();
export type AppBundle = z.infer<typeof bundleSchema>;
export type Check = { name: string; passed: boolean; detail: string };
export type Verification = {
  passed: boolean;
  checks: Check[];
  checkedAt: string;
  sourceHash: string;
};
export type Release = {
  id: string;
  bundle: AppBundle;
  spec: ProductSpec;
  verification: Verification;
  createdAt: string;
  origin: "sample" | "model" | "import";
  notes: string;
};
export type Application = {
  id: string;
  ownerId: string;
  revision: number;
  name: string;
  spec: ProductSpec;
  current: Release | null;
  preview: Release | null;
  data: Record<string, unknown>;
  history: Release[];
  events: { at: string; message: string }[];
  createdAt: string;
  chatTitle?: string;
  conversation?: UIMessage[];
  workspace?: AppBundle;
  workspaceSpec?: ProductSpec;
  browserEvents?: { releaseId: string; at: string; message: string }[];
  enabledPlugins?: string[];
  turns?: {
    id: string;
    startedAt: string;
    completedAt?: string;
    status: "queued" | "running" | "complete" | "stopped" | "error";
  }[];
  agentTurn?: {
    id: string;
    startedAt: string;
    completedAt?: string;
    status: "queued" | "running" | "complete" | "stopped" | "error";
  };
};
export type Protocol = {
  id: ProtocolId;
  name: string;
  description: string;
  rules: string[];
  workflow: string[];
  fixture: { input: unknown; expected: Record<string, unknown> };
  defaultSpec: ProductSpec;
};

export const protocols: Protocol[] = [
  {
    id: "portfolio",
    name: "Portfolio analysis",
    description: "Understand holdings, profit, and concentration.",
    rules: [
      "Use units × price for each position. Total value includes cash.",
      "Holdings cost and price are CNY per unit, not total position amounts. Each invested position cost is units × cost; total invested cost is the sum of those position costs.",
      "Profit excludes cash and equals position value minus invested cost.",
      "returnPct is profit / invested cost × 100; zero cost returns 0.",
      "concentrationPct is the largest single position value / total value × 100. Cash is not a position.",
      "Reject negative units, costs, prices, or cash and non-finite numbers. Explain assumptions and show currency.",
    ],
    workflow: ["Holdings + market prices", "Valuation + concentration", "Portfolio dashboard"],
    fixture: {
      input: {
        holdings: [
          { symbol: "AAA", units: 2, cost: 100, price: 120 },
          { symbol: "BBB", units: 1, cost: 200, price: 180 },
        ],
        cash: 80,
      },
      expected: { totalValue: 500, profit: 20, returnPct: 5, concentrationPct: 48 },
    },
    defaultSpec: {
      name: "Portfolio lens",
      purpose:
        "Analyze an equity portfolio, compare invested cost with current value, and show concentration risk.",
      protocol: "portfolio",
      inputs: [
        "Holdings with symbol, units, cost per unit, and current price per unit",
        "Cash balance in CNY",
      ],
      outputs: [
        "Total value and profit",
        "Return percentage",
        "Position weights and concentration",
      ],
      constraints: [
        "CNY reporting",
        "Shared app data",
        "No trading or investment advice",
        "Label synthetic prices",
      ],
    },
  },
  {
    id: "screening",
    name: "Asset screening",
    description: "Find assets using transparent financial filters.",
    rules: [
      "Keep assets whose PE is positive and at most maxPE, and dividendYield is at least minYield.",
      "Missing, null, and non-finite PE or yield exclude the asset. Never turn missing values into zero.",
      "Return selected as an array of symbols. Explain the criteria and excluded records.",
      "PE is a ratio; dividendYield is a percentage, not a fraction.",
    ],
    workflow: ["Asset fundamentals", "PE + dividend filters", "Ranked shortlist"],
    fixture: {
      input: {
        assets: [
          { symbol: "AAA", pe: 12, dividendYield: 3 },
          { symbol: "BBB", pe: 25, dividendYield: 2 },
          { symbol: "CCC", pe: null, dividendYield: 5 },
        ],
        maxPE: 20,
        minYield: 2,
      },
      expected: { selected: ["AAA"] },
    },
    defaultSpec: {
      name: "Value finder",
      purpose:
        "Screen a small asset universe using valuation and dividend criteria, with reasons for inclusion and exclusion.",
      protocol: "screening",
      inputs: ["Asset fundamentals", "Maximum PE and minimum dividend yield"],
      outputs: ["Matching symbols", "Financial comparison table", "Missing-data warnings"],
      constraints: [
        "Exclude missing fundamentals",
        "Display provider and coverage",
        "No buy or sell recommendations",
      ],
    },
  },
  {
    id: "strategy",
    name: "Strategy comparison",
    description: "Compare historical returns and drawdowns.",
    rules: [
      "Use at least two strictly positive finite chronological prices.",
      "grossReturnPct equals (last / first - 1) × 100.",
      "Maximum drawdown is the greatest peak-to-subsequent-trough percentage drop.",
      "netReturnPct subtracts two transactions of feeBps / 100 percentage points from grossReturnPct. This simple fee approximation must be disclosed.",
      "Historical performance is not a forecast. No look-ahead or fabricated prices.",
    ],
    workflow: ["Historical price series", "Returns + drawdown + fees", "Comparison report"],
    fixture: {
      input: { prices: [100, 110, 99, 108.9], feeBps: 10 },
      expected: { grossReturnPct: 8.9, maxDrawdownPct: 10, netReturnPct: 8.7 },
    },
    defaultSpec: {
      name: "Strategy lab",
      purpose:
        "Compare buy-and-hold performance with cash, showing historical return, maximum drawdown, and a simple fee estimate.",
      protocol: "strategy",
      inputs: ["Chronological daily close prices", "Transaction fee in basis points"],
      outputs: ["Gross and net return", "Maximum drawdown", "Historical performance chart"],
      constraints: [
        "No look-ahead",
        "Disclose fee approximation",
        "Historical results only",
        "Do not claim predictive returns",
      ],
    },
  },
];
export function protocolFor(id: ProtocolId) {
  return protocols.find((p) => p.id === id)!;
}
export function getSuggestedSpec(prompt: string): ProductSpec {
  const protocol = /screen|dividend|valuation|cheap|p\/e/i.test(prompt)
    ? "screening"
    : /strategy|backtest|drawdown|historical/i.test(prompt)
      ? "strategy"
      : "portfolio";
  return {
    ...protocolFor(protocol).defaultSpec,
    purpose:
      prompt.trim().length >= 10
        ? prompt.trim().slice(0, 4000)
        : protocolFor(protocol).defaultSpec.purpose,
  };
}
