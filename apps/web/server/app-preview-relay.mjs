import { spawn } from "node:child_process";
import http from "node:http";
import { unlink } from "node:fs/promises";

const socket = "/control/preview.sock";
await unlink(socket).catch(() => {});
const child = spawn(
  "/runtime/bun",
  ["run", "dev", "--host", "127.0.0.1", "--port", "4173", "--strictPort"],
  {
    cwd: "/project",
    stdio: ["ignore", "inherit", "inherit"],
  },
);
const server = http.createServer((request, response) => {
  const upstream = http.request(
    {
      hostname: "127.0.0.1",
      port: 4173,
      path: request.url,
      method: request.method,
      // The platform validates the signed preview grant before using this private
      // socket. Start sees the relay as its same-origin client; opaque iframe
      // origins and platform credentials are never forwarded to generated code.
      headers: {
        ...request.headers,
        host: "127.0.0.1:4173",
        origin: "http://127.0.0.1:4173",
        "sec-fetch-site": "same-origin",
      },
    },
    (incoming) => {
      response.writeHead(incoming.statusCode ?? 502, incoming.headers);
      incoming.pipe(response);
    },
  );
  upstream.on("error", () => {
    if (!response.headersSent) response.writeHead(503, { "content-type": "text/plain" });
    response.end("Preview server is starting");
  });
  request.pipe(upstream);
  request.on("aborted", () => upstream.destroy());
  response.on("close", () => upstream.destroy());
});
server.listen(socket);
child.on("error", (error) => {
  console.error(error.message);
  process.exit(1);
});
child.on("exit", (code) => {
  server.close();
  process.exit(code ?? 1);
});
for (const signal of ["SIGTERM", "SIGINT"])
  process.on(signal, () => {
    child.kill(signal);
    server.close();
  });
