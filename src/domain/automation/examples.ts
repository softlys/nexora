/**
 * The three example automations seeded into every demo organization (enabled).
 * They double as templates in Automation Studio.
 */
import type { WorkflowDefinition } from "./schema";

export type ExampleWorkflow = { key: "new_lead" | "deal_won" | "overdue_follow_up"; name: string; description: string; definition: WorkflowDefinition };

export const EXAMPLE_WORKFLOWS: ExampleWorkflow[] = [
  {
    key: "new_lead",
    name: "New lead: assign and follow up",
    description: "Assigns an owner (by country, otherwise round robin among sales reps), creates a follow-up task due in one business day and logs an activity.",
    definition: {
      trigger: { type: "record.created", entity: "lead" },
      steps: [
        { id: "assign", name: "Assign owner", type: "assign_owner", rule: "by_country", only_if_unassigned: true, country_map: {} },
        {
          id: "follow-up",
          name: "Create follow-up task",
          type: "create_task",
          title: "Follow up with {{lead.contact_name}} at {{lead.company_name}}",
          task_type: "follow_up",
          priority: "high",
          due_in_business_days: 1,
          assignee: "record_owner",
        },
        { id: "log", name: "Log activity", type: "create_activity", activity_type: "system", subject: "Lead received and assigned", body: "Source: {{lead.source}}. Owner: {{lead.owner_name}}." },
      ],
    },
  },
  {
    key: "deal_won",
    name: "Deal won: create order and notify",
    description: "Creates the order for a won deal (draft or confirmed, per organization setting) and notifies the deal owner and the managers. Re-running never creates a second order.",
    definition: {
      trigger: { type: "deal.stage_changed", entity: "deal", to: "won" },
      steps: [
        { id: "order", name: "Create order", type: "convert_deal_to_order" },
        {
          id: "notify",
          name: "Notify owner and managers",
          type: "create_notification",
          recipients: ["record_owner", "managers"],
          title: "Deal won: {{deal.name}}",
          body: "{{deal.company_name}}, {{deal.amount}} {{deal.currency}}. The order was created automatically.",
          link: "record",
          once_per_record: true,
        },
      ],
    },
  },
  {
    key: "overdue_follow_up",
    name: "Overdue follow-up reminder",
    description: "When a follow-up task passes its due date, notifies the assignee and logs an activity. Runs once per task.",
    definition: {
      trigger: { type: "date.reached", entity: "task", field: "due_at", task_type: "follow_up" },
      steps: [
        {
          id: "still-open",
          name: "Still open?",
          type: "condition",
          match: "any",
          conditions: [
            { field: "task.status", op: "eq", value: "todo" },
            { field: "task.status", op: "eq", value: "in_progress" },
          ],
          then: "notify",
          else: "end",
        },
        {
          id: "notify",
          name: "Notify assignee",
          type: "create_notification",
          recipients: ["assignee"],
          title: "Follow-up overdue: {{task.title}}",
          body: "It was due {{task.due_at}}.",
          link: "record",
          once_per_record: true,
        },
        { id: "log", name: "Log activity", type: "create_activity", activity_type: "follow_up", subject: "Follow-up overdue", body: "{{task.title}} passed its due date without being completed." },
      ],
    },
  },
];
