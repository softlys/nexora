# Automation guide

Automation Studio (`/automation`) lets admins and managers build workflows of the form "when this happens, do these steps". This guide covers how workflows are defined, what each step does, which limits apply, and how to run the scheduler in production.

Code lives in these places:
- `src/domain/automation`: schema, validation and pure logic
- `src/server/automation`: engine, scheduler and service
- `src/app/(app)/automation`: Studio UI

Tests are in `tests/unit/automation-logic.test.ts` and `tests/unit/automation-engine.test.ts`.

## Workflows are data

A workflow definition is JSON stored in `automation_workflows.definition`:

```json
{
  "trigger": { "type": "record.created", "entity": "lead" },
  "steps": [
    { "id": "assign", "type": "assign_owner", "rule": "by_country", "only_if_unassigned": true },
    { "id": "follow-up", "type": "create_task", "title": "Follow up with {{lead.contact_name}}", "due_in_business_days": 1 },
    { "id": "log", "type": "create_activity", "subject": "Lead received and assigned" }
  ]
}
```

- The engine never evaluates code: there is no `eval`, no `Function()` and no user scripts. Conditions compare allowlisted variables with fixed operators. Templates replace `{{variable}}` with values from the same allowlist, as plain text.
- `validateDefinition()` runs on every save and again when a workflow is enabled. It rejects:
  - unknown step types and fields (strict schemas)
  - duplicate step ids
  - jumps to missing steps
  - backward jumps (no loops inside a workflow)
  - unreachable steps
  - variables that do not exist for the trigger's entity
  - `update_record` fields outside the allowlist
  - more than 20 steps
- Steps run in order. A step's optional `next` jumps forward. A `condition` step branches with `then` and `else`. The target `"end"` stops the run.
- Each save bumps `version`. The audit log keeps the field-level diff, and the Studio shows the history.
- New workflows start disabled. Enabling one re-validates it.

## Triggers

| Trigger | Fires when | Options |
| --- | --- | --- |
| `record.created` | A lead, deal, task, company or order is created. | `entity` |
| `record.updated` | One of those records is updated. | `entity`, optional `fields` (fires only if one of them changed) |
| `deal.stage_changed` | A deal moves to another stage. | `to`: `won`, `lost` or `any` |
| `date.reached` | A task's `due_at` passes while the task is open. Fires once per task and due date; moving the due date arms it again. | `task_type` (or `any`) |
| `webhook.received` | An inbound integration event arrives (phase 4). | `entity`, `event_type` |

Variables available to conditions and templates are listed per entity in `VARIABLES` (`src/domain/automation/schema.ts`). `event.type`, `event.occurred_at` and `workflow.name` are always available. The Studio editor shows the valid variables for the chosen trigger.

## Steps

| Step | What it does | Notes |
| --- | --- | --- |
| `condition` | Evaluates 1–10 conditions (`match: all` or `any`) and jumps to `then` or `else`. | Operators: `eq`, `neq`, `gt`, `gte`, `lt`, `lte`, `in`, `contains`, `is_empty`, `not_empty`. |
| `assign_owner` | Assigns the record owner. | `by_country` uses `country_map` (ISO code → user) and falls back to round robin among active sales reps. With `only_if_unassigned`, it skips records that already have an owner. |
| `create_task` | Creates a task linked to the record. | Due in N business days (Mon–Fri). The assignee is the record owner or the task assignee. |
| `update_record` | Sets fields on the triggering record. | Only allowlisted fields: lead `status`, `qualification`, `next_action`; deal `next_activity`, `probability`; task `priority`, `status`; company `lifecycle_stage`. Owner, amounts, stage, roles and organization can never be set. |
| `create_activity` | Logs an activity on the record's timeline. | |
| `create_notification` | Notifies the record owner, assignee, managers and/or admins. | `once_per_record` deduplicates per workflow, record and recipient. |
| `convert_deal_to_order` | Creates the order for a won deal. | Uses the same service as the "Create order" button, so a deal never gets a second order. A rerun returns the existing order. |
| `send_email` | Emails the record owner or assignee. | Sent through Resend when `RESEND_API_KEY` and `NEXORA_EMAIL_FROM` are set. Otherwise the step is recorded as **skipped (email not configured)**, never as sent. |
| `send_webhook` | Sends an event to subscribed outbound webhooks. | Delivered by the integrations module (phase 4). Until then the step is recorded as skipped. |
| `delay` | Pauses the run for 1–720 hours. | The run is stored as `waiting` with `resume_at`, and the scheduler resumes it from the next step. |

