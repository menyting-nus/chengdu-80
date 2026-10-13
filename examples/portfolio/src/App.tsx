import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { cd80, useStoredValue, portfolioInputSchema } from "@cd80/sdk";
import { MetricCard, DataTable, AIExplanationPanel } from "@cd80/components";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Field, FieldLabel, FieldGroup } from "@/components/ui/field";

const spec = {
  name: "Portfolio lens",
  purpose:
    "Analyze an equity portfolio, compare invested cost with current value, and show concentration risk.",
};
const sourceSchema = z.object({
  provider: z.string(),
  synthetic: z.boolean(),
  currency: z.string().optional(),
  coverage: z.string().optional(),
  warning: z.string(),
});
const format = (value: number) => value.toLocaleString("en-US", { maximumFractionDigits: 2 });

export default function App() {
  const inputs = useStoredValue("inputs", portfolioInputSchema);
  const provenance = useStoredValue("_provenance", sourceSchema);
  const [draft, setDraft] = useState("");
  const [validationError, setValidationError] = useState("");
  useEffect(() => {
    if (inputs.query.data) setDraft(JSON.stringify(inputs.query.data, null, 2));
  }, [inputs.query.data]);
  const analysis = useQuery({
    queryKey: ["analysis", inputs.query.data],
    queryFn: () => cd80.finance.portfolio(portfolioInputSchema.parse(inputs.query.data)),
    enabled: inputs.query.isSuccess && inputs.query.data !== null,
    retry: false,
  });
  function save() {
    try {
      const value: unknown = JSON.parse(draft);
      const parsed = portfolioInputSchema.parse(value);
      setValidationError("");
      inputs.write.mutate(parsed);
    } catch (error) {
      setValidationError(error instanceof Error ? error.message : "Invalid inputs");
    }
  }
  const result = analysis.data;
  const error =
    inputs.query.error ?? provenance.query.error ?? analysis.error ?? inputs.write.error;
  return (
    <main className="flex flex-col gap-6 p-6">
      <header>
        <h1 className="text-3xl font-semibold">{spec.name}</h1>
        <p>{spec.purpose}</p>
      </header>
      {provenance.query.data ? (
        <Alert>
          <AlertTitle>{provenance.query.data.provider}</AlertTitle>
          <AlertDescription>
            {provenance.query.data.currency} · {provenance.query.data.coverage} ·{" "}
            {provenance.query.data.synthetic ? "Synthetic fixtures. " : ""}
            {provenance.query.data.warning}
          </AlertDescription>
        </Alert>
      ) : null}
      {error || validationError ? (
        <Alert variant="destructive">
          <AlertTitle>Unable to complete request</AlertTitle>
          <AlertDescription>{validationError || error?.message}</AlertDescription>
        </Alert>
      ) : null}
      {inputs.query.isPending || analysis.isFetching ? (
        <p role="status">Loading financial data…</p>
      ) : null}
      {inputs.query.isSuccess && inputs.query.data === null ? (
        <p>No saved financial inputs.</p>
      ) : null}
      {result && inputs.query.data ? (
        <>
          <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <MetricCard label="Total value · CNY" value={format(result.totalValue)} />
            <MetricCard label="Unrealized profit · CNY" value={format(result.profit)} />
            <MetricCard label="Return" value={format(result.returnPct) + "%"} />
            <MetricCard label="Largest position" value={format(result.concentrationPct) + "%"} />
          </section>
          <DataTable
            caption="Portfolio positions"
            rows={result.positions}
            getRowKey={(row) => row.symbol}
            columns={[
              { key: "symbol", header: "Position", render: (row) => row.symbol },
              { key: "value", header: "Value · CNY", render: (row) => format(row.value) },
              { key: "invested", header: "Invested · CNY", render: (row) => format(row.invested) },
              { key: "weight", header: "Weight", render: (row) => format(row.weightPct) + "%" },
            ]}
          />
          <AIExplanationPanel
            question="Explain these verified results in plain English. Disclose data limits and avoid recommendations."
            result={result}
          />
        </>
      ) : null}
      <Card>
        <CardHeader>
          <CardTitle>Edit shared inputs</CardTitle>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="financial-inputs">Shared financial inputs</FieldLabel>
              <Textarea
                id="financial-inputs"
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                className="min-h-60"
              />
            </Field>
            <Field>
              <Button disabled={inputs.write.isPending || !inputs.query.data} onClick={save}>
                {inputs.write.isPending ? "Saving…" : "Save and recalculate"}
              </Button>
            </Field>
          </FieldGroup>
        </CardContent>
      </Card>
      <footer>Historical and sample analysis. No investment advice.</footer>
    </main>
  );
}
