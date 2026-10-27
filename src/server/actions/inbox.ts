"use server";

import { revalidatePath } from "next/cache";
import { channelSenders } from "@/server/integrations/chat";
import { serviceAction } from "@/server/service-action";
import { conversationStatusInput, replyInput, replyToConversation, setConversationStatus } from "@/server/services/inbox";

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
