"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { getDataMode } from "@/server/env";
import { createSupabaseServerClient } from "@/server/supabase/server";

const loginInput = z
  .object({
    email: z.email().max(254),
    password: z.string().min(1).max(200),
  })
  .strict();

export type LoginState = { error: string | null };

/** Supabase mode sign-in. Demo mode has no login and redirects home. */
export async function loginAction(_prev: LoginState, formData: FormData): Promise<LoginState> {
  if (getDataMode() !== "supabase") redirect("/");
  const parsed = loginInput.safeParse({ email: formData.get("email"), password: formData.get("password") });
  if (!parsed.success) return { error: "Enter a valid email and password." };

  const db = await createSupabaseServerClient();
  const { error } = await db.auth.signInWithPassword(parsed.data);
  // Same message for unknown email and wrong password, so accounts cannot be enumerated.
  if (error) return { error: "Email or password is incorrect." };
  redirect("/");
}
