/**
 * E-mail templates for writing to customers from a record page. Templates use {{entity.field}}
 * variables from a fixed list; the rendered text is shown to the user, who can edit it before
 * sending. Output is plain text.
 */

export const EMAIL_TEMPLATE_VARIABLES = [
  "contact.first_name",
  "contact.last_name",
  "contact.full_name",
  "contact.job_title",
  "company.name",
  "company.city",
  "deal.name",
  "deal.amount",
  "lead.title",
  "me.name",
  "me.title",
  "me.email",
] as const;
export type EmailTemplateVariable = (typeof EMAIL_TEMPLATE_VARIABLES)[number];
export type EmailVars = Partial<Record<EmailTemplateVariable, string | null>>;

const VAR = /\{\{\s*([a-z_]+\.[a-z_]+)\s*\}\}/g;
const ALLOWED = new Set<string>(EMAIL_TEMPLATE_VARIABLES);

/** Variables a template uses that are not in the list. */
export function unknownVariables(text: string): string[] {
  return [...new Set([...text.matchAll(VAR)].map((m) => m[1]!).filter((v) => !ALLOWED.has(v)))];
}

/** Fills the variables; missing values render empty. */
export function renderEmail(text: string, vars: EmailVars): string {
  return text
    .replace(VAR, (_, name: string) => (ALLOWED.has(name) ? (vars[name as EmailTemplateVariable] ?? "") : ""))
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "");
}

/** Templates every new organization starts with (also added to older demo stores). */
export const DEFAULT_EMAIL_TEMPLATES: Array<{ name: string; subject: string; body: string }> = [
  {
    name: "Introduction",
    subject: "{{company.name}} and {{me.name}}: next steps",
    body: "Hello {{contact.first_name}},\n\nThank you for your time today. As discussed, I am sending a short summary and the next steps.\n\nBest regards,\n{{me.name}}\n{{me.title}}",
  },
  {
    name: "Follow-up",
    subject: "Following up: {{deal.name}}",
    body: "Hello {{contact.first_name}},\n\nI wanted to follow up on {{deal.name}}. Do you have any questions, or is there anything I can prepare for you?\n\nBest regards,\n{{me.name}}",
  },
  {
    name: "Commercial offer",
    subject: "Commercial offer for {{company.name}}",
    body: "Hello {{contact.first_name}},\n\nPlease find our offer for {{deal.name}} below. The total is {{deal.amount}}.\n\nI am happy to go through it on a call.\n\nBest regards,\n{{me.name}}\n{{me.email}}",
  },
];
