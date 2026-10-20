# Five-minute demo

A click path for showing NEXORA to a client. Everything runs in demo mode with fictional data: `npm install && npm run dev`, then open http://localhost:3000. Reset the data afterwards in **Settings → Demo data** (or `npm run demo:reset`).

## 0:00 — Overview (30 s)

- You start as **Olivia Hart, Admin**. The Overview shows won deal value, open pipeline, conversion, receivables and overdue tasks, each compared with the previous period.
- Change the period to **This year**: the URL changes, so the view can be shared.
- Click a bar in **Deals by stage**: the deals list opens, filtered to that stage and period. Every number on the dashboard leads to its records.

## 0:30 — Pipeline (60 s)

- Open **Sales Pipeline**. Drag a deal from Negotiation to Commitment. The move is saved immediately and rolls back if the server refuses it.
- Drag a deal to **Lost**: a lost reason is required.
- Drag one to **Won**. Point out the toast, then open the deal. The **Deal won** automation has already created exactly one order; the Create order button is gone.

## 1:30 — Automation Studio (60 s)

- Open **Automation Studio** → **New lead: assign and follow up**. Show the trigger, the three steps and the run history.
- Open a run: each step has its own result and duration. A failed run can be retried from the failed step.
- Mention the guardrails: no code in workflows, loop protection, 30 runs per minute, and an audited version history.

## 2:30 — API and integrations (60 s)

- **Settings → API keys** → Create API key (integration, `leads:write`). The key is shown once.
- In a terminal:

  ```bash
  curl -X POST http://localhost:3000/api/v1/leads -H "Authorization: Bearer <key>" -H "Content-Type: application/json" \
    -d '{"title":"Demo inquiry","company_name":"Example Co","contact_name":"Sam Example","country":"DE","estimated_value":25000}'
  ```

- Open **Leads**. The new lead already has an owner and a follow-up task: the same automation ran.
- **Integrations**: every card says Not configured. Nothing is claimed as connected until a real test event succeeds. Open **n8n** to show the signed payload format and the delivery log, then **API reference** for the generated documentation.

## 3:30 — Roles and security (60 s)

- User menu → switch to **Daniel Okafor, Sales Rep**. The sidebar loses Automation Studio and Integrations, and the lists show only Daniel's records.
- Open `/settings/team` directly: 403. The server refuses it, not just the menu.
- Switch back to the admin, open **Settings → Security log**: the role switches you just made are there. Click **Verify now**: the hash chain is intact.

## 4:30 — Design system (30 s)

- **Figma & UI Kit**: tokens and components rendered live. Toggle dark mode in the top bar.
- Download **Tokens Studio JSON** for Figma.

## Questions that come up

- **"Is this connected to Make or n8n?"** Not in the demo. The integration pages show the real setup, and the status turns Connected only after a successful test event to your endpoint.
- **"Is the data real?"** No. Every company, person and amount is generated from a fixed seed, and payments are simulated.
- **"Can it run on our infrastructure?"** Yes, with Supabase (PostgreSQL with row-level security) and any Next.js host. See [deployment.md](deployment.md).
