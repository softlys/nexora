"use server";

import { z } from "zod";
import { serviceAction } from "@/server/service-action";
import { verifySecurityLog } from "@/server/services/security-log";

export async function verifySecurityLogAction(input: unknown) {
  return serviceAction({ name: "verifySecurityLog", schema: z.object({}).strict(), readOnly: true }, input, (ctx) => verifySecurityLog(ctx));
}
