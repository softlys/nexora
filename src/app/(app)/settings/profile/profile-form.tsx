"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import type { z } from "zod";
import { FormField, SettingsCard } from "@/components/patterns/form-field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { updateProfileInput } from "@/domain/entities";
import { applyServerErrors } from "@/lib/forms";
import { updateProfileAction } from "@/server/actions/settings";

type Values = z.input<typeof updateProfileInput>;

export function ProfileForm({ defaults, email, roleLabel }: { defaults: Values; email: string; roleLabel: string }) {
  const form = useForm<Values>({ resolver: zodResolver(updateProfileInput), defaultValues: defaults });
  const { register, handleSubmit, formState, setError, reset } = form;

  const onSubmit = handleSubmit(async (values) => {
    const result = await updateProfileAction(values);
    if (!result.ok) return applyServerErrors(result, setError);
    reset(values);
    toast.success("Profile saved");
  });

  return (
    <form onSubmit={onSubmit} noValidate>
      <SettingsCard
        title="Profile"
        description="How you appear to your team."
        footer={
          <Button type="submit" disabled={formState.isSubmitting || !formState.isDirty}>
            {formState.isSubmitting ? "Saving…" : "Save changes"}
          </Button>
        }
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField id="full_name" label="Full name" error={formState.errors.full_name?.message}>
            <Input id="full_name" autoComplete="name" aria-invalid={!!formState.errors.full_name} {...register("full_name")} />
          </FormField>
          <FormField id="title" label="Job title" error={formState.errors.title?.message}>
            <Input id="title" autoComplete="organization-title" aria-invalid={!!formState.errors.title} {...register("title")} />
          </FormField>
          <FormField id="email" label="Email" hint="Managed by your sign-in provider.">
            <Input id="email" value={email} readOnly disabled />
          </FormField>
          <FormField id="role" label="Role" hint="Only an admin can change roles.">
            <Input id="role" value={roleLabel} readOnly disabled />
          </FormField>
        </div>
      </SettingsCard>
    </form>
  );
}
