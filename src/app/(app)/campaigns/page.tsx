import { Megaphone } from "lucide-react";
import { EmptyState } from "@/components/patterns/empty-state";
import { PageHeader } from "@/components/patterns/page-header";
import { humanizeStatus, StatusBadge } from "@/components/patterns/status-badge";
import { LIFECYCLE_STAGES } from "@/domain/entities";
import { countryName } from "@/lib/countries";
import { formatDate } from "@/lib/format";
import { tr } from "@/lib/i18n";
import { getDataMode } from "@/server/env";
import { requirePermission } from "@/server/guards";
import { outboundEmail } from "@/server/integrations/outbound-email";
import { smsSender } from "@/server/integrations/sms";
import { loadPage, peopleFor } from "@/server/page-data";
import { listCampaigns } from "@/server/services/campaigns";
import { findVisible } from "@/server/services/context";
import { NewCampaignButton, SendCampaignButton } from "./campaign-editor";

export const metadata = { title: tr("Mailings") };

/** Mass e-mail and SMS mailings to segments of contacts. */
export default async function CampaignsPage() {
  const { user } = await requirePermission("view", "contact");
  const { campaigns, tags, countries, people } = await loadPage(async (ctx) => {
    const [campaigns, contacts, companies, people] = await Promise.all([
      listCampaigns(ctx),
      ctx.db.read(ctx.actor.organization_id, (tx) => findVisible(tx, ctx, "contacts", "contact", (r) => r.owner_id, { archived_at: null })),
      ctx.db.read(ctx.actor.organization_id, (tx) => tx.find("companies", { archived_at: null })),
      peopleFor(ctx, "contact"),
    ]);
    return { campaigns, tags: [...new Set(contacts.flatMap((c) => c.tags))].filter((t) => t !== "unsubscribed").sort(), countries: [...new Set(companies.map((c) => c.country))].sort(), people };
  });
  const canRun = user.profile.role === "admin" || user.profile.role === "manager";
  const demo = getDataMode() === "demo";
  const ready = { email: outboundEmail().configured, sms: smsSender().configured };
  const simulateNote = (channel: "email" | "sms") => (ready[channel] ? null : demo ? tr("No provider is connected, so in the demo the mailing is simulated: recorded on the timelines, nothing is sent.") : null);

  return (
    <div className="space-y-5">
      <PageHeader
        title={tr("Mailings")}
        description={tr("E-mail and SMS to a segment of contacts: by tags, company stage, country or owner. E-mail goes through the e-mail provider (SMTP or Resend), SMS through SMS.ru.")}
        actions={canRun ? <NewCampaignButton tags={tags.map((t) => ({ value: t, label: t }))} lifecycle={LIFECYCLE_STAGES.map((s) => ({ value: s, label: humanizeStatus(s) }))} countries={countries.map((c) => ({ value: c, label: countryName(c) }))} owners={people.all} /> : undefined}
      />
      {campaigns.length === 0 ? (
        <EmptyState icon={Megaphone} title={tr("No mailings yet")} description={canRun ? tr("Create one: choose who gets it, write the text, check the count and send.") : tr("Admins and managers create mailings.")} />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border bg-surface">
          <table className="w-full text-sm" data-testid="campaigns">
            <thead className="border-b border-border text-xs text-text-muted">
              <tr>
                <th className="px-3 py-2 text-left font-normal">{tr("Name")}</th>
                <th className="px-3 py-2 text-left font-normal">{tr("Channel")}</th>
                <th className="px-3 py-2 text-left font-normal">{tr("Status")}</th>
                <th className="px-3 py-2 text-right font-normal">{tr("Sent")}</th>
                <th className="px-3 py-2 text-right font-normal">{tr("Failed")}</th>
                <th className="px-3 py-2 text-right font-normal">{tr("No address")}</th>
                <th className="px-3 py-2 text-left font-normal">{tr("Date")}</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {campaigns.map((c) => (
                <tr key={c.id} className="border-b border-border last:border-0">
                  <td className="px-3 py-2">
                    <span className="font-medium">{c.name}</span>
                    {c.subject && <span className="block text-xs text-text-muted">{c.subject}</span>}
                  </td>
                  <td className="px-3 py-2">{c.channel === "email" ? "E-mail" : "SMS"}</td>
                  <td className="px-3 py-2">
                    <StatusBadge label={c.status === "draft" ? tr("Draft") : c.simulated ? tr("Simulated") : tr("Sent")} tone={c.status === "draft" ? "neutral" : c.simulated ? "warning" : "success"} />
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{c.status === "sent" ? c.sent : "—"}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{c.status === "sent" ? c.failed : "—"}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{c.status === "sent" ? c.skipped : "—"}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{formatDate(c.sent_at ?? c.created_at)}</td>
                  <td className="px-3 py-2 text-right">{canRun && c.status === "draft" && <SendCampaignButton id={c.id} name={c.name} simulateNote={simulateNote(c.channel)} />}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
