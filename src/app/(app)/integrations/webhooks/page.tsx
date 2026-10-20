import { IntegrationPage, VERIFY_SNIPPET } from "@/components/integrations/integration-page";

export const metadata = { title: "Generic webhook" };

export default async function GenericWebhookPage({ searchParams }: PageProps<"/integrations/webhooks">) {
  return (
    <IntegrationPage
      provider="generic_webhook"
      params={await searchParams}
      description="Deliver signed JSON events to any HTTPS endpoint you control."
      urlHint="Must be https and resolve to a public address. Private, loopback, link-local and cloud metadata addresses are refused."
      guide={
        <>
          <div className="space-y-1">
            <h3>Request format</h3>
            <pre>{`POST <your URL>
Content-Type: application/json
X-Nexora-Event-Id: 5b0c…            (same on retries and redeliveries)
X-Nexora-Event-Type: lead.created
X-Nexora-Signature: t=1792…,v1=9f2c…

{ "event_id": "5b0c…", "type": "lead.created",
  "occurred_at": "2026-10-22T09:30:00.000Z",
  "organization_id": "…", "data": { "lead_id": "…", "record": { … } } }`}</pre>
          </div>
          <div className="space-y-1">
            <h3>Receiver checklist</h3>
            <ul>
              <li>Verify the signature on the raw body and reject timestamps older than 5 minutes.</li>
              <li>Deduplicate on <code>event_id</code>: retries and redeliveries reuse it.</li>
              <li>Answer 2xx within 5 seconds and do slow work afterwards. Other answers are retried after 1 and 4 minutes (408, 429 and 5xx only).</li>
              <li>Redirects are followed only to the same host; responses are read up to 64 KB.</li>
            </ul>
          </div>
          <pre>{VERIFY_SNIPPET}</pre>
        </>
      }
    />
  );
}
