# n8n integration

NEXORA sends signed events to an n8n **Webhook** node. The workflow validates them, branches, calls the NEXORA API, notifies people and logs the result.

> **No importable workflow JSON is shipped.** n8n node types and their versions change between releases, and they could not be verified for this release. The construction guide below is the supported path. Option names match the n8n UI at the time of writing; check them against your n8n version.

## Authentication options

Every request from NEXORA carries `X-Nexora-Signature`. Choose one of these on **Integrations → n8n**:

| Mode | How n8n checks it | Trade-off |
| --- | --- | --- |
| **HMAC signature** (recommended) | Recompute HMAC-SHA256 of `<t>.<raw body>` in a Code node or with the Crypto node, then compare. | The secret never travels; replays older than 5 minutes are rejected. |
| **HMAC signature + header token** | Also sends the secret in `X-Nexora-Token`, so the Webhook node can use **Header Auth** with that header name and value. | Simpler to set up, but the secret is in every request. Use it only over https. |

## Connect

1. In n8n, add a **Webhook** node: HTTP method POST, a path of your choice, Respond **Immediately**. Copy the **production URL**. The test URL only works while the editor is listening.
2. In NEXORA, open **Integrations → n8n**. Paste the URL, tick `lead.created` (and anything else you need), enable the integration and click **Save and create secret**. Copy the secret; it is shown once.
3. Activate the n8n workflow, then click **Send test event**. Connected means n8n answered 2xx.

## Sample workflow: lead routing with a follow-up

```
Webhook → Validate payload → IF lead source → HTTP Request (NEXORA /events) → Notify → Log result
```

1. **Webhook.** POST, respond immediately. If you verify signatures in a Code node, enable the option that keeps the **raw body**: the HMAC covers the exact bytes.
2. **Validate payload** (Code node):
   - Verify the signature with the snippet below. The Code node may only `require` built-in modules that are allowed; set `NODE_FUNCTION_ALLOW_BUILTIN=crypto` on the n8n instance. Alternatively, use the **Crypto** node (Hmac, SHA256, hex output) and an **IF** to compare.
   - Check that `type` is `lead.created`. Throw on failure so the execution stops.
3. **IF.** Branch on the lead source, for example `{{ $json.body.data.record.source }}` equals `trade_show` or `partner`.
4. **HTTP Request** (true branch). The follow-up is created by NEXORA, so the task logic stays in one engine:
   - Method POST, URL `https://<your NEXORA host>/api/v1/events`
   - Headers: `Authorization: Bearer <API key with events:write>`, `Idempotency-Key: {{ $json.body.event_id }}`
   - Body (JSON):
     ```json
     { "event_type": "n8n.follow_up_requested", "entity": "lead", "record_id": "{{ $json.body.data.lead_id }}" }
     ```
   - In NEXORA Automation Studio, create a workflow with the trigger **Webhook received**, entity lead, event type `n8n.follow_up_requested`, and a **Create task** step (type follow-up).
5. **Notify.** Slack, Microsoft Teams or Email node with the lead title, company and source.
6. **Log result.** Store the NEXORA response (`event_id`, `workflows_matched`) in a sheet or keep it in the execution data.

## Verify the signature

```js
// Node.js / n8n Code node. rawBody must be the exact request body string.
const crypto = require("crypto");
function verify(rawBody, header, secret) {
  const parts = Object.fromEntries(header.split(",").map((p) => p.split("=")));
  const age = Math.abs(Date.now() / 1000 - Number(parts.t));
  if (!parts.v1 || age > 300) return false; // reject replays older than 5 minutes
  const expected = crypto.createHmac("sha256", secret).update(parts.t + "." + rawBody).digest("hex");
  return crypto.timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(parts.v1, "hex"));
}
```

## Calling NEXORA from n8n with a signature

Callbacks to `POST /api/v1/events` may also carry `X-Nexora-Integration: n8n` and an `X-Nexora-Signature` computed with the same secret over the request body. NEXORA then rejects requests that do not hold the secret (401 `signature_invalid`), even if the API key leaked. This check is optional.

## Delivery, retries, idempotency

- 5-second timeout.
- Retries after 1 and 4 minutes for timeouts, 408, 429 and 5xx (3 attempts in total).
- Delivery log with payload viewer, and **Redeliver** with the same `event_id`.

Deduplicate in n8n on `event_id`, for example with a data store, or by passing it as the `Idempotency-Key` of your NEXORA call as shown above.
