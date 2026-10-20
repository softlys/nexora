/**
 * Builds the OpenAPI 3.1 document for /api/v1 from the Zod schemas in contract.ts.
 * Named schemas (`.meta({ id })`) become components; everything else is inlined.
 */
import { z } from "zod";
import { SCOPE_DESCRIPTIONS, API_SCOPES } from "./keys";
import { ENDPOINTS, errorEnvelope, type Endpoint } from "./contract";

type Json = Record<string, unknown>;

/** Converts a schema, moving its $defs into `components` and rewriting the refs. */
function toSchema(schema: z.ZodType, io: "input" | "output", components: Record<string, Json>): Json {
  const raw = z.toJSONSchema(schema, { io, unrepresentable: "any" }) as Json;
  const defs = (raw.$defs ?? {}) as Record<string, Json>;
  delete raw.$defs;
  delete raw.$schema;
  const rewrite = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(rewrite);
    if (value && typeof value === "object") {
      const out: Json = {};
      for (const [k, v] of Object.entries(value as Json)) {
        out[k] = k === "$ref" && typeof v === "string" ? v.replace("#/$defs/", "#/components/schemas/") : rewrite(v);
      }
      return out;
    }
    return value;
  };
  for (const [name, def] of Object.entries(defs)) components[name] ??= rewrite(def) as Json;
  // A named top-level schema becomes a component too.
  const id = z.globalRegistry.get(schema)?.id;
  const body = rewrite(raw) as Json;
  if (id) {
    components[id] ??= body;
    return { $ref: `#/components/schemas/${id}` };
  }
  return body;
}

const ERROR_RESPONSES: Record<string, string> = {
  "400": "Invalid input (validation_failed, invalid_json)",
  "401": "Missing, invalid or revoked API key (unauthorized), or an invalid signature (signature_invalid)",
  "403": "The key lacks the required scope (insufficient_scope)",
  "409": "Idempotency-Key reused with a different request, or a conflicting state",
  "413": "Body larger than 64 KB",
  "429": "Rate limit exceeded; see Retry-After",
};

function operation(e: Endpoint, components: Record<string, Json>): Json {
  const op: Json = {
    operationId: `${e.method.toLowerCase()}${e.path.replace(/[^a-z]+(.)?/gi, (_, c: string | undefined) => (c ? c.toUpperCase() : ""))}`,
    summary: e.summary,
    description: e.scope ? `${e.description}\n\nRequired scope: \`${e.scope}\`.` : e.description,
    tags: [e.tag],
    security: e.scope ? [{ apiKey: [e.scope] }] : [],
  };
  const parameters: Json[] = [];
  if (e.query) {
    const schema = toSchema(e.query, "input", components) as { properties?: Record<string, Json>; required?: string[] };
    for (const [name, prop] of Object.entries(schema.properties ?? {})) {
      parameters.push({ name, in: "query", required: (schema.required ?? []).includes(name) && prop.default === undefined, description: prop.description, schema: prop });
    }
  }
  if (e.idempotent) {
    parameters.push({ name: "Idempotency-Key", in: "header", required: false, description: "Repeat a POST safely: the same key and body return the stored response for 24 hours.", schema: { type: "string", maxLength: 200 } });
  }
  if (e.path === "/events") {
    parameters.push(
      { name: "X-Nexora-Integration", in: "header", required: false, description: "Integration whose signing secret signed this request: make, n8n or generic_webhook.", schema: { type: "string", enum: ["make", "n8n", "generic_webhook"] } },
      { name: "X-Nexora-Signature", in: "header", required: false, description: "t=<unix seconds>,v1=<hex HMAC-SHA256(secret, \"<t>.<raw body>\")>. Required when X-Nexora-Integration is sent.", schema: { type: "string" } },
    );
  }
  if (parameters.length) op.parameters = parameters;
  if (e.body) {
    const content: Json = { schema: toSchema(e.body, "input", components) };
    if (e.example?.request) content.example = e.example.request;
    op.requestBody = { required: true, content: { "application/json": content } };
  }
  const success: Json = { schema: toSchema(e.response, "output", components) };
  if (e.example?.response) success.example = e.example.response;
  const responses: Json = { [String(e.status)]: { description: "Success", content: { "application/json": success } } };
  const errorCodes = e.scope ? ["400", "401", "403", "409", "413", "429"].filter((c) => e.body || e.query || !["400", "409", "413"].includes(c)) : [];
  for (const code of errorCodes) responses[code] = { $ref: `#/components/responses/E${code}` };
  if (e.scope) responses["500"] = { $ref: "#/components/responses/E500" };
  op.responses = responses;
  return op;
}

export function buildOpenApi(serverUrl = "/api/v1"): Json {
  const components: Record<string, Json> = {};
  const paths: Record<string, Json> = {};
  for (const e of ENDPOINTS) {
    paths[e.path] ??= {};
    (paths[e.path] as Json)[e.method.toLowerCase()] = operation(e, components);
  }
  const errorRef = toSchema(errorEnvelope, "output", components);
  const responses: Json = {};
  for (const [code, description] of Object.entries({ ...ERROR_RESPONSES, "500": "Unexpected error; the response carries a request_id for support" })) {
    responses[`E${code}`] = { description, content: { "application/json": { schema: errorRef } } };
  }
  return {
    openapi: "3.1.0",
    info: {
      title: "NEXORA API",
      version: "1.0.0",
      description:
        "Public API of NEXORA. Authenticate with an organization API key created in Settings → API keys: `Authorization: Bearer nxk_…`. Responses use `{ data, meta }`; errors use `{ error: { code, message, details, request_id } }`. Rate limit: 120 requests per minute per key.",
    },
    servers: [{ url: serverUrl }],
    tags: [
      { name: "System" },
      { name: "Leads" },
      { name: "Records" },
      { name: "Events" },
      { name: "Security", description: "For the companion SIEM. Requires a SIEM key." },
    ],
    paths,
    components: {
      schemas: components,
      responses,
      securitySchemes: {
        apiKey: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "nxk_<kind>_<prefix>_<secret>",
          description: `Scopes: ${API_SCOPES.map((s) => `\`${s}\` (${SCOPE_DESCRIPTIONS[s]})`).join("; ")}`,
        },
      },
    },
  };
}
