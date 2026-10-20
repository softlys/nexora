import { IntegrationPage, VERIFY_SNIPPET } from "@/components/integrations/integration-page";

export const metadata = { title: "n8n" };

export default async function N8nPage({ searchParams }: PageProps<"/integrations/n8n">) {
  return (
    <IntegrationPage
      provider="n8n"
      params={await searchParams}
      description="Send signed NEXORA events to an n8n Webhook node and call the NEXORA API from the workflow."
      urlHint="The production URL of an n8n Webhook node (HTTP method POST). The test URL only works while the n8n editor is listening."
      guide={
        <>
          <div className="space-y-1">
            <h3>Authentication</h3>
            <ul>
              <li>
                <strong>HMAC signature</strong> (recommended): verify <code>X-Nexora-Signature</code> against the raw body in a Code node or with the Crypto node (HMAC, SHA256, hex). Reject anything older than 5 minutes.
              </li>
              <li>
                <strong>Header token</strong>: choose “HMAC signature + header token” above and use the Webhook node’s <em>Header Auth</em> credential with header name <code>X-Nexora-Token</code> and the signing secret as value. Simpler, but the secret travels with every request.
              </li>
            </ul>
          </div>
          <div className="space-y-1">
            <h3>Sample workflow: lead routing with a follow-up</h3>
            <ol>
              <li>
                <strong>Webhook</strong> node: POST, path of your choice, respond “Immediately”. Enable the raw body option if you verify signatures in a Code node.
              </li>
              <li>
                <strong>Validate payload</strong>: a Code node that checks the signature (snippet below; allow the built-in <code>crypto</code> module with <code>NODE_FUNCTION_ALLOW_BUILTIN=crypto</code>) and that <code>type</code> is <code>lead.created</code>. Stop on failure.
              </li>
              <li>
                <strong>IF</strong> node on <code>{"{{ $json.body.data.record.source }}"}</code>, e.g. <code>trade_show</code> or <code>partner</code>.
              </li>
              <li>
                <strong>HTTP Request</strong> (true branch): <code>POST /api/v1/events</code> with an API key that has <code>events:write</code>, header <code>Idempotency-Key</code> set to the event id, body{" "}
                <code>{`{"event_type":"n8n.follow_up_requested","entity":"lead","record_id":"<lead id>"}`}</code>. A NEXORA workflow with the trigger <em>Webhook received</em> → <em>Create follow-up task</em> owns the task, so the task logic stays in one engine.
              </li>
              <li>
                <strong>Notify</strong>: Slack, email or Teams node with the lead title and owner.
              </li>
              <li>
                <strong>Log result</strong>: write the NEXORA response (<code>event_id</code>, <code>workflows_matched</code>) to a sheet or n8n’s execution data.
              </li>
            </ol>
          </div>
          <div className="space-y-1">
            <h3>Signature check</h3>
            <pre>{VERIFY_SNIPPET}</pre>
          </div>
          <p className="text-xs text-text-muted">
            No importable workflow JSON is shipped: node type versions change between n8n releases and could not be verified for this release, so the construction guide above is the supported path. Details: docs/n8n-integration.md.
          </p>
        </>
      }
    />
  );
}
