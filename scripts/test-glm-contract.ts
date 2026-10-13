import assert from "node:assert/strict";
import { createServer } from "node:http";
import { clarify, generate, explain, boundedModelRequest } from "../apps/web/src/server/models";
import { protocols } from "../apps/web/src/lib/contracts";
import { sampleBundle } from "../apps/web/src/lib/samples";

const spec = protocols[0]!.defaultSpec;
const bundle = sampleBundle(spec);
const sourceReply = {
  manifest: bundle.manifest,
  files: { "src/App.tsx": bundle.files["src/App.tsx"], "src/styles.css": "" },
};
const requests: any[] = [];
let invalid = false;
let fenced = false;
let trailingText = false;
let compactFence = false;
let malformedResponses = 0;
const server = createServer(async (req, res) => {
  assert.equal(req.url, "/v1/chat/completions");
  assert.equal(req.headers.authorization, "Bearer glm-local-fixture");
  let raw = "";
  for await (const chunk of req) raw += chunk;
  const body = JSON.parse(raw);
  requests.push(body);
  assert.equal(body.model, "GLM-5.3");
  assert.deepEqual(body.thinking, { type: "enabled" });
  const generating = body.messages.some((message: any) => message.content.includes('"manifest"'));
  const json = body.response_format
    ? JSON.stringify(invalid ? { invalid: true } : generating ? sourceReply : spec)
    : "Explanation of verified calculations.";
  let text = fenced
    ? "```json\n" +
      json +
      (compactFence ? "```" : "\n```") +
      (trailingText ? "\nUntrusted trailing prose" : "")
    : json;
  if (malformedResponses > 0) {
    malformedResponses--;
    text = text.slice(0, -10);
  }
  const base = { id: "glm-fixture", object: "chat.completion.chunk", created: 1, model: "GLM-5.3" };
  if (body.stream) {
    res.writeHead(200, { "content-type": "text/event-stream" });
    for (const delta of [
      { role: "assistant", reasoning_content: "Fixture reasoning." },
      { content: text },
    ])
      res.write(
        "data: " +
          JSON.stringify({ ...base, choices: [{ index: 0, delta, finish_reason: null }] }) +
          "\n\n",
      );
    res.write(
      "data: " +
        JSON.stringify({ ...base, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] }) +
        "\n\n",
    );
    res.end("data: [DONE]\n\n");
  } else {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        ...base,
        object: "chat.completion",
        choices: [
          { index: 0, message: { role: "assistant", content: text }, finish_reason: "stop" },
        ],
      }),
    );
  }
});
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
assert.ok(address && typeof address !== "string");
const previous = { ...process.env };
Object.assign(process.env, {
  CD80_LOCAL_MODE: "1",
  MODEL_PROVIDER: "glm",
  GLM_API_KEY: "glm-local-fixture",
  GLM_MODEL: "GLM-5.3",
  GLM_BASE_URL: `http://127.0.0.1:${address.port}/v1`,
});
try {
  assert.deepEqual(await clarify("Build a portfolio analysis app"), spec);
  assert.deepEqual(requests[0].response_format, { type: "json_object" });
  assert.equal(requests[0].reasoning_effort, "low");
  console.log("PASS GLM clarification uses Chat Completions, enabled reasoning and validated JSON");
  assert.deepEqual(await generate(spec, "Build the app"), bundle);
  assert.equal(requests[1].reasoning_effort, "low");
  assert.equal(requests[1].max_tokens, 12288);
  assert.ok(JSON.stringify(requests[1]).includes("finance.portfolio"));
  console.log("PASS GLM generation sends protocol/schema contracts with a bounded token budget");
  assert.equal(
    await explain("Explain it", { totalValue: 500 }),
    "Explanation of verified calculations.",
  );
  assert.equal(requests[2].reasoning_effort, "low");
  assert.equal(requests[2].response_format, undefined);
  console.log("PASS GLM explanation separates reasoning from answer content");
  invalid = true;
  await assert.rejects(() => clarify("Build an app"));
  console.log("PASS Invalid GLM JSON cannot become a product specification");
  invalid = false;
  fenced = true;
  assert.deepEqual(await generate(spec, "Build the app"), bundle);
  console.log("PASS Provider-fenced JSON is unwrapped and validated against the source contract");
  compactFence = true;
  assert.deepEqual(await generate(spec, "Build the app"), bundle);
  console.log("PASS A complete compact JSON fence does not require a closing newline");
  trailingText = true;
  await assert.rejects(() => generate(spec, "Build the app"));
  console.log("PASS Prose outside a JSON wrapper is rejected rather than extracted loosely");
  trailingText = false;
  malformedResponses = 1;
  const beforeRecovery = requests.length;
  assert.deepEqual(await generate(spec, "Update the app"), bundle);
  assert.equal(requests.length - beforeRecovery, 2);
  console.log(
    "PASS An incomplete model bundle gets one format recovery without accepting broken source",
  );
  malformedResponses = 3;
  const beforeFailure = requests.length;
  await assert.rejects(() => generate(spec, "Update the app"), /incomplete or invalid JSON/);
  assert.equal(requests.length - beforeFailure, 2);
  malformedResponses = 0;
  console.log("PASS Repeated malformed source stops after one recovery attempt");
  let cancelled = false;
  await assert.rejects(
    () =>
      boundedModelRequest(
        (controller) =>
          new Promise((_resolve, reject) => {
            controller.signal.addEventListener("abort", () => {
              cancelled = true;
              reject(new Error("Transport cancelled"));
            });
          }),
        20,
      ),
    /Model request exceeded/,
  );
  assert.equal(cancelled, true);
  assert.equal(await boundedModelRequest(async () => "complete", 20), "complete");
  console.log("PASS Stalled model calls are cancelled at the deadline; normal calls still finish");
  console.log(
    "10 GLM transport/deadline checks passed using local fixtures; live access is a separate check.",
  );
} finally {
  for (const key of [
    "CD80_LOCAL_MODE",
    "MODEL_PROVIDER",
    "GLM_API_KEY",
    "GLM_MODEL",
    "GLM_BASE_URL",
  ])
    if (previous[key] === undefined) delete process.env[key];
    else process.env[key] = previous[key];
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
    server.closeAllConnections();
  });
}
