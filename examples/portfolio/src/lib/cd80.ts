import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";

type Capability =
  | "storage.read"
  | "storage.write"
  | "plugin.call"
  | "finance.calculate"
  | "finance.portfolio"
  | "finance.screen"
  | "finance.backtest"
  | "market.assets"
  | "market.prices"
  | "ai.explain";

declare global {
  interface Window {
    cd80: { call: (capability: Capability, input: unknown) => Promise<unknown>; ready: () => void };
  }
}

const finite = z.number().finite();
const nonnegative = finite.nonnegative();
const storageKey = z.string().regex(/^[a-zA-Z0-9_-]{1,50}$/);
const jsonValue = z.json();
export const portfolioInputSchema = z.object({
  holdings: z
    .array(
      z.object({ symbol: z.string(), units: nonnegative, cost: nonnegative, price: nonnegative }),
    )
    .max(500),
  cash: nonnegative.default(0),
});
export const portfolioResultSchema = z.object({
  totalValue: finite,
  profit: finite,
  returnPct: finite,
  concentrationPct: finite,
  positions: z.array(
    z.object({ symbol: z.string(), value: finite, invested: finite, weightPct: finite }),
  ),
});
export const screenInputSchema = z.object({
  assets: z
    .array(
      z.object({ symbol: z.string(), pe: finite.nullable(), dividendYield: finite.nullable() }),
    )
    .max(1000),
  maxPE: nonnegative,
  minYield: nonnegative,
});
export const screenResultSchema = z.object({
  selected: z.array(z.string()),
  missing: nonnegative.int(),
});
export const backtestInputSchema = z.object({
  prices: z.array(finite.positive()).min(2).max(10000),
  feeBps: nonnegative.default(0),
});
export const backtestResultSchema = z.object({
  grossReturnPct: finite,
  maxDrawdownPct: finite,
  netReturnPct: finite,
});
export const provenanceSchema = z.object({
  provider: z.string(),
  synthetic: z.boolean(),
  currency: z.string(),
  coverage: z.string(),
  warning: z.string(),
});
export const assetsResultSchema = z.object({
  assets: z.array(
    z.object({
      symbol: z.string(),
      name: z.string(),
      sector: z.string(),
      price: nonnegative,
      pe: finite.nullable(),
      dividendYield: finite.nullable(),
    }),
  ),
  meta: provenanceSchema,
});
export const pricesInputSchema = z.object({
  symbol: z.string(),
  provider: z.enum(["fixtures", "tushare"]).default("fixtures"),
});
export const pricesResultSchema = z.object({
  symbol: z.string(),
  prices: z.array(
    z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), close: finite.positive() }),
  ),
  meta: provenanceSchema,
});
export const pluginInputSchema = z.object({
  pluginId: z.string().min(1),
  operationId: z.string().min(1),
  parameters: z.record(z.string(), jsonValue).default({}),
});
export type PluginOperationInput = z.input<typeof pluginInputSchema>;

async function call(capability: Capability, input: unknown): Promise<unknown> {
  if (typeof window === "undefined" || !window.cd80)
    throw new Error("App capability bridge is unavailable");
  return window.cd80.call(capability, input);
}

// Unknown API/storage values become typed only after the caller's schema validates them.
export const cd80 = {
  call,
  ready: () => window.cd80.ready(),
  storage: {
    async read<T>(key: string, schema: z.ZodType<T>): Promise<T | null> {
      const value = await call("storage.read", { key: storageKey.parse(key) });
      return value === null ? null : schema.parse(value);
    },
    async write(key: string, value: unknown) {
      return z.object({ saved: z.literal(true) }).parse(
        await call("storage.write", {
          key: storageKey.parse(key),
          value: jsonValue.parse(value),
        }),
      );
    },
  },
  plugins: {
    async call(input: PluginOperationInput): Promise<unknown> {
      return call("plugin.call", pluginInputSchema.parse(input));
    },
    async callParsed<T>(input: PluginOperationInput, schema: z.ZodType<T>): Promise<T> {
      return schema.parse(await call("plugin.call", pluginInputSchema.parse(input)));
    },
  },
  finance: {
    async portfolio(input: z.input<typeof portfolioInputSchema>) {
      return portfolioResultSchema.parse(
        await call("finance.portfolio", portfolioInputSchema.parse(input)),
      );
    },
    async screen(input: z.input<typeof screenInputSchema>) {
      return screenResultSchema.parse(await call("finance.screen", screenInputSchema.parse(input)));
    },
    async backtest(input: z.input<typeof backtestInputSchema>) {
      return backtestResultSchema.parse(
        await call("finance.backtest", backtestInputSchema.parse(input)),
      );
    },
    async calculate<T>(input: unknown, schema: z.ZodType<T>): Promise<T> {
      return schema.parse(await call("finance.calculate", jsonValue.parse(input)));
    },
  },
  market: {
    async assets() {
      return assetsResultSchema.parse(await call("market.assets", {}));
    },
    async prices(input: z.input<typeof pricesInputSchema>) {
      return pricesResultSchema.parse(await call("market.prices", pricesInputSchema.parse(input)));
    },
  },
  async explain(question: string, result: unknown) {
    return z.string().parse(
      await call("ai.explain", {
        question: z.string().trim().min(1).max(4000).parse(question),
        result: jsonValue.parse(result),
      }),
    );
  },
};

export function useStoredValue<T>(key: string, schema: z.ZodType<T>) {
  const client = useQueryClient();
  const queryKey = ["cd80", "storage", key] as const;
  const query = useQuery({ queryKey, queryFn: () => cd80.storage.read(key, schema), retry: false });
  const write = useMutation({
    mutationFn: (value: T) => cd80.storage.write(key, schema.parse(value)),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey });
    },
  });
  return { query, write };
}

// The server enforces GET/HEAD for cached queries. Writes use usePluginMutation.
export function usePluginOperation<T>(input: PluginOperationInput, schema: z.ZodType<T>) {
  return useQuery({
    queryKey: ["cd80", "plugin", input.pluginId, input.operationId, input.parameters ?? {}],
    queryFn: async () =>
      schema.parse(
        await call("plugin.call", { ...pluginInputSchema.parse(input), readOnly: true }),
      ),
    enabled: Boolean(input.pluginId && input.operationId),
    retry: false,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
}

export function usePluginMutation<T>(
  input: Pick<PluginOperationInput, "pluginId" | "operationId">,
  schema: z.ZodType<T>,
) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (parameters: PluginOperationInput["parameters"]) =>
      cd80.plugins.callParsed({ ...input, parameters }, schema),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ["cd80", "plugin", input.pluginId] });
    },
  });
}
