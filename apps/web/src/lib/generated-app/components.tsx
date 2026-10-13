import type { ReactNode } from "react";
import { useMutation } from "@tanstack/react-query";
import { z } from "zod";
import { Button } from "@web-starter/ui/components/button";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@web-starter/ui/components/card";
import { Alert, AlertTitle, AlertDescription } from "@web-starter/ui/components/alert";
import { Empty, EmptyHeader, EmptyTitle } from "@web-starter/ui/components/empty";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  TableCaption,
} from "@web-starter/ui/components/table";
import { cd80, usePluginOperation, type PluginOperationInput } from "./sdk";

export function MetricCard({
  label,
  value,
  description,
}: {
  label: string;
  value: ReactNode;
  description?: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{label}</CardTitle>
        {description ? <CardDescription>{description}</CardDescription> : null}
      </CardHeader>
      <CardContent>{value}</CardContent>
    </Card>
  );
}

export type DataColumn<T extends Record<string, unknown>> = {
  key: string;
  header: ReactNode;
  render: (row: T) => ReactNode;
};

export function DataTable<T extends Record<string, unknown>>({
  rows,
  columns,
  getRowKey,
  caption,
  emptyMessage = "No rows",
}: {
  rows: readonly T[];
  columns: readonly DataColumn<T>[];
  getRowKey: (row: T) => string;
  caption?: string;
  emptyMessage?: string;
}) {
  return (
    <Table>
      {caption ? <TableCaption>{caption}</TableCaption> : null}
      <TableHeader>
        <TableRow>
          {columns.map((column) => (
            <TableHead key={column.key}>{column.header}</TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={getRowKey(row)}>
            {columns.map((column) => (
              <TableCell key={column.key}>{column.render(row)}</TableCell>
            ))}
          </TableRow>
        ))}
        {rows.length === 0 ? (
          <TableRow>
            <TableCell colSpan={Math.max(1, columns.length)}>
              <Empty>
                <EmptyHeader>
                  <EmptyTitle>{emptyMessage}</EmptyTitle>
                </EmptyHeader>
              </Empty>
            </TableCell>
          </TableRow>
        ) : null}
      </TableBody>
    </Table>
  );
}

export function PluginPanel<T>({
  input,
  schema,
  children,
  title = "API data",
}: {
  input: PluginOperationInput;
  schema: z.ZodType<T>;
  children: (data: T) => ReactNode;
  title?: string;
}) {
  const query = usePluginOperation(input, schema);
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {query.isPending ? <p role="status">Loading API data…</p> : null}
        {query.isError ? (
          <Alert variant="destructive">
            <AlertTitle>API request failed</AlertTitle>
            <AlertDescription>{query.error.message}</AlertDescription>
          </Alert>
        ) : null}
        {query.isSuccess ? children(query.data) : null}
      </CardContent>
    </Card>
  );
}

// The server calculates saved inputs itself; this never fabricates an AI answer.
export function AIExplanationPanel({
  question,
  result,
  title = "AI explanation",
}: {
  question: string;
  result: unknown;
  title?: string;
}) {
  const explanation = useMutation({ mutationFn: () => cd80.explain(question, result) });
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <Button disabled={explanation.isPending} onClick={() => explanation.mutate()}>
          {explanation.isPending ? "Explaining…" : "Explain"}
        </Button>
        {explanation.isError ? (
          <Alert variant="destructive">
            <AlertTitle>Explanation failed</AlertTitle>
            <AlertDescription>{explanation.error.message}</AlertDescription>
          </Alert>
        ) : null}
        {explanation.isSuccess ? <p className="whitespace-pre-wrap">{explanation.data}</p> : null}
      </CardContent>
    </Card>
  );
}
