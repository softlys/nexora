# Make integration

NEXORA sends signed events to a Make scenario through a **Custom webhook**. The scenario can call NEXORA back through the public API. This guide builds the scenario "new lead → Make → Slack or email → activity logged back in NEXORA".

> **No blueprint file is provided.** Make's blueprint format could not be verified against current Make documentation for this release. This written guide is the supported path. The module names below are the standard Make apps; menus may differ slightly between Make versions.

## What you need

- An admin account in NEXORA.
- A Make account with access to the Webhooks, Slack (or Email) and HTTP apps.
- A NEXORA **integration API key** with `events:write` (Settings → API keys).

## 1. Create the webhook in Make

1. Create a scenario. Add **Webhooks → Custom webhook** as the trigger and click **Add** to create a webhook.
2. Copy the webhook address, for example `https://hook.eu1.make.com/…`.

## 2. Connect it in NEXORA

1. Open **Integrations → Make**.
2. Paste the webhook address, tick **lead.created**, switch **Send events to this endpoint** on, and click **Save and create secret**.
3. Copy the **signing secret**. It is shown once; NEXORA stores it encrypted (AES-256-GCM) and afterwards shows only its last four characters.
4. Click **Send test event**. Make uses this payload to learn the data structure. The status changes to **Connected** when Make answers with 2xx; otherwise it shows **Error** with the reason, and the attempt appears in the delivery log.

The status is only ever Connected after a real test succeeded. A new URL or a rotated secret resets it to "Configured (untested)".

## 3. Notify the team

Add **Slack → Create a message** (or **Email → Send an email**) and map fields from the payload:

| Field | Path in the payload |
| --- | --- |
| Lead title | `data.record.title` |
| Company | `data.record.company_name` |
| Contact | `data.record.contact_name` |
| Estimated value | `data.record.estimated_value` + `data.record.currency` |
| Lead id | `data.lead_id` |
| Event id (for deduplication) | `event_id` |

## 4. Log the notification back in NEXORA

1. Add **HTTP → Make a request**:
   - URL: `https://<your NEXORA host>/api/v1/events`
   - Method: POST
   - Headers: `Authorization: Bearer <API key with events:write>`, `Content-Type: application/json`, `Idempotency-Key: {{event_id}}`
   - Body:
     ```json
     { "event_type": "make.lead_notified", "entity": "lead", "record_id": "{{data.lead_id}}", "data": { "channel": "slack" } }
     ```
2. In NEXORA **Automation Studio**, create a workflow:
   - Trigger: **Webhook received**, entity **lead**, event type `make.lead_notified`
   - Step: **Log activity**, subject "Notified in Slack via Make"
   - Enable it.

Run the scenario once. The response contains `"workflows_matched": 1`, and the activity appears on the lead's timeline.

## Payload and headers

```http
POST <webhook URL>
Content-Type: application/json
X-Nexora-Event-Id: 5b0c…
X-Nexora-Event-Type: lead.created
X-Nexora-Signature: t=1792…,v1=9f2c…

{ "event_id": "…", "type": "lead.created", "occurred_at": "…", "organization_id": "…",
  "data": { "lead_id": "…", "record": { "title": "…", "company_name": "…", … } } }
```

**Verifying the signature (optional in Make).** The signature is HMAC-SHA256 of `<t>.<raw body>` with the signing secret, in hex. Make's built-in functions can compute an HMAC, or you can put a small verification function in front of the scenario. A Node.js reference implementation is in [n8n-integration.md](n8n-integration.md#verify-the-signature). Reject timestamps older than 5 minutes.

## Delivery, retries and deduplication

- NEXORA waits up to 5 seconds for a response.
- Failed attempts (timeouts, 408, 429 and 5xx) are retried after 1 and then 4 minutes, so there are at most 3 attempts. Other 4xx answers are not retried.
- Every attempt appears in **Integrations → Make → Delivery log**, with status code, duration, the payload and the first 1,000 characters of the response.
- **Redeliver** sends the stored payload again with the **same `event_id`**. Use `event_id` in Make (a data store or a filter) to skip duplicates.

## Which engine does what

If Make sends Slack messages for new leads, let NEXORA keep creating the follow-up task: one action has one owner. The Integrations overview warns when an event routed to Make is also handled by an enabled NEXORA workflow, and lists that workflow's actions.
