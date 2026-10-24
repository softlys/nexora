import { z } from "zod";
import { aiCompletion, dealAssist, type DealBrief } from "@/server/integrations/ai";
import { DomainError } from "@/server/repositories/types";
import { countryName } from "@/lib/countries";
import { getOwned } from "./records";
import { findVisible, requireCan, type ServiceContext } from "./context";

export const dealAssistInput = z.object({ deal_id: z.uuid(), kind: z.enum(["summary", "email"]), language: z.enum(["ru", "en"]) }).strict();

/** AI summary or email draft for a deal the user can see. Sends the deal's own data to the configured provider. */
export async function assistDeal(ctx: ServiceContext, input: z.output<typeof dealAssistInput>): Promise<{ text: string; provider: string }> {
  requireCan(ctx, "view", "deal");
  const ai = aiCompletion();
  if (!ai) throw new DomainError("No AI provider is configured. Set YANDEX_GPT_API_KEY and YANDEX_FOLDER_ID (YandexGPT) or ANTHROPIC_API_KEY (Claude).");
  const brief = await ctx.db.read(ctx.actor.organization_id, async (tx): Promise<DealBrief> => {
    const deal = await getOwned(tx, ctx, "deals", input.deal_id);
    const [stage, company, contact, owner, activities, tasks, comments] = await Promise.all([
      tx.get("pipeline_stages", deal.stage_id),
      tx.get("companies", deal.company_id),
      deal.primary_contact_id ? tx.get("contacts", deal.primary_contact_id) : Promise.resolve(null),
      tx.get("profiles", deal.owner_id),
      tx.find("activities", { deal_id: deal.id }),
      findVisible(tx, ctx, "tasks", "task", (r) => r.assignee_id, { deal_id: deal.id }),
      tx.find("comments", { entity_type: "deal", entity_id: deal.id }),
    ]);
    return {
      deal: {
        name: deal.name,
        stage: stage?.name ?? "",
        amount: deal.amount,
        currency: deal.currency,
        probability: deal.probability,
        expected_close: deal.expected_close_date,
        next_activity: deal.next_activity,
        notes: deal.notes,
        days_in_stage: Math.max(0, Math.floor((Date.now() - Date.parse(deal.stage_entered_at)) / 86_400_000)),
      },
      company: company ? { name: company.name, industry: company.industry, country: countryName(company.country), city: company.city } : null,
      contact: contact ? { name: `${contact.first_name} ${contact.last_name}`, job_title: contact.job_title, email: contact.email } : null,
      owner: owner?.full_name ?? "",
      activities: activities
        .sort((a, b) => b.occurred_at.localeCompare(a.occurred_at))
        .slice(0, 20)
        .map((a) => ({ when: a.occurred_at.slice(0, 10), type: a.type, subject: a.subject, body: a.body })),
      tasks: tasks.filter((t) => !t.archived_at && (t.status === "todo" || t.status === "in_progress")).map((t) => ({ title: t.title, due: t.due_at?.slice(0, 10) ?? null, status: t.status })),
      comments: comments.filter((c) => !c.archived_at).slice(-10).map((c) => c.body),
    };
  });
  try {
    return { text: await dealAssist(ai.complete, brief, input.kind, input.language), provider: ai.label };
  } catch (error) {
    console.error("[ai] deal assist failed", error);
    throw new DomainError(`${ai.label} did not answer: ${error instanceof Error ? error.message.slice(0, 200) : "unknown error"}`);
  }
}
