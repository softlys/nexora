import { IntegrationPage, VERIFY_SNIPPET } from "@/components/integrations/integration-page";
import { tr } from "@/lib/i18n";

export const metadata = { title: tr("Make") };

export default async function MakePage({ searchParams }: PageProps<"/integrations/make">) {
  return (
    <IntegrationPage
      provider="make"
      params={await searchParams}
      description={tr("Send NEXORA events to a Make scenario through a custom webhook, then call the NEXORA API back.")}
      urlHint={tr("The address of a Make Custom webhook trigger (Make shows it when you add the Webhooks → Custom webhook module).")}
      guide={
        <>
          <div className="space-y-1">
            <h3>{tr("Use cases")}</h3>
            <ul>
              <li>{tr("Post new leads to a Slack channel or send an email to the sales inbox.")}</li>
              <li>{tr("Append won deals to a Google Sheet for finance.")}</li>
              <li>{tr("Log the notification back on the NEXORA lead timeline.")}</li>
            </ul>
          </div>
          <div className="space-y-1">
            <h3>{tr("Scenario: new lead → Slack → activity in NEXORA")}</h3>
            <ol>
              <li>{tr("In Make, create a scenario and add")} <strong>{tr("Webhooks → Custom webhook")}</strong> {tr("as the trigger. Copy its address.")}</li>
              <li>{tr("Paste the address above, tick")} <code>lead.created</code>{tr(", enable the integration and save. Copy the signing secret that is shown once.")}</li>
              <li>{tr("Click")} <strong>{tr("Send test event")}</strong>{tr(". Make uses the test payload to learn the data structure; the status here turns")} <em>{tr("Connected")}</em> {tr("when Make answers 2xx.")}</li>
              <li>{tr("Add a")} <strong>{tr("Slack → Create a message")}</strong> {tr("(or Email) module. Map")} <code>data.record.title</code>, <code>data.record.company_name</code> {tr("and")} <code>data.record.contact_name</code>.
              </li>
              <li>{tr("Add")} <strong>{tr("HTTP → Make a request")}</strong>: <code>{tr("POST https://<your-host>/api/v1/events")}</code>{tr(", header")} <code>{tr("Authorization: Bearer <API key with events:write>")}</code>{tr(", header")} <code>{tr("Idempotency-Key:")} {"{{event_id}}"}</code>{tr(", JSON body:")}<pre>{`{ "event_type": "make.lead_notified", "entity": "lead",
  "record_id": "{{data.lead_id}}", "data": { "channel": "slack" } }`}</pre>
              </li>
              <li>{tr("In NEXORA Automation Studio, create a workflow with the trigger")} <strong>{tr("Webhook received")}</strong>{tr(", event type")} <code>make.lead_notified</code>{tr(", entity lead, and a")} <strong>{tr("Log activity")}</strong> {tr("step. The activity appears on the lead.")}</li>
            </ol>
          </div>
          <div className="space-y-1">
            <h3>{tr("Verifying the signature (optional)")}</h3>
            <p className="text-text-muted">{tr("Every request has")} <code>{tr("X-Nexora-Signature: t=…,v1=…")}</code>{tr(", the HMAC-SHA256 of")} <code>t.body</code> {tr("with the signing secret. In Make you can recompute it with the built-in")} <code>{tr("sha256")}</code>/HMAC functions, or put a small verification service in front. Reference implementation:
            </p>
            <pre>{VERIFY_SNIPPET}</pre>
          </div>
          <p className="text-xs text-text-muted">{tr("No Make blueprint file is provided: its format could not be checked against current Make documentation for this release, so this written guide is the supported path. Full walkthrough: docs/make-integration.md.")}</p>
        </>
      }
    />
  );
}
