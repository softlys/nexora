/** Labels shared by the integrations pages (client and server). */
export type IntegrationStatus = "not_configured" | "configured" | "connected" | "error";

export const STATUS_LABELS: Record<IntegrationStatus, string> = {
  not_configured: "Not configured",
  configured: "Configured (untested)",
  connected: "Connected",
  error: "Error",
};

export const STATUS_HINTS: Record<IntegrationStatus, string> = {
  not_configured: "No endpoint saved yet.",
  configured: "Saved, but no test event has been sent since the last change.",
  connected: "The last signed test event got a 2xx response.",
  error: "The last test event failed. See the delivery log.",
};

export type ProviderKey = "make" | "n8n" | "generic_webhook" | "email";

export const PROVIDER_NAMES: Record<ProviderKey, string> = {
  make: "Make",
  n8n: "n8n",
  generic_webhook: "Generic webhook",
  email: "Email provider",
};

/** URL segment under /integrations for each provider. */
export const PROVIDER_PATHS: Record<ProviderKey, string> = {
  make: "/integrations/make",
  n8n: "/integrations/n8n",
  generic_webhook: "/integrations/webhooks",
  email: "/integrations/email",
};