## Execution log

Every run writes an `automation_executions` row with:
- the trigger event and its payload (`trigger_payload`), with `mode: "live"` or `"test"`
- per-step results: status (`success`, `skipped`, `failed`), output, error and duration
- the overall status (`running`, `waiting`, `success`, `failed`, `skipped`), duration and error

A run is `skipped` when the trigger matched but no action step ran, for example when a condition led straight to `end`.

The Studio shows success rate, last run and run history, with filters by status and mode and a detail panel for each run.

### Retries

**Retry** on a failed run starts again from the failed step, using the stored trigger payload. Steps that already succeeded are not repeated. Side effects keep their own idempotency (one order per deal, notification dedupe keys), so a retry cannot duplicate them.

### Test runs

**Test run** in the editor executes the current saved version against a chosen record (or a sample event) in **dry mode**. Conditions and templates are evaluated, but no records, notifications, emails or webhooks are created. The result is stored as a run with `mode: "test"`, and it is excluded from the success rate.

## Safety limits

| Limit | Value | What happens |
| --- | --- | --- |
| Steps per workflow | 20 | Rejected on save. |
| Runs per workflow per minute | 30 | Further runs are recorded as `failed` with a clear error, and each one writes a `workflow.limit_exceeded` security event. |
| Step timeout | 5 s | The step fails, the run stops, and `workflow.limit_exceeded` (`step_timeout`) is written. |
| Delay | 1 h – 30 days | Rejected on save. |
| Causation depth | 3 | An event caused by a workflow carries a causation chain. At depth 3 the engine records a skipped run instead of continuing. |
| Self-trigger | never | A workflow never runs for an event its own run caused. |
| Template length | 500 characters (2000 for email bodies) | Rejected on save. |

**Idempotency.** Each run's key is `workflow id + event id`, and it is unique in the database. If the same event is delivered twice, the second delivery returns the earlier run.

**Who runs a workflow.** Runs act as a service principal (`SERVICE_ACTOR_ID`) inside the workflow's organization, not as the user who triggered the event. That principal can only do what the step types allow. No step can change roles, permissions, API keys or integration settings. In Supabase mode the engine uses the server-side service-role client, because a run must see records outside the triggering user's RLS scope, for example the managers to notify.

**Who edits workflows.** Admins and managers can view, create, edit, enable and test workflows. Sales reps cannot open the Studio, and a direct URL returns 403. Every change is audited and emits a security event (`workflow.created`, `workflow.updated`, `workflow.enabled`, `workflow.disabled`).

**When automations run.** Automations run after the user's action commits. An automation failure is recorded in its run and never fails or rolls back the user's action.

## The scheduler

Time-based work happens only when the scheduler runs:

1. `date.reached` triggers, such as follow-up tasks that are now overdue
2. resuming runs whose `delay` has elapsed
3. a `system.heartbeat` security event, written at most every five minutes, which VIGIL uses to detect a stopped scheduler

Admins can run it by hand with **Run scheduler** in the Studio. In production, call the cron endpoint every 5 minutes:

```bash
curl -X POST -H "Authorization: Bearer $CRON_SECRET" https://your-host/api/cron/scheduler
```

- The endpoint is **disabled (503)** unless `CRON_SECRET` is set to at least 16 characters.
- A wrong or missing secret returns 401, is compared in constant time, and is logged as `cron.unauthorized`.
- It accepts both `GET` and `POST`. Vercel Cron sends `GET` with `Authorization: Bearer <CRON_SECRET>` when the project has a `CRON_SECRET` environment variable. Add a `vercel.json` like this:

  ```json
  { "crons": [{ "path": "/api/cron/scheduler", "schedule": "*/5 * * * *" }] }
  ```

  Vercel's Hobby plan only allows daily cron jobs. On Hobby, use an external scheduler (GitHub Actions, cron-job.org, a server crontab) with the `curl` call above.
- The endpoint runs the scheduler for every organization with the service principal and returns counts only.

## Example workflows

The demo seed includes three enabled workflows, built from templates you can copy with **New workflow → From template**:

| Template | Trigger | Steps |
| --- | --- | --- |
| New lead: assign and follow up | lead created | assign owner (by country, else round robin) → follow-up task due in 1 business day → activity |
| Deal won: create order and notify | deal moved to Won | create the order (draft or confirmed, per organization setting) → notify owner and managers |
| Overdue follow-up reminder | follow-up task due date passed | still open? → notify assignee → activity |
