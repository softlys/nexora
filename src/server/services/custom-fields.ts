import { z } from "zod";
import { CUSTOM_FIELD_ENTITIES, CUSTOM_FIELD_TYPES, fieldKey, normalizeCustom, type CustomFieldDef, type CustomFieldEntity, type CustomValues } from "@/domain/custom-fields";
import type { CustomField } from "@/domain/entities";
import type { Tx } from "@/server/db/types";
import { DomainError } from "@/server/repositories/types";
import { emit, newId, nowOf, requireCan, type ServiceContext } from "./context";

/** Validation problems tied to form fields (custom.<key>), shown next to each field. */
export class FieldErrors extends DomainError {
  constructor(public readonly fields: Record<string, string[]>) {
    super("Please fix the highlighted fields.", "invalid");
  }
}

const toDef = (f: CustomField): CustomFieldDef => ({ id: f.id, key: f.key, label: f.label, type: f.type, options: f.options, required: f.required, position: f.position });

export async function customFieldDefs(tx: Tx, entity: CustomFieldEntity): Promise<CustomFieldDef[]> {
  return (await tx.find("custom_fields", { entity, archived_at: null })).sort((a, b) => a.position - b.position || a.label.localeCompare(b.label)).map(toDef);
}

/**
 * Replaces the submitted `custom` object with validated values (see normalizeCustom). Without a
 * `custom` key the record's values are left as they are.
 */
export async function withCustom<T extends { custom?: unknown }>(tx: Tx, entity: CustomFieldEntity, fields: T, previous?: CustomValues): Promise<Omit<T, "custom"> & { custom?: CustomValues }> {
  const { custom, ...rest } = fields;
  if (custom === undefined) return rest;
  const defs = await customFieldDefs(tx, entity);
  const { values, issues } = normalizeCustom(defs, custom as Record<string, unknown>, previous ?? {});
  if (issues.length) throw new FieldErrors(Object.fromEntries(issues.map((i) => [`custom.${i.key}`, [i.message]])));
  // Values of archived fields stay on the record.
  const kept = Object.fromEntries(Object.entries(previous ?? {}).filter(([k]) => !defs.some((d) => d.key === k)));
  return { ...rest, custom: { ...kept, ...values } };
}

export async function listCustomFields(ctx: ServiceContext, entity?: CustomFieldEntity): Promise<CustomField[]> {
  return ctx.db.read(ctx.actor.organization_id, async (tx) =>
    (await tx.find("custom_fields", { archived_at: null })).filter((f) => !entity || f.entity === entity).sort((a, b) => a.entity.localeCompare(b.entity) || a.position - b.position),
  );
}

/** Definitions for the four record forms, in one read. */
export async function customFieldsByEntity(ctx: ServiceContext): Promise<Record<CustomFieldEntity, CustomFieldDef[]>> {
  const all = await listCustomFields(ctx);
  return Object.fromEntries(CUSTOM_FIELD_ENTITIES.map((e) => [e, all.filter((f) => f.entity === e).map(toDef)])) as Record<CustomFieldEntity, CustomFieldDef[]>;
}

export const customFieldInput = z
  .object({
    id: z.uuid().optional(),
    entity: z.enum(CUSTOM_FIELD_ENTITIES),
    label: z.string().trim().min(1, "Required").max(60),
    type: z.enum(CUSTOM_FIELD_TYPES),
    options: z.array(z.string().trim().min(1).max(60)).max(50).default([]),
    required: z.boolean().default(false),
  })
  .strict()
  .refine((f) => f.type !== "select" || f.options.length > 0, { path: ["options"], message: "Add at least one value to choose from" });

/** Admin: add a field or change its label, options and whether it is required (the type and key stay). */
export async function saveCustomField(ctx: ServiceContext, input: z.output<typeof customFieldInput>): Promise<CustomField> {
  requireCan(ctx, "manage", "organization");
  return ctx.db.write(ctx.actor.organization_id, async (tx) => {
    const at = nowOf(ctx).toISOString();
    const options = [...new Set(input.options)];
    if (input.id) {
      const current = await tx.get("custom_fields", input.id);
      if (!current || current.archived_at) throw new DomainError("Field not found.", "not_found");
      const updated = await tx.update("custom_fields", input.id, { label: input.label, options, required: input.required, updated_at: at });
      await emit(tx, ctx, { type: "record.updated", payload: { entity: "custom_field", id: input.id, changes: { label: { before: current.label, after: input.label } } } });
      return updated;
    }
    const existing = await tx.find("custom_fields", { entity: input.entity });
    let key = fieldKey(input.label);
    for (let n = 2; existing.some((f) => f.key === key); n++) key = `${fieldKey(input.label).slice(0, 36)}_${n}`;
    const field: CustomField = {
      id: newId(),
      organization_id: ctx.actor.organization_id,
      entity: input.entity,
      key,
      label: input.label,
      type: input.type,
      options,
      required: input.required,
      position: existing.filter((f) => !f.archived_at).length,
      created_at: at,
      updated_at: at,
      archived_at: null,
    };
    await tx.insert("custom_fields", field);
    await emit(tx, ctx, { type: "record.created", payload: { entity: "custom_field", id: field.id, after: field } });
    return field;
  });
}

/** Admin: hide a field from forms and pages. Values already saved stay on the records. */
export async function archiveCustomField(ctx: ServiceContext, id: string): Promise<void> {
  requireCan(ctx, "manage", "organization");
  await ctx.db.write(ctx.actor.organization_id, async (tx) => {
    const current = await tx.get("custom_fields", id);
    if (!current) throw new DomainError("Field not found.", "not_found");
    await tx.update("custom_fields", id, { archived_at: nowOf(ctx).toISOString(), updated_at: nowOf(ctx).toISOString() });
  });
}
