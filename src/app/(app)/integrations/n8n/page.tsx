import { IntegrationPage, VERIFY_SNIPPET } from "@/components/integrations/integration-page";
import { tr } from "@/lib/i18n";

export const metadata = { title: "n8n" };

export default async function N8nPage({ searchParams }: PageProps<"/integrations/n8n">) {
  return (
    <IntegrationPage
      provider="n8n"
      params={await searchParams}
      description={tr("Send signed NEXORA events to an n8n Webhook node and call the NEXORA API from the workflow.")}
      urlHint={tr("The production URL of an n8n Webhook node (HTTP method POST). The test URL only works while the n8n editor is listening.")}
      guide={
        <>
          <div className="space-y-1">
            <h3>{tr("Authentication")}</h3>
            <ul>
              <li>
                <strong>{tr("HMAC signature")}</strong> {tr("(recommended): verify")} <code>{tr("X-Nexora-Signature")}</code> {tr("against the raw body in a Code node or with the Crypto node (HMAC, SHA256, hex). Reject anything older than 5 minutes.")}</li>
              <li>
                <strong>{tr("Header token")}</strong>{tr(": choose “HMAC signature + header token” above and use the Webhook node’s")} <em>{tr("Header Auth")}</em> {tr("credential with header name")} <code>{tr("X-Nexora-Token")}</code> {tr("and the signing secret as value. Simpler, but the secret travels with every request.")}</li>
            </ul>
          </div>
          <div className="space-y-1">
            <h3>{tr("Sample workflow: lead routing with a follow-up")}</h3>
            <ol>
              <li>
                <strong>{tr("Webhook")}</strong> {tr("node: POST, path of your choice, respond “Immediately”. Enable the raw body option if you verify signatures in a Code node.")}</li>
              <li>
                <strong>{tr("Validate payload")}</strong>{tr(": a Code node that checks the signature (snippet below; allow the built-in")} <code>{tr("crypto")}</code> {tr("module with")} <code>{tr("NODE_FUNCTION_ALLOW_BUILTIN=crypto")}</code>{tr(") and that")} <code>{tr("type")}</code> {tr("is")} <code>lead.created</code>{tr(". Stop on failure.")}</li>
              <li>
                <strong>{tr("IF")}</strong> {tr("node on")} <code>{"{{ $json.body.data.record.source }}"}</code>, e.g. <code>trade_show</code> {tr("or")} <code>{tr("partner")}</code>.
              </li>
              <li>
                <strong>{tr("HTTP Request")}</strong> {tr("(true branch):")} <code>{tr("POST /api/v1/events")}</code> {tr("with an API key that has")} <code>{tr("events:write")}</code>{tr(", header")} <code>{tr("Idempotency-Key")}</code> {tr("set to the event id, body")}{" "}
                <code>{tr("{\"event_type\":\"n8n.follow_up_requested\",\"entity\":\"lead\",\"record_id\":\"<lead id>\"}")}</code>{tr(". A NEXORA workflow with the trigger")} <em>{tr("Webhook received")}</em> → <em>{tr("Create task")}</em> {tr("owns the task, so the task logic stays in one engine.")}</li>
              <li>
                <strong>{tr("Notify")}</strong>{tr(": Slack, email or Teams node with the lead title and owner.")}</li>
              <li>
                <strong>{tr("Log result")}</strong>{tr(": write the NEXORA response (")}<code>event_id</code>, <code>workflows_matched</code>{tr(") to a sheet or n8n’s execution data.")}</li>
            </ol>
          </div>
          <div className="space-y-1">
            <h3>{tr("Signature check")}</h3>
            <pre>{VERIFY_SNIPPET}</pre>
          </div>
          <p className="text-xs text-text-muted">{tr("No importable workflow JSON is shipped: node type versions change between n8n releases and could not be verified for this release, so the construction guide above is the supported path. Details: docs/n8n-integration.md.")}</p>
        </>
      }
    />
  );
}
