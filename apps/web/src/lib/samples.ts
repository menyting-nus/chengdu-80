import { appProjectTemplateFiles } from "./app-project-template";
import { capabilityContracts, protocolFor, type AppBundle, type ProductSpec } from "./contracts";

export function sampleBundle(spec: ProductSpec): AppBundle {
  const protocol = spec.protocol;
  const inputSchema =
    protocol === "portfolio"
      ? "portfolioInputSchema"
      : protocol === "screening"
        ? "screenInputSchema"
        : "backtestInputSchema";
  const method =
    protocol === "portfolio" ? "portfolio" : protocol === "screening" ? "screen" : "backtest";
  const metrics =
    protocol === "portfolio"
      ? `<MetricCard label="Total value · CNY" value={format(result.totalValue)} /><MetricCard label="Unrealized profit · CNY" value={format(result.profit)} /><MetricCard label="Return" value={format(result.returnPct) + '%'} /><MetricCard label="Largest position" value={format(result.concentrationPct) + '%'} />`
      : protocol === "screening"
        ? `<MetricCard label="Matching assets" value={result.selected.length} /><MetricCard label="Maximum PE" value={inputs.query.data.maxPE} /><MetricCard label="Minimum yield" value={inputs.query.data.minYield + '%'} /><MetricCard label="Missing records" value={result.missing} />`
        : `<MetricCard label="Gross return" value={format(result.grossReturnPct) + '%'} /><MetricCard label="Net return" value={format(result.netReturnPct) + '%'} /><MetricCard label="Max drawdown" value={format(result.maxDrawdownPct) + '%'} /><MetricCard label="Price observations" value={inputs.query.data.prices.length} />`;
  const details =
    protocol === "portfolio"
      ? `<DataTable caption="Portfolio positions" rows={result.positions} getRowKey={(row) => row.symbol} columns={[
        {key:'symbol',header:'Position',render:row=>row.symbol},
        {key:'value',header:'Value · CNY',render:row=>format(row.value)},
        {key:'invested',header:'Invested · CNY',render:row=>format(row.invested)},
        {key:'weight',header:'Weight',render:row=>format(row.weightPct)+'%'},
      ]} />`
      : protocol === "screening"
        ? `<DataTable caption="Asset shortlist" rows={inputs.query.data.assets} getRowKey={(row) => row.symbol} columns={[
          {key:'symbol',header:'Asset',render:row=>row.symbol},
          {key:'pe',header:'PE',render:row=>row.pe??'Missing'},
          {key:'yield',header:'Dividend yield',render:row=>row.dividendYield===null?'Missing':row.dividendYield+'%'},
          {key:'status',header:'Result',render:row=>result.selected.includes(row.symbol)?'Matches':'Excluded'},
        ]} />`
        : `<DataTable caption="Historical price observations" rows={inputs.query.data.prices.map((price,index)=>({index,price}))} getRowKey={(row)=>String(row.index)} columns={[
          {key:'index',header:'Observation',render:row=>row.index+1},
          {key:'price',header:'Price',render:row=>format(row.price)},
        ]} /><p>Cash benchmark: 0% return. Fees use a simple two-transaction approximation at {inputs.query.data.feeBps} bps per transaction.</p>`;
  return {
    manifest: {
      schemaVersion: 3,
      name: spec.name,
      protocol,
      permissions: [
        "finance.calculate",
        "storage.read",
        "storage.write",
        "ai.explain",
        `finance.${method}`,
      ],
    },
    files: {
      ...appProjectTemplateFiles,
      "src/App.tsx": `import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import { cd80, useStoredValue, ${inputSchema} } from '@/lib/cd80';
import { MetricCard, DataTable, AIExplanationPanel } from '@/components/capabilities';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Field, FieldLabel, FieldGroup } from '@/components/ui/field';

const spec = ${JSON.stringify({ name: spec.name, purpose: spec.purpose })};
const sourceSchema = z.object({ provider:z.string(),synthetic:z.boolean(),currency:z.string().optional(),coverage:z.string().optional(),warning:z.string() });
${protocol === "screening" ? "" : "const format = (value:number) => value.toLocaleString('en-US',{maximumFractionDigits:2});"}

export default function App() {
  const inputs = useStoredValue('inputs',${inputSchema});
  const provenance = useStoredValue('_provenance',sourceSchema);
  const [draft,setDraft] = useState('');
  const [validationError,setValidationError] = useState('');
  useEffect(()=>{if(inputs.query.data) setDraft(JSON.stringify(inputs.query.data,null,2));},[inputs.query.data]);
  const analysis = useQuery({
    queryKey:['analysis',inputs.query.data],
    queryFn:()=>cd80.finance.${method}(${inputSchema}.parse(inputs.query.data)),
    enabled:inputs.query.isSuccess && inputs.query.data!==null,
    retry:false,
  });
  function save() {
    try {
      const value:unknown = JSON.parse(draft);
      const parsed = ${inputSchema}.parse(value);
      setValidationError('');
      inputs.write.mutate(parsed);
    } catch(error) { setValidationError(error instanceof Error ? error.message : 'Invalid inputs'); }
  }
  const result = analysis.data;
  const error = inputs.query.error ?? provenance.query.error ?? analysis.error ?? inputs.write.error;
  return <main className="flex flex-col gap-6 p-6">
    <header><h1 className="text-3xl font-semibold">{spec.name}</h1><p>{spec.purpose}</p></header>
    {provenance.query.data ? <Alert><AlertTitle>{provenance.query.data.provider}</AlertTitle><AlertDescription>{provenance.query.data.currency} · {provenance.query.data.coverage} · {provenance.query.data.synthetic ? 'Synthetic fixtures. ' : ''}{provenance.query.data.warning}</AlertDescription></Alert> : null}
    {error || validationError ? <Alert variant="destructive"><AlertTitle>Unable to complete request</AlertTitle><AlertDescription>{validationError || error?.message}</AlertDescription></Alert> : null}
    {inputs.query.isPending || analysis.isFetching ? <p role="status">Loading financial data…</p> : null}
    {inputs.query.isSuccess && inputs.query.data===null ? <p>No saved financial inputs.</p> : null}
    {result && inputs.query.data ? <>
      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">${metrics}</section>
      ${details}
      <AIExplanationPanel question="Explain these verified results in plain English. Disclose data limits and avoid recommendations." result={result} />
    </> : null}
    <Card><CardHeader><CardTitle>Edit shared inputs</CardTitle></CardHeader><CardContent>
      <FieldGroup><Field><FieldLabel htmlFor="financial-inputs">Shared financial inputs</FieldLabel><Textarea id="financial-inputs" value={draft} onChange={event=>setDraft(event.target.value)} className="min-h-60" /></Field>
      <Field><Button disabled={inputs.write.isPending || !inputs.query.data} onClick={save}>{inputs.write.isPending?'Saving…':'Save and recalculate'}</Button></Field></FieldGroup>
    </CardContent></Card>
    <footer>Historical and sample analysis. No investment advice.</footer>
  </main>;
}
`,
    },
  };
}

