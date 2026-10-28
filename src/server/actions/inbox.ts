"use server";

import { revalidatePath } from "next/cache";
import { channelSenders } from "@/server/integrations/chat";
import { serviceAction } from "@/server/service-action";
import { assignConversation, assignConversationInput, conversationStatusInput, dealFromConversation, dealFromConversationInput, quickRepliesInput, replyInput, replyToConversation, saveQuickReplies, setConversationStatus } from "@/server/services/inbox";

/** Replies to a customer in the conversation's own channel. */
export async function replyAction(input: unknown) {
  return serviceAction({ name: "replyToConversation", schema: replyInput, bucket: "create" }, input, async (ctx, data) => {
    const message = await replyToConversation(ctx, channelSenders(), data);
    revalidatePath("/inbox");
    return { id: message.id };
  });
}

/** Closes a conversation (it reopens when the customer writes again) or reopens it. */
export async function setConversationStatusAction(input: unknown) {
  return serviceAction({ name: "setConversationStatus", schema: conversationStatusInput }, input, async (ctx, data) => {
    await setConversationStatus(ctx, data);
    revalidatePath("/inbox");
    return undefined;
  });
}

/** Assigns a chat to a manager (or takes it). */
export async function assignConversationAction(input: unknown) {
  return serviceAction({ name: "assignConversation", schema: assignConversationInput }, input, async (ctx, data) => {
    await assignConversation(ctx, data);
    revalidatePath("/inbox");
    return undefined;
  });
}

/** Saves the organization's quick replies. */
export async function saveQuickRepliesAction(input: unknown) {
  return serviceAction({ name: "saveQuickReplies", schema: quickRepliesInput }, input, async (ctx, data) => {
    await saveQuickReplies(ctx, data);
    revalidatePath("/inbox");
    return undefined;
  });
}

/** Opens a deal for the chat's contact and returns its id. */
export async function dealFromConversationAction(input: unknown) {
  return serviceAction({ name: "dealFromConversation", schema: dealFromConversationInput, bucket: "create" }, input, async (ctx, data) => {
    const deal = await dealFromConversation(ctx, data);
    revalidatePath("/pipeline");
    return { id: deal.id };
  });
}
