import { handleHook } from "@/server/integrations/hooks";

/** Inbound webhooks from external services (web forms, telephony, WhatsApp, payments). See docs/integrations.md. */
type Params = { params: Promise<{ provider: string; rest?: string[] }> };

export async function GET(request: Request, { params }: Params) {
  const { provider, rest } = await params;
  return handleHook("GET", request, provider, rest ?? []);
}

export async function POST(request: Request, { params }: Params) {
  const { provider, rest } = await params;
  return handleHook("POST", request, provider, rest ?? []);
}