export function protocolInstructions(spec: ProductSpec) {
  return `Application protocol ${spec.protocol}, version 3.\n${protocolFor(spec.protocol).rules.join("\n")}\nFinancial math runs in fixed platform capabilities, never in generated source. Use cd80.finance.portfolio, cd80.finance.screen, cd80.finance.backtest or cd80.finance.calculate(input,resultSchema) from @/lib/cd80 when needed, declaring each capability used. This does not require financial UI for general sites. Public capability contracts: ${JSON.stringify(capabilityContracts)}. Use the actual TanStack Start checkout: package.json scripts bun run dev/build/check, src/routes for pages, src/router.tsx, src/styles.css and local shadcn/UI source. Generated server code runs in an isolated workspace; the platform capability bridge provides privileged operations in the browser. Keep metadata permissions in set_permissions, not a source file. Normal local imports and project configuration are supported. Use stock Nova shadcn UI. SDK storage.read(key,zodSchema) validates persisted values and returns null when absent; useStoredValue(key,schema) returns {query,write}. Inputs use the 'inputs' key. Read '_provenance' and show actual provider, synthetic status, currency, coverage and warnings when displaying financial data. System-registered plugins use cd80.plugins.callParsed({pluginId,operationId,parameters},zodSchema); never invent plugin data. No direct network APIs, external imports, macros, secrets or dependency installation. Build the actual product with typed components and server capabilities.`;
}
