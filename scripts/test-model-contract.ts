import assert from "node:assert/strict";
import { createServer } from "node:http";
import { protocols } from "../apps/web/src/lib/contracts";
import { sampleBundle } from "../apps/web/src/lib/samples";
import { clarify, generate, explain } from "../apps/web/src/server/models";

// A local transport fixture checks SDK wiring. It does not prove live model access.
const spec = protocols[0]!.defaultSpec;
const bundle = sampleBundle(spec);
bundle.files["src/styles.css"] = "";
const requests: any[] = [];
const server = createServer(async (req, res) => {
  assert.equal(req.url, "/v1/responses");
  assert.equal(req.headers.authorization, "Bearer local-test-placeholder");
  let body = "";
  for await (const chunk of req) body += chunk;
  const request = JSON.parse(body);
  requests.push(request);
  assert.equal(request.model, "gpt-6-luna");
  const schema = request.text?.format?.schema;
  const text = schema
    ? JSON.stringify(schema.properties?.manifest ? bundle : spec)
    : "Fixture explanation of verified calculations.";
  const response = {
    id: "resp_fixture",
    object: "response",
    status: "completed",
    model: "gpt-6-luna",
    output: [
      {
        id: "msg_fixture",
        type: "message",
        role: "assistant",
        status: "completed",
        content: [{ type: "output_text", text, annotations: [] }],
      },
    ],
    usage: { input_tokens: 10, output_tokens: 10, total_tokens: 20 },
  };
  if (request.stream) {
    res.writeHead(200, { "content-type": "text/event-stream" });
    for (const event of [
      { type: "response.created", response: { ...response, status: "in_progress", output: [] } },
      {
        type: "response.output_item.added",
        output_index: 0,
        item: { ...response.output[0], content: [] },
      },
      {
        type: "response.output_text.delta",
        item_id: "msg_fixture",
        output_index: 0,
        content_index: 0,
        delta: text,
      },
      { type: "response.completed", response },
    ])
      res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
    res.end();
  } else {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(response));
  }
});
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
assert.ok(address && typeof address !== "string");
const original = { ...process.env };
Object.assign(process.env, {
  CD80_LOCAL_MODE: "1",
  MODEL_PROVIDER: "openai",
  OPENAI_API_KEY: "local-test-placeholder",
  OPENAI_MODEL: "gpt-6-luna",
  OPENAI_BASE_URL: `http://127.0.0.1:${address.port}/v1`,
});
try {
  assert.deepEqual(await clarify("Build a portfolio analysis app"), spec);
  console.log("PASS Luna Responses transport returns a schema-validated specification");
  assert.deepEqual(await generate(spec, "Build the confirmed app"), bundle);
  assert.ok(requests.some((r) => JSON.stringify(r).includes("finance.portfolio")));
  console.log("PASS Builder sends capability contracts and validates the returned source bundle");
  assert.equal(
    await explain("Explain the result", { totalValue: 500 }),
    "Fixture explanation of verified calculations.",
  );
  console.log("PASS Deployed-app explanation uses the configured Responses adapter");
  console.log("3 local model transport checks passed. Live OpenAI calls remain unverified.");
} finally {
  for (const key of [
    "CD80_LOCAL_MODE",
    "MODEL_PROVIDER",
    "OPENAI_API_KEY",
    "OPENAI_MODEL",
    "OPENAI_BASE_URL",
  ]) {
    if (original[key] === undefined) delete process.env[key];
    else process.env[key] = original[key];
  }
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}
