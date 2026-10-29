"use server";

import { z } from "zod";
import { serviceAction } from "@/server/service-action";
import { getDataMode } from "@/server/env";
import { DomainError } from "@/server/repositories/types";
import { currentIncomingCall, simulateIncomingCall, startCall, startCallInput } from "@/server/services/calls";
import { revalidatePath } from "next/cache";
import { locale } from "@/lib/i18n";
import { aiCompletion } from "@/server/integrations/ai";
import { speechkitTranscriber } from "@/server/integrations/speech";
import { summarizeCall } from "@/server/services/call-summary";

/** Click-to-call: the PBX rings the user's phone, then the record's number. */
export async function startCallAction(input: unknown) {
  return serviceAction({ name: "startCall", schema: startCallInput, bucket: "create" }, input, (ctx, data) => startCall(ctx, data));
}

/** Polled by the app shell: the incoming call card to show, if any. */
export async function incomingCallAction(input: unknown) {
  return serviceAction({ name: "incomingCall", schema: z.object({}).strict(), readOnly: true, bucket: "poll" }, input, (ctx) => currentIncomingCall(ctx));
}

/** Demo mode: simulate a customer calling the current user. */
export async function simulateIncomingCallAction(input: unknown) {
  return serviceAction({ name: "simulateIncomingCall", schema: z.object({}).strict() }, input, (ctx) => {
    if (getDataMode() !== "demo") throw new DomainError("Call simulation is only available in demo mode.");
    return simulateIncomingCall(ctx);
  });
}

/** Transcribes a call recording and adds a short AI summary next to the call. */
export async function summarizeCallAction(input: unknown) {
  return serviceAction({ name: "summarizeCall", schema: z.object({ activity_id: z.uuid(), path: z.string().regex(/^\/[a-z]+\/[0-9a-f-]{36}$/) }).strict(), bucket: "ai" }, input, async (ctx, data) => {
    const note = await summarizeCall(ctx, data.activity_id, { transcribe: speechkitTranscriber(), complete: aiCompletion()?.complete ?? null, language: locale() === "ru" ? "ru" : "en" });
    revalidatePath(data.path);
    return { id: note.id };
  });
}
