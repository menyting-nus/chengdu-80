import { randomUUID } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { request as httpsRequest } from "node:https";
import { request as httpRequest } from "node:http";
import { parse as parseYaml } from "yaml";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@web-starter/backend/convex/_generated/api";
import {
  pluginRegistrationSchema,
  type PluginOperation,
  type PluginRegistration,
  type RegisteredPlugin,
  type StoredPlugin,
} from "../lib/plugins";
import type { Access } from "./repository";
import { demoMode, demoOwnerId, localMode, settings } from "./settings";

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Expected an OpenAPI object");
  return value as Record<string, unknown>;
}
function privateAddress(address: string) {
  if (isIP(address) === 6)
    return (
      !/^2[0-9a-f]{3}:/i.test(address) ||
      address.startsWith("2002:") ||
      /^2001:(0?db8|0{1,4}|0?10|0?20):/i.test(address)
    );
  const [a = 0, b = 0] = address.split(".").map(Number);
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a >= 224 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && (b === 168 || b === 0)) ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 198 && (b === 18 || b === 19 || b === 51)) ||
    (a === 203 && b === 0)
  );
}
// Resolve once, reject private networks, and pin the socket to that address. Never follow redirects.
async function remote(
  url: URL,
  method = "GET",
  headers: Record<string, string> = {},
  body?: string,
) {
  const config = await settings();
  const fixture = (await localMode()) && config.CD80_PLUGIN_TEST_ORIGIN === url.origin;
  if ((!fixture && url.protocol !== "https:") || url.username || url.password || url.hash)
    throw new Error("Plugins require a public HTTPS URL without credentials or fragments");
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = await lookup(hostname, { all: true });
  if (!addresses.length || (!fixture && addresses.some((entry) => privateAddress(entry.address))))
    throw new Error("Private network plugin URLs are blocked");
  const pinned = addresses[0]!;
  return new Promise<string>((resolve, reject) => {
    const req = (url.protocol === "https:" ? httpsRequest : httpRequest)(
      url,
      {
        method,
        headers,
        family: pinned.family,
        lookup: (_host, _options, callback) => callback(null, pinned.address, pinned.family),
      },
      (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > 1000000) res.destroy(new Error("Plugin response exceeds 1 MB"));
          else chunks.push(chunk);
        });
        res.on("error", reject);
        res.on("end", () => {
          if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300)
            reject(new Error(`Plugin request failed (${res.statusCode ?? "unknown"})`));
          else resolve(Buffer.concat(chunks).toString("utf8"));
        });
      },
    );
    const timer = setTimeout(() => req.destroy(new Error("Plugin request timed out")), 15000);
    req.on("close", () => clearTimeout(timer));
    req.on("error", reject);
    req.end(body);
  });
}
let queue: Promise<unknown> = Promise.resolve();
async function storage(access: Access, plugin?: StoredPlugin): Promise<StoredPlugin[]> {
  if (!(await localMode())) {
    const config = await settings();
    if (!config.VITE_CONVEX_URL || !config.PLATFORM_INTERNAL_KEY)
      throw new Error("Hosted plugin storage is not configured");
    const client = new ConvexHttpClient(config.VITE_CONVEX_URL);
    if (access.accessToken) client.setAuth(access.accessToken);
    const demo = await demoMode();
    if (demo && access.ownerId !== demoOwnerId) throw new Error("Invalid demo workspace");
    const serialized = await client.action(api.platform.plugins, {
      serverKey: config.PLATFORM_INTERNAL_KEY,
      demo,
      payload: plugin ? JSON.stringify(plugin) : undefined,
    });
    return serialized.map((value) => object(JSON.parse(value)) as StoredPlugin);
  }
  const task = queue.then(async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const dir = (await settings()).CD80_DATA_DIR ?? path.resolve(process.cwd(), "../../.local");
    await fs.mkdir(dir, { recursive: true, mode: 0o700 });
    const file = path.join(dir, "plugins.json");
    let entries: StoredPlugin[] = [];
    try {
      entries = JSON.parse(await fs.readFile(file, "utf8"));
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
    }
    if (plugin) {
      entries.push(plugin);
      await fs.writeFile(file + ".tmp", JSON.stringify(entries), { mode: 0o600 });
      await fs.rename(file + ".tmp", file);
    }
    return entries.filter((entry) => entry.ownerId === access.ownerId);
  });
  queue = task.catch(() => {});
  return task;
}
function publicPlugin(plugin: StoredPlugin): RegisteredPlugin {
  const { id, name, baseUrl, operations, authenticated } = plugin;
  return { id, name, baseUrl, operations, authenticated };
}
export async function listPlugins(access: Access) {
  return (await storage(access)).map(publicPlugin);
}
export async function registerPlugin(access: Access, input: PluginRegistration) {
  const registration = pluginRegistrationSchema.parse(input);
  const text = registration.document ?? (await remote(new URL(registration.schemaUrl!)));
  const doc = object(parseYaml(text));
  if (typeof doc.openapi !== "string" || !doc.openapi.startsWith("3."))
    throw new Error("Only OpenAPI 3 JSON or YAML documents are supported");
  function resolve(value: unknown, depth = 0): Record<string, unknown> {
    const schema = object(value);
    if (!schema.$ref) return schema;
    if (depth > 16 || typeof schema.$ref !== "string" || !schema.$ref.startsWith("#/"))
      throw new Error("Only non-recursive local OpenAPI references are supported");
    let target: unknown = doc;
    for (const part of schema.$ref.slice(2).split("/"))
      target = object(target)[part.replaceAll("~1", "/").replaceAll("~0", "~")];
    return resolve(target, depth + 1);
  }
  function schema(value: unknown, depth = 0): Record<string, unknown> {
    if (depth > 16) throw new Error("Recursive plugin schemas are unsupported");
    const result = { ...resolve(value) };
    if (result.properties)
      result.properties = Object.fromEntries(
        Object.entries(object(result.properties)).map(([key, value]) => [
          key,
          schema(value, depth + 1),
        ]),
      );
    if (result.items) result.items = schema(result.items, depth + 1);
    if (result.oneOf || result.anyOf || result.allOf)
      throw new Error("Combined plugin schemas are unsupported");
    return result;
  }
  const servers = doc.servers;
  if (!Array.isArray(servers) || !servers.length)
    throw new Error("OpenAPI servers[0].url is required");
  const serverUrl = object(servers[0]).url;
  if (typeof serverUrl !== "string") throw new Error("OpenAPI server URL must be a string");
  const baseUrl = serverUrl;
  const base = new URL(baseUrl);
  if (base.search || base.hash || baseUrl.includes("{"))
    throw new Error("Server variables, query strings and fragments are unsupported");
  // Validate without making an API call.
  const fixture = (await localMode()) && (await settings()).CD80_PLUGIN_TEST_ORIGIN === base.origin;
  if ((!fixture && base.protocol !== "https:") || base.username || base.password)
    throw new Error("A public HTTPS API server is required");
  const addresses = await lookup(base.hostname.replace(/^\[|\]$/g, ""), { all: true });
  if (!addresses.length || (!fixture && addresses.some((entry) => privateAddress(entry.address))))
    throw new Error("Private network plugin URLs are blocked");
  let auth: StoredPlugin["auth"];
  const schemes = doc.components ? object(object(doc.components).securitySchemes ?? {}) : {};
  const operations: PluginOperation[] = [];
  for (const [path, rawPath] of Object.entries(object(doc.paths))) {
    if (
      !path.startsWith("/") ||
      path.startsWith("//") ||
      path.includes("..") ||
      /[?#\\]/.test(path)
    )
      throw new Error("Invalid plugin operation path");
    const item = resolve(rawPath);
    for (const method of ["get", "post", "put", "patch", "delete", "head"]) {
      if (!item[method]) continue;
      const operation = resolve(item[method]);
      if (item.servers || operation.servers)
        throw new Error("Per-operation servers are unsupported");
      const parameters: PluginOperation["parameters"] = [];
      for (const raw of [
        ...(Array.isArray(item.parameters) ? item.parameters : []),
        ...(Array.isArray(operation.parameters) ? operation.parameters : []),
      ]) {
        const parameter = resolve(raw);
        if (!["path", "query", "header"].includes(String(parameter.in)))
          throw new Error("Unsupported parameter location");
        if (
          typeof parameter.name !== "string" ||
          /^(host|authorization|cookie|connection|content-length|transfer-encoding)$/i.test(
            parameter.name,
          )
        )
          throw new Error("Reserved or invalid plugin parameter");
        parameters.push({
          name: parameter.name,
          location: parameter.in as "path" | "query" | "header",
          required: parameter.required === true,
          schema: schema(parameter.schema ?? { type: "string" }),
        });
      }
      if (operation.requestBody) {
        const body = resolve(operation.requestBody);
        const content = object(body.content);
        if (!content["application/json"]) throw new Error("Only JSON request bodies are supported");
        parameters.push({
          name: "body",
          location: "body",
          required: body.required === true,
          schema: schema(object(content["application/json"]).schema ?? { type: "object" }),
        });
      }
      const security = operation.security ?? doc.security;
      if (Array.isArray(security) && security.length) {
        if (security.length !== 1 || Object.keys(object(security[0])).length !== 1)
          throw new Error("Use one API key or bearer security scheme");
        const key = Object.keys(object(security[0]))[0]!;
        const scheme = resolve(schemes[key]);
        const next =
          scheme.type === "http" && scheme.scheme === "bearer"
            ? { location: "header" as const, name: "Authorization", prefix: "Bearer " }
            : scheme.type === "apiKey" &&
                ["header", "query"].includes(String(scheme.in)) &&
                typeof scheme.name === "string"
              ? { location: scheme.in as "header" | "query", name: scheme.name, prefix: "" }
              : undefined;
        if (
          !next ||
          /^(host|cookie|connection|content-length|transfer-encoding)$/i.test(next.name) ||
          (auth && JSON.stringify(auth) !== JSON.stringify(next))
        )
          throw new Error("Unsupported or inconsistent plugin authentication");
        auth = next;
      }
      const operationId =
        typeof operation.operationId === "string"
          ? operation.operationId
          : `${method}_${path.replace(/[^a-zA-Z0-9]/g, "_")}`;
      if (operations.some((entry) => entry.operationId === operationId))
        throw new Error("Duplicate operationId");
      operations.push({
        operationId,
        method: method.toUpperCase(),
        path,
        description: (typeof operation.summary === "string"
          ? operation.summary
          : typeof operation.description === "string"
            ? operation.description
            : ""
        ).slice(0, 2000),
        parameters,
      });
    }
  }
  if (!operations.length || operations.length > 100)
    throw new Error("Plugin must contain 1–100 operations");
  if (auth && !registration.credentialEnv)
    throw new Error("Authenticated APIs require a server credential environment variable");
  if (registration.credentialEnv && !(await settings())[registration.credentialEnv])
    throw new Error("Plugin credential environment variable is not configured");
  const plugin: StoredPlugin = {
    id: randomUUID(),
    ownerId: access.ownerId,
    name: registration.name,
    baseUrl,
    operations,
    authenticated: !!auth,
    auth,
    credentialEnv: registration.credentialEnv,
  };
  await storage(access, plugin);
  return publicPlugin(plugin);
}
function validate(value: unknown, schema: Record<string, unknown>, name: string) {
  if (schema.enum && Array.isArray(schema.enum) && !schema.enum.includes(value))
    throw new Error(`Invalid ${name}`);
  const type = schema.type;
  if (type === "string" && (typeof value !== "string" || value.length > 10000))
    throw new Error(`Invalid ${name}`);
  if (
    (type === "number" || type === "integer") &&
    (typeof value !== "number" ||
      !Number.isFinite(value) ||
      (type === "integer" && !Number.isInteger(value)))
  )
    throw new Error(`Invalid ${name}`);
  if (
    typeof value === "number" &&
    ((typeof schema.minimum === "number" && value < schema.minimum) ||
      (typeof schema.maximum === "number" && value > schema.maximum))
  )
    throw new Error(`Out of range ${name}`);
  if (
    typeof value === "string" &&
    ((typeof schema.minLength === "number" && value.length < schema.minLength) ||
      (typeof schema.maxLength === "number" && value.length > schema.maxLength))
  )
    throw new Error(`Invalid length ${name}`);
  if (type === "boolean" && typeof value !== "boolean") throw new Error(`Invalid ${name}`);
  if (type === "array") {
    if (!Array.isArray(value) || value.length > 1000) throw new Error(`Invalid ${name}`);
    for (const entry of value) validate(entry, object(schema.items ?? {}), name);
  }
  if (type === "object") {
    const data = object(value);
    const properties = object(schema.properties ?? {});
    for (const key of Array.isArray(schema.required) ? schema.required : [])
      if (typeof key === "string" && data[key] === undefined)
        throw new Error(`Missing ${name}.${key}`);
    for (const [key, entry] of Object.entries(data)) {
      if (properties[key]) validate(entry, object(properties[key]), `${name}.${key}`);
      else if (schema.additionalProperties === false) throw new Error(`Unknown ${name}.${key}`);
    }
  }
}
function scalarString(value: unknown): string {
  if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean")
    throw new Error("Plugin URL and header parameters must be scalar values");
  return String(value);
}
export async function callPlugin(
  access: Access,
  pluginId: string,
  operationId: string,
  parameters: Record<string, unknown>,
  readOnly = false,
): Promise<unknown> {
  const plugin = (await storage(access)).find((entry) => entry.id === pluginId);
  const operation = plugin?.operations.find((entry) => entry.operationId === operationId);
  if (!plugin || !operation) throw new Error("Registered plugin operation not found");
  if (readOnly && operation.method !== "GET" && operation.method !== "HEAD")
    throw new Error(
      "Plugin queries require a GET or HEAD operation. Use an explicit mutation for writes.",
    );
  for (const key of Object.keys(parameters))
    if (!operation.parameters.some((parameter) => parameter.name === key))
      throw new Error(`Unknown plugin parameter: ${key}`);
  let path = operation.path;
  const query = new URLSearchParams();
  const headers: Record<string, string> = { Accept: "application/json" };
  let body: string | undefined;
  for (const parameter of operation.parameters) {
    const value = parameters[parameter.name];
    if (value === undefined) {
      if (parameter.required || parameter.location === "path")
        throw new Error(`Missing plugin parameter: ${parameter.name}`);
      continue;
    }
    validate(value, parameter.schema, parameter.name);
    if (parameter.location === "body") {
      body = JSON.stringify(value);
      headers["Content-Type"] = "application/json";
    } else if (parameter.location === "path") {
      if (scalarString(value) === "." || scalarString(value) === "..")
        throw new Error("Invalid path parameter");
      path = path.replaceAll(`{${parameter.name}}`, encodeURIComponent(scalarString(value)));
    } else if (parameter.location === "query") {
      for (const entry of Array.isArray(value) ? value : [value])
        query.append(parameter.name, scalarString(entry));
    } else headers[parameter.name] = scalarString(value);
  }
  if (path.includes("{") || (body && body.length > 250000))
    throw new Error("Invalid plugin request");
  if (plugin.auth && plugin.credentialEnv) {
    const credential = (await settings())[plugin.credentialEnv];
    if (!credential) throw new Error("Plugin credentials are unavailable");
    if (plugin.auth.location === "query") query.set(plugin.auth.name, credential);
    else headers[plugin.auth.name] = plugin.auth.prefix + credential;
  }
  const url = new URL(plugin.baseUrl.replace(/\/$/, "") + path);
  url.search = query.toString();
  const result = await remote(url, operation.method, headers, body);
  const credential = plugin.credentialEnv ? (await settings())[plugin.credentialEnv] : undefined;
  try {
    return JSON.parse(credential ? result.replaceAll(credential, "[redacted]") : result);
  } catch {
    throw new Error("Plugin response must be JSON");
  }
}
