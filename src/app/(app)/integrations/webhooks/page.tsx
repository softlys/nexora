import { IntegrationPage, VERIFY_SNIPPET } from "@/components/integrations/integration-page";
import { tr } from "@/lib/i18n";

export const metadata = { title: tr("Generic webhook") };

export default async function GenericWebhookPage({ searchParams }: PageProps<"/integrations/webhooks">) {
  return (
    <IntegrationPage
      provider="generic_webhook"
      params={await searchParams}
      description={tr("Deliver signed JSON events to any HTTPS endpoint you control.")}
      urlHint={tr("Must be https and resolve to a public address. Private, loopback, link-local and cloud metadata addresses are refused.")}
      guide={
        <>
          <div className="space-y-1">
            <h3>{tr("Request format")}</h3>
            <pre>{tr("POST <your URL>\nContent-Type: application/json\nX-Nexora-Event-Id: 5b0c…            (same on retries and redeliveries)\nX-Nexora-Event-Type: lead.created\nX-Nexora-Signature: t=1792…,v1=9f2c…\n\n{ \"event_id\": \"5b0c…\", \"type\": \"lead.created\",\n  \"occurred_at\": \"2026-10-22T09:30:00.000Z\",\n  \"organization_id\": \"…\", \"data\": { \"lead_id\": \"…\", \"record\": { … } } }")}</pre>
          </div>
          <div className="space-y-1">
            <h3>{tr("Receiver checklist")}</h3>
            <ul>
              <li>{tr("Verify the signature on the raw body and reject timestamps older than 5 minutes.")}</li>
              <li>{tr("Deduplicate on")} <code>event_id</code>{tr(": retries and redeliveries reuse it.")}</li>
              <li>{tr("Answer 2xx within 5 seconds and do slow work afterwards. Other answers are retried after 1 and 4 minutes (408, 429 and 5xx only).")}</li>
              <li>{tr("Redirects are followed only to the same host; responses are read up to 64 KB.")}</li>
            </ul>
          </div>
          <pre>{VERIFY_SNIPPET}</pre>
        </>
      }
    />
  );
}
