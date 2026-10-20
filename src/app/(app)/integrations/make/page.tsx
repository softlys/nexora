import { IntegrationPage, VERIFY_SNIPPET } from "@/components/integrations/integration-page";

export const metadata = { title: "Make" };

export default async function MakePage({ searchParams }: PageProps<"/integrations/make">) {
  return (
    <IntegrationPage
      provider="make"
      params={await searchParams}
      description="Send NEXORA events to a Make scenario through a custom webhook, then call the NEXORA API back."
      urlHint="The address of a Make Custom webhook trigger (Make shows it when you add the Webhooks → Custom webhook module)."
      guide={
        <>
          <div className="space-y-1">
            <h3>Use cases</h3>
            <ul>
              <li>Post new leads to a Slack channel or send an email to the sales inbox.</li>
              <li>Append won deals to a Google Sheet for finance.</li>
              <li>Log the notification back on the NEXORA lead timeline.</li>
            </ul>
          </div>
          <div className="space-y-1">
            <h3>Scenario: new lead → Slack → activity in NEXORA</h3>
            <ol>
              <li>In Make, create a scenario and add <strong>Webhooks → Custom webhook</strong> as the trigger. Copy its address.</li>
              <li>Paste the address above, tick <code>lead.created</code>, enable the integration and save. Copy the signing secret that is shown once.</li>
              <li>
                Click <strong>Send test event</strong>. Make uses the test payload to learn the data structure; the status here turns <em>Connected</em> when Make answers 2xx.
              </li>
              <li>
                Add a <strong>Slack → Create a message</strong> (or Email) module. Map <code>data.record.title</code>, <code>data.record.company_name</code> and <code>data.record.contact_name</code>.
              </li>
              <li>
                Add <strong>HTTP → Make a request</strong>: <code>POST https://&lt;your-host&gt;/api/v1/events</code>, header <code>Authorization: Bearer &lt;API key with events:write&gt;</code>, header <code>Idempotency-Key: {"{{event_id}}"}</code>, JSON body:
                <pre>{`{ "event_type": "make.lead_notified", "entity": "lead",
  "record_id": "{{data.lead_id}}", "data": { "channel": "slack" } }`}</pre>
              </li>
              <li>
                In NEXORA Automation Studio, create a workflow with the trigger <strong>Webhook received</strong>, event type <code>make.lead_notified</code>, entity lead, and a <strong>Log activity</strong> step. The activity appears on the lead.
              </li>
            </ol>
          </div>
          <div className="space-y-1">
            <h3>Verifying the signature (optional)</h3>
            <p className="text-text-muted">
              Every request has <code>X-Nexora-Signature: t=…,v1=…</code>, the HMAC-SHA256 of <code>t.body</code> with the signing secret. In Make you can recompute it with the built-in <code>sha256</code>/HMAC functions, or put a small verification service in front. Reference implementation:
            </p>
            <pre>{VERIFY_SNIPPET}</pre>
          </div>
          <p className="text-xs text-text-muted">
            No Make blueprint file is provided: its format could not be checked against current Make documentation for this release, so this written guide is the supported path. Full walkthrough: docs/make-integration.md.
          </p>
        </>
      }
    />
  );
}
