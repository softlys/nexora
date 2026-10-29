import { describe, expect, it } from "vitest";
import { saveWebForm, submissionErrors, submissionInput, submitWebForm, webFormInput } from "@/server/services/web-forms";
import { createTestDb, ctxFor, DEMO_ORG_ID, DEMO_USER_IDS } from "./helpers/services";

describe("website forms", () => {
  const fields = { phone: "required", email: "optional", company: "off", message: "optional" } as const;
  const input = (extra: object = {}) => webFormInput.parse({ name: "Заявка", title: "Оставьте заявку", button_text: "Отправить", success_text: "Спасибо!", fields, owner_id: DEMO_USER_IDS.repSofia, is_active: true, ...extra });

  it("is set up by admins and asks for a way to reach the customer", async () => {
    const { db, data } = createTestDb();
    await expect(saveWebForm(ctxFor(db, data(), DEMO_USER_IDS.manager), input())).rejects.toThrow();
    expect(webFormInput.safeParse({ ...input(), fields: { ...fields, phone: "off", email: "off" } }).success).toBe(false);
    const form = await saveWebForm(ctxFor(db, data(), DEMO_USER_IDS.admin), input());
    expect(form).toMatchObject({ name: "Заявка", submissions: 0, owner_id: DEMO_USER_IDS.repSofia });
  });

  it("checks a submission against the form's fields", async () => {
    const { db, data } = createTestDb();
    const form = await saveWebForm(ctxFor(db, data(), DEMO_USER_IDS.admin), input());
    expect(submissionErrors(form, submissionInput.parse({ name: "", phone: "" }))).toEqual({ name: "Required", phone: "Required" });
    expect(submissionErrors(form, submissionInput.parse({ name: "Иван", phone: "abc", email: "x@" }))).toEqual({ phone: "Enter a phone number", email: "Enter a valid e-mail" });
    expect(submissionErrors(form, submissionInput.parse({ name: "Иван", phone: "+7 999 123-45-67" }))).toEqual({});
  });

  it("turns a submission into a lead with the message on its timeline", async () => {
    const { db, data } = createTestDb();
    const admin = ctxFor(db, data(), DEMO_USER_IDS.admin);
    const form = await saveWebForm(admin, input());
    const lead = await db.write(DEMO_ORG_ID, (tx) => submitWebForm(tx, admin, form, submissionInput.parse({ name: "Иван Петров", phone: "+79991234567", company: "ignored", message: "Нужен расчёт на 20 станков", utm: { source: "yandex" } })));
    expect(lead).toMatchObject({ contact_name: "Иван Петров", company_name: "Иван Петров", phone: "+79991234567", source: "website", status: "new", owner_id: DEMO_USER_IDS.repSofia, utm: { source: "yandex" } });
    expect(data().activities.find((a) => a.lead_id === lead.id)?.body).toBe("Нужен расчёт на 20 станков");
    expect(data().web_forms.find((f) => f.id === form.id)?.submissions).toBe(1);
  });
});
