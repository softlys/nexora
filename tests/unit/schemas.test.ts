import { describe, expect, it } from "vitest";
import {
  changeRoleInput,
  companySchema,
  contactSchema,
  notificationSchema,
  paymentSchema,
  pipelineStageInput,
  pipelineStageSchema,
  updateOrganizationInput,
  updateProfileInput,
} from "@/domain/entities";
import { generateSeed } from "@/domain/seed/generate";

const seed = generateSeed(new Date("2026-10-19T12:00:00Z"));

describe("entity schemas", () => {
  it("accept seeded records", () => {
    expect(companySchema.safeParse(seed.companies[0]).success).toBe(true);
    expect(contactSchema.safeParse(seed.contacts[0]).success).toBe(true);
  });

  it("reject invalid email and phone on contacts", () => {
    const contact = seed.contacts[0]!;
    expect(contactSchema.safeParse({ ...contact, email: "not-an-email" }).success).toBe(false);
    expect(contactSchema.safeParse({ ...contact, phone: "call me maybe" }).success).toBe(false);
  });

  it("reject a stage that is both won and lost", () => {
    const stage = seed.pipeline_stages[0]!;
    expect(pipelineStageSchema.safeParse({ ...stage, is_won: true, is_lost: true }).success).toBe(false);
  });

  it("only allow simulated payments", () => {
    const payment = seed.payments[0]!;
    expect(paymentSchema.safeParse(payment).success).toBe(true);
    expect(paymentSchema.safeParse({ ...payment, is_simulated: false }).success).toBe(false);
  });

  it("only allow internal notification links", () => {
    const n = seed.notifications[0]!;
    expect(notificationSchema.safeParse({ ...n, link: "/tasks" }).success).toBe(true);
    expect(notificationSchema.safeParse({ ...n, link: "https://evil.example" }).success).toBe(false);
    expect(notificationSchema.safeParse({ ...n, link: "javascript:alert(1)" }).success).toBe(false);
  });
});

describe("mutation input schemas are strict", () => {
  it("reject unknown fields (mass assignment)", () => {
    expect(updateProfileInput.safeParse({ full_name: "A", title: "B", role: "admin" }).success).toBe(false);
    expect(
      updateOrganizationInput.safeParse({ name: "X", currency: "USD", locale: "en-US", order_conversion_mode: "draft", id: "other-org" }).success,
    ).toBe(false);
    expect(changeRoleInput.safeParse({ profile_id: seed.profiles[0]!.id, role: "admin", organization_id: "x" }).success).toBe(false);
  });

  it("validate values", () => {
    expect(updateProfileInput.safeParse({ full_name: "  ", title: "" }).success).toBe(false);
    expect(changeRoleInput.safeParse({ profile_id: seed.profiles[0]!.id, role: "owner" }).success).toBe(false);
    expect(updateOrganizationInput.safeParse({ name: "X", currency: "usd", locale: "en-US", order_conversion_mode: "draft" }).success).toBe(false);
  });

  it("coerce and bound stage probability", () => {
    const ok = pipelineStageInput.safeParse({ name: "Demo", probability: "40", is_won: false, is_lost: false });
    expect(ok.success && ok.data.probability).toBe(40);
    expect(pipelineStageInput.safeParse({ name: "Demo", probability: 140, is_won: false, is_lost: false }).success).toBe(false);
    expect(pipelineStageInput.safeParse({ name: "Demo", probability: 10, is_won: true, is_lost: true }).success).toBe(false);
  });
});

describe("number inputs", () => {
  it("accept amounts the way the app displays them and explain bad input", async () => {
    const { parseNumberInput, leadInput } = await import("@/domain/inputs");
    expect(parseNumberInput("10,600")).toBe(10600);
    expect(parseNumberInput("$10,600.50")).toBe(10600.5);
    expect(parseNumberInput(" 12.5 ")).toBe(12.5);
    expect(Number.isNaN(parseNumberInput("1,23"))).toBe(true);
    const base = { title: "t", company_name: "c", contact_name: "n", email: "", phone: "", country: "", source: "api", status: "new", qualification: "cold", next_action: "", next_action_at: "" };
    expect(leadInput.safeParse({ ...base, estimated_value: "-100" }).error!.issues[0]!.message).toBe("Must be zero or more");
    expect(leadInput.safeParse({ ...base, estimated_value: "abc" }).error!.issues[0]!.message).toContain("Enter a number");
    expect(leadInput.parse({ ...base, estimated_value: "10,600" }).estimated_value).toBe(10600);
  });
});
