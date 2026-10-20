import { ArrowLeft, FileJson } from "lucide-react";
import Link from "next/link";
import { PageHeader } from "@/components/patterns/page-header";
import { ENDPOINTS } from "@/domain/api/contract";
import { API_SCOPES, SCOPE_DESCRIPTIONS } from "@/domain/api/keys";
import { requirePermission } from "@/server/guards";

export const metadata = { title: "API reference" };

const ERRORS: Array<[string, string, string]> = [
  ["400", "validation_failed / invalid_json", "Body or query does not match the schema; details lists each field."],
  ["401", "unauthorized", "Missing, malformed, unknown or revoked key, or the key's creator was disabled."],
  ["401", "signature_invalid", "X-Nexora-Integration was sent but X-Nexora-Signature does not verify."],
  ["403", "insufficient_scope / forbidden", "The key lacks the scope, or its creator's role does not allow the action."],
  ["404", "not_found", "The record does not exist or is outside the key owner's scope."],
  ["409", "idempotency_key_reused / conflict", "Same Idempotency-Key with a different body, or a conflicting state."],
  ["413", "payload_too_large", "Body larger than 64 KB."],
  ["429", "rate_limited", "120 requests per minute per key; see Retry-After."],
];

function curl(e: (typeof ENDPOINTS)[number]): string {
  const lines = [`curl -X ${e.method} "$NEXORA_URL/api/v1${e.path}"`];
  if (e.scope) lines.push(`  -H "Authorization: Bearer $NEXORA_API_KEY"`);
  if (e.body) {
    lines.push(`  -H "Content-Type: application/json"`);
    if (e.idempotent) lines.push(`  -H "Idempotency-Key: $(uuidgen)"`);
    lines.push(`  -d '${JSON.stringify(e.example?.request ?? {})}'`);
  }
  return lines.join(" \\\n");
}

export default async function ApiReferencePage() {
  await requirePermission("view", "integration");
  return (
    <div className="space-y-6">
      <Link href="/integrations" className="inline-flex items-center gap-1 text-sm text-text-muted hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden />
        Integrations
      </Link>
      <PageHeader
        title="API reference"
        description="REST API at /api/v1. Generated from the same schemas the server validates with; the machine-readable version is the OpenAPI 3.1 document."
        actions={
          <a href="/api/v1/openapi.json" className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-2.5 text-sm hover:bg-muted">
            <FileJson className="size-4" aria-hidden />
            openapi.json
          </a>
        }
      />

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="min-w-0 space-y-2 rounded-lg border border-border bg-surface p-5 text-sm shadow-xs">
          <h2 className="text-md font-semibold">Authentication</h2>
          <p className="text-text-muted">
            Create a key in <Link className="underline" href="/settings/api-keys">Settings → API keys</Link> and send it as <code className="font-mono text-xs">Authorization: Bearer nxk_…</code>. Keys are shown once and stored as SHA-256 hashes. A key acts with the permissions of the admin who created it, limited by its scopes.
          </p>
          <ul className="space-y-1">
            {API_SCOPES.map((s) => (
              <li key={s}>
                <code className="font-mono text-xs">{s}</code> <span className="text-text-muted">— {SCOPE_DESCRIPTIONS[s]}</span>
              </li>
            ))}
          </ul>
          <p className="text-xs text-text-muted">Integration keys and SIEM keys are separate kinds: an integration key can never hold a security scope.</p>
        </div>
        <div className="min-w-0 space-y-2 rounded-lg border border-border bg-surface p-5 text-sm shadow-xs">
          <h2 className="text-md font-semibold">Conventions</h2>
          <ul className="list-disc space-y-1 pl-5 text-text-muted">
            <li>
              Success: <code className="font-mono text-xs">{"{ data, meta? }"}</code>. Errors: <code className="font-mono text-xs">{"{ error: { code, message, details?, request_id } }"}</code>.
            </li>
            <li>
              POST endpoints accept <code className="font-mono text-xs">Idempotency-Key</code>: the same key and body return the stored response for 24 hours (header <code className="font-mono text-xs">Idempotent-Replayed: true</code>).
            </li>
            <li>Unknown fields are rejected. Bodies are limited to 64 KB.</li>
            <li>Every response carries X-Request-Id; quote it when reporting a problem.</li>
          </ul>
        </div>
      </section>

      <section aria-labelledby="endpoints-heading" className="space-y-3">
        <h2 id="endpoints-heading" className="text-md font-semibold">
          Endpoints
        </h2>
        {ENDPOINTS.map((e) => (
          <article key={`${e.method} ${e.path}`} className="min-w-0 space-y-3 rounded-lg border border-border bg-surface p-4 shadow-xs" id={`${e.method}-${e.path}`.replace(/[^a-z0-9-]/gi, "-")}>
            <div className="flex flex-wrap items-center gap-2">
              <span className={`rounded px-1.5 py-0.5 font-mono text-xs font-semibold ${e.method === "GET" ? "bg-info-bg text-info" : "bg-success-bg text-success"}`}>{e.method}</span>
              <code className="font-mono text-sm">/api/v1{e.path}</code>
              <span className="text-sm font-medium">{e.summary}</span>
              {e.scope && <span className="ml-auto rounded border border-border px-1.5 font-mono text-[11px] text-text-muted">{e.scope}</span>}
            </div>
            <p className="text-sm text-text-muted">{e.description}</p>
            <div className="grid gap-3 lg:grid-cols-2">
              <div className="min-w-0">
                <h3 className="mb-1 text-xs font-medium text-text-muted">Request</h3>
                <pre className="overflow-x-auto rounded bg-surface-muted p-3 font-mono text-[11px]">{curl(e)}</pre>
              </div>
              <div className="min-w-0">
                <h3 className="mb-1 text-xs font-medium text-text-muted">Response {e.status}</h3>
                <pre className="max-h-64 overflow-auto rounded bg-surface-muted p-3 font-mono text-[11px]">{e.example ? JSON.stringify(e.example.response, null, 2) : "See openapi.json for the full schema."}</pre>
              </div>
            </div>
          </article>
        ))}
      </section>

      <section aria-labelledby="errors-heading" className="space-y-2">
        <h2 id="errors-heading" className="text-md font-semibold">
          Errors
        </h2>
        <div className="relative overflow-x-auto rounded-lg border border-border bg-surface">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-surface-subtle text-xs text-text-muted">
              <tr>
                <th scope="col" className="h-9 px-3 text-left font-medium">HTTP</th>
                <th scope="col" className="h-9 px-3 text-left font-medium">Code</th>
                <th scope="col" className="h-9 px-3 text-left font-medium">Meaning</th>
              </tr>
            </thead>
            <tbody>
              {ERRORS.map(([status, code, meaning]) => (
                <tr key={code} className="border-b border-border last:border-0">
                  <td className="px-3 py-2 tabular-nums">{status}</td>
                  <td className="px-3 py-2 font-mono text-xs">{code}</td>
                  <td className="px-3 py-2 text-text-muted">{meaning}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
