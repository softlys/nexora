import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_EMAIL_TEMPLATES, renderEmail, unknownVariables } from "@/domain/email-templates";
import type { Dataset } from "@/domain/entities";
import type { EmailMessage, EmailSender } from "@/server/automation/engine";
import type { Db } from "@/server/db/types";
import { emailComposer, emailTemplateInput, saveEmailTemplate, sendEmailInput, sendRecordEmail } from "@/server/services/email";
import { createTestDb, ctxFor, DEMO_USER_IDS } from "./helpers/services";

function fakeSender(configured = true) {
  const sent: EmailMessage[] = [];
  const sender: EmailSender = {
    configured,
    async send(message) {
      sent.push(message);
      return { id: `msg-${sent.length}` };
    },
  };
  return { sender, sent };
}

describe("e-mail templates", () => {
  it("fills known variables and reports unknown ones", () => {
    expect(renderEmail("Hello {{contact.first_name}}, {{deal.name}}{{secret.key}}", { "contact.first_name": "Анна", "deal.name": "Поставка" })).toBe("Hello Анна, Поставка");
    expect(unknownVariables("{{contact.first_name}} {{contact.password}}")).toEqual(["contact.password"]);
    for (const t of DEFAULT_EMAIL_TEMPLATES) expect(unknownVariables(t.subject + t.body)).toEqual([]);
    expect(emailTemplateInput.safeParse({ name: "X", subject: "Hi {{user.token}}", body: "Body" }).success).toBe(false);
  });
});

describe("writing e-mails from records", () => {
  let db: Db;
  let data: () => Dataset;
  beforeEach(() => {
    ({ db, data } = createTestDb());
  });
  const admin = () => ctxFor(db, data(), DEMO_USER_IDS.admin);
  const rep = () => ctxFor(db, data(), DEMO_USER_IDS.repDaniel);
  const dealWithContact = () => {
    const deal = data().deals.find((d) => d.owner_id === DEMO_USER_IDS.repDaniel && d.primary_contact_id && !d.archived_at && data().contacts.find((c) => c.id === d.primary_contact_id)?.email)!;
    return { deal, contact: data().contacts.find((c) => c.id === deal.primary_contact_id)! };
  };

  it("seeds default templates and prepares the composer from a deal", async () => {
    expect(data().email_templates.map((t) => t.name).sort()).toEqual(["Commercial offer", "Follow-up", "Introduction"]);
    const { deal, contact } = dealWithContact();
    const composer = await emailComposer(rep(), { deal_id: deal.id }, true);
    expect(composer.recipients[0]).toMatchObject({ email: contact.email, contact_id: contact.id });
    expect(composer.vars).toMatchObject({ "contact.first_name": contact.first_name, "deal.name": deal.name, "me.name": "Daniel Okafor" });
    expect(composer.links).toMatchObject({ deal_id: deal.id, contact_id: contact.id, company_id: deal.company_id });
    expect(composer.templates).toHaveLength(3);
  });

  it("sends with the user's reply-to address and logs the e-mail on the records", async () => {
    const { deal, contact } = dealWithContact();
    const { sender, sent } = fakeSender();
    const result = await sendRecordEmail(rep(), sender, sendEmailInput.parse({ to: contact.email, subject: "Offer", body: "Please see the offer.", deal_id: deal.id, contact_id: contact.id }));
    expect(sent).toEqual([{ to: contact.email, subject: "Offer", text: "Please see the offer.", replyTo: data().profiles.find((p) => p.id === DEMO_USER_IDS.repDaniel)!.email }]);
    const activity = data().activities.find((a) => a.id === result.activity_id)!;
    expect(activity).toMatchObject({ type: "email", subject: "Offer", deal_id: deal.id, contact_id: contact.id, company_id: deal.company_id, actor_id: DEMO_USER_IDS.repDaniel });
  });

  it("does not send without a provider or to records the user cannot see", async () => {
    const { deal, contact } = dealWithContact();
    const off = fakeSender(false);
    await expect(sendRecordEmail(rep(), off.sender, sendEmailInput.parse({ to: contact.email, subject: "S", body: "B", deal_id: deal.id }))).rejects.toThrow(/not set up/);
    const other = data().deals.find((d) => d.owner_id === DEMO_USER_IDS.repSofia && !d.archived_at)!;
    const on = fakeSender();
    await expect(sendRecordEmail(rep(), on.sender, sendEmailInput.parse({ to: "x@example.com", subject: "S", body: "B", deal_id: other.id }))).rejects.toThrow();
    expect(on.sent).toEqual([]);
  });

  it("lets only admins manage templates", async () => {
    await expect(saveEmailTemplate(rep(), emailTemplateInput.parse({ name: "Mine", subject: "S", body: "B" }))).rejects.toThrow();
    const t = await saveEmailTemplate(admin(), emailTemplateInput.parse({ name: "Счёт", subject: "Счёт для {{company.name}}", body: "Добрый день, {{contact.first_name}}!" }));
    expect(data().email_templates.find((x) => x.id === t.id)?.subject).toBe("Счёт для {{company.name}}");
  });
});
