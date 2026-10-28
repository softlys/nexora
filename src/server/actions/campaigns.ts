"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { campaignSegmentSchema } from "@/domain/entities";
import { getDataMode } from "@/server/env";
import { outboundEmail } from "@/server/integrations/outbound-email";
import { currentBaseUrl } from "@/server/integrations/public-url";
import { smsSender } from "@/server/integrations/sms";
import { serviceAction } from "@/server/service-action";
import { campaignInput, previewSegment, saveCampaign, sendCampaign } from "@/server/services/campaigns";
import { serverSecret } from "@/server/session-signing";

export async function saveCampaignAction(input: unknown) {
  return serviceAction({ name: "saveCampaign", schema: campaignInput }, input, async (ctx, data) => {
    const campaign = await saveCampaign(ctx, data);
    revalidatePath("/campaigns");
    return { id: campaign.id };
  });
}

/** How many contacts a segment reaches, while the campaign is being written. */
export async function previewSegmentAction(input: unknown) {
  return serviceAction({ name: "previewSegment", schema: z.object({ segment: campaignSegmentSchema, channel: z.enum(["email", "sms"]) }).strict(), readOnly: true }, input, (ctx, data) => previewSegment(ctx, data.segment, data.channel));
}

export async function sendCampaignAction(input: unknown) {
  return serviceAction({ name: "sendCampaign", schema: z.object({ id: z.uuid() }).strict(), bucket: "create" }, input, async (ctx, { id }) => {
    const campaign = await sendCampaign(ctx, id, { email: outboundEmail(), sms: smsSender(), simulate: getDataMode() === "demo", baseUrl: await currentBaseUrl(), secret: await serverSecret() });
    revalidatePath("/campaigns");
    return { sent: campaign.sent, failed: campaign.failed, skipped: campaign.skipped, simulated: campaign.simulated };
  });
}
