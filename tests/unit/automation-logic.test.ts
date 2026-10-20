import { describe, expect, it } from "vitest";
import { EXAMPLE_WORKFLOWS } from "@/domain/automation/examples";
import { addBusinessDays, evaluateConditions, nextStepId, renderTemplate, validateDefinition } from "@/domain/automation/logic";
import { variablesFor } from "@/domain/automation/schema";

const base = { trigger: { type: "record.created", entity: "lead" } };

describe("workflow validation", () => {
  it("accepts the three example workflows", () => {
    for (const w of EXAMPLE_WORKFLOWS) expect(validateDefinition(w.definition)).toMatchObject({ ok: true });
  });

  it("rejects unknown fields and missing config", () => {
    const unknown = validateDefinition({ ...base, steps: [{ id: "a", type: "create_task", title: "x", script: "alert(1)" }] });
    expect(unknown.ok).toBe(false);
    const missing = validateDefinition({ ...base, steps: [{ id: "a", type: "create_activity" }] });
    expect(missing.ok).toBe(false);
  });

  it("rejects unreachable steps, backward jumps and unknown targets", () => {
    const steps = [
      { id: "check", type: "condition", conditions: [{ field: "lead.country", op: "eq", value: "DE" }], then: "end", else: "end" },
      { id: "orphan", type: "create_activity", subject: "never" },
    ];
    const r = validateDefinition({ ...base, steps });
    expect(r.ok === false && r.issues.some((i) => i.message.includes("can never run"))).toBe(true);
    const loop = validateDefinition({ ...base, steps: [{ id: "a", type: "create_activity", subject: "x" }, { id: "b", type: "create_activity", subject: "y", next: "a" }] });
    expect(loop.ok === false && loop.issues.some((i) => i.message.includes("forward"))).toBe(true);
    const missingTarget = validateDefinition({ ...base, steps: [{ id: "a", type: "create_activity", subject: "x", next: "nope" }] });
    expect(missingTarget.ok === false && missingTarget.issues.some((i) => i.message.includes("Unknown step"))).toBe(true);
  });

  it("only allows allowlisted variables and update fields", () => {
    const badVar = validateDefinition({ ...base, steps: [{ id: "a", type: "create_activity", subject: "{{profile.password}}" }] });
    expect(badVar.ok === false && badVar.issues[0]!.message).toContain("Unknown variable");
    const badField = validateDefinition({ ...base, steps: [{ id: "a", type: "update_record", fields: { owner_id: "x" } }] });
    expect(badField.ok === false && badField.issues[0]!.message).toContain("not an allowed field");
    const role = validateDefinition({ trigger: { type: "record.created", entity: "order" }, steps: [{ id: "a", type: "update_record", fields: { role: "admin" } }] });
    expect(role.ok).toBe(false);
  });

  it("caps the number of steps", () => {
    const steps = Array.from({ length: 21 }, (_, i) => ({ id: `s${i}`, type: "create_activity", subject: "x" }));
    expect(validateDefinition({ ...base, steps }).ok).toBe(false);
  });
});

describe("conditions and branches", () => {
  const vars = { "lead.country": "DE", "lead.estimated_value": 12000, "lead.owner_id": null };
  it("evaluates operators", () => {
    expect(evaluateConditions([{ field: "lead.country", op: "eq", value: "DE" }], "all", vars)).toBe(true);
    expect(evaluateConditions([{ field: "lead.estimated_value", op: "gt", value: 10000 }, { field: "lead.owner_id", op: "is_empty" }], "all", vars)).toBe(true);
    expect(evaluateConditions([{ field: "lead.country", op: "in", value: ["FR", "NL"] }], "all", vars)).toBe(false);
    expect(evaluateConditions([{ field: "lead.country", op: "in", value: ["FR"] }, { field: "lead.country", op: "neq", value: "FR" }], "any", vars)).toBe(true);
  });
  it("selects the branch", () => {
    const steps = EXAMPLE_WORKFLOWS[2]!.definition.steps;
    expect(nextStepId(steps, 0, true)).toBe("notify");
    expect(nextStepId(steps, 0, false)).toBe("end");
    expect(nextStepId(steps, 1)).toBe("log");
    expect(nextStepId(steps, 2)).toBe("end");
  });
});

describe("templates", () => {
  it("resolves allowlisted variables only and strips control characters", () => {
    const allowed = variablesFor("deal");
    expect(renderTemplate("Won {{deal.name}} for {{ deal.amount }}", { "deal.name": "Pump line", "deal.amount": 5000 }, allowed)).toBe("Won Pump line for 5000");
    expect(renderTemplate("{{profile.password}}", { "profile.password": "secret" }, allowed)).toBe("");
    expect(renderTemplate("a{{deal.name}}b", { "deal.name": "x\u0000\u0007y" }, allowed)).toBe("axyb");
  });
});

describe("business days", () => {
  it("skips weekends", () => {
    expect(addBusinessDays(new Date("2026-10-23T10:00:00Z"), 1).toISOString()).toBe("2026-10-26T10:00:00.000Z");
    expect(addBusinessDays(new Date("2026-10-20T10:00:00Z"), 1).toISOString()).toBe("2026-10-21T10:00:00.000Z");
  });
});
