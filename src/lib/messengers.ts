/**
 * Messenger and social channels stored on a contact, with validation and a "start a chat" link.
 * Shared by the server (validation) and the UI (forms, links). No secrets here: these are the
 * contact's public handles and numbers.
 */
import { z } from "zod";

export const MESSENGER_CHANNELS = ["telegram", "whatsapp", "viber", "instagram", "facebook", "vk", "linkedin", "wechat"] as const;
export type MessengerChannel = (typeof MESSENGER_CHANNELS)[number];

const PHONE = /^\+[1-9][0-9]{6,14}$/;

type ChannelSpec = {
  label: string;
  placeholder: string;
  hint: string;
  /** Normalizes user input; returns null when it is not a valid value for the channel. */
  normalize: (raw: string) => string | null;
  /** Link that opens a chat or the profile; null when the channel has no web link. */
  link: (value: string) => string | null;
};

const handle = (re: RegExp) => (raw: string) => {
  const v = raw.trim().replace(/^@/, "");
  return re.test(v) ? v : null;
};
const phone = (raw: string) => {
  const v = raw.replace(/[\s()-]/g, "");
  const withPlus = v.startsWith("+") ? v : `+${v}`;
  return PHONE.test(withPlus) ? withPlus : null;
};
/** Accepts a bare handle or a profile URL on the given host, e.g. instagram.com/name. */
const handleOrUrl = (host: RegExp, re: RegExp) => (raw: string) => {
  const v = raw.trim();
  const fromUrl = v.match(new RegExp(`^(?:https?://)?(?:www\\.|m\\.)?${host.source}/(?:in/)?([^/?#]+)`, "i"));
  return handle(re)(fromUrl ? fromUrl[1]! : v);
};

export const MESSENGERS: Record<MessengerChannel, ChannelSpec> = {
  telegram: {
    label: "Telegram",
    placeholder: "@username or +7 999 123-45-67",
    hint: "Username (5–32 letters, digits, _) or a phone number in international format.",
    normalize: (raw) => handleOrUrl(/t\.me/, /^[A-Za-z][A-Za-z0-9_]{4,31}$/)(raw) ?? phone(raw),
    link: (v) => (v.startsWith("+") ? `https://t.me/${v}` : `https://t.me/${v}`),
  },
  whatsapp: {
    label: "WhatsApp",
    placeholder: "+7 999 123-45-67",
    hint: "Phone number in international format.",
    normalize: phone,
    link: (v) => `https://wa.me/${v.slice(1)}`,
  },
  viber: {
    label: "Viber",
    placeholder: "+7 999 123-45-67",
    hint: "Phone number in international format.",
    normalize: phone,
    link: (v) => `viber://chat?number=${encodeURIComponent(v)}`,
  },
  instagram: {
    label: "Instagram",
    placeholder: "@username",
    hint: "Username or profile link.",
    normalize: handleOrUrl(/instagram\.com/, /^[A-Za-z0-9._]{1,30}$/),
    link: (v) => `https://instagram.com/${v}`,
  },
  facebook: {
    label: "Facebook / Messenger",
    placeholder: "username",
    hint: "Username or profile link.",
    normalize: handleOrUrl(/facebook\.com/, /^[A-Za-z0-9.]{5,50}$/),
    link: (v) => `https://m.me/${v}`,
  },
  vk: {
    label: "VK",
    placeholder: "username or id123",
    hint: "Short name or id, or profile link.",
    normalize: handleOrUrl(/vk\.com/, /^[A-Za-z0-9_.]{2,32}$/),
    link: (v) => `https://vk.com/${v}`,
  },
  linkedin: {
    label: "LinkedIn",
    placeholder: "profile-name",
    hint: "Profile name from linkedin.com/in/…, or the link.",
    normalize: handleOrUrl(/linkedin\.com/, /^[A-Za-z0-9-]{3,100}$/),
    link: (v) => `https://www.linkedin.com/in/${v}`,
  },
  wechat: {
    label: "WeChat",
    placeholder: "WeChat ID",
    hint: "WeChat ID (6–20 characters). WeChat has no web chat link.",
    normalize: handle(/^[A-Za-z][A-Za-z0-9_-]{5,19}$/),
    link: () => null,
  },
};

export type Messengers = Partial<Record<MessengerChannel, string>>;

/** Stored shape: only channels with a normalized value. */
export const messengersSchema = z
  .object(Object.fromEntries(MESSENGER_CHANNELS.map((c) => [c, z.string().max(120).optional()])) as Record<MessengerChannel, z.ZodOptional<z.ZodString>>)
  .strict();

/** Form/API input: empty strings are dropped; anything else must be valid for its channel and is normalized. */
export const messengersInput = z
  .record(z.enum(MESSENGER_CHANNELS), z.string().max(200).nullable().optional())
  .transform((raw, ctx) => {
    const out: Messengers = {};
    for (const channel of MESSENGER_CHANNELS) {
      const value = raw[channel]?.trim();
      if (!value) continue;
      const normalized = MESSENGERS[channel].normalize(value);
      if (!normalized) {
        ctx.addIssue({ code: "custom", path: [channel], message: `Not a valid ${MESSENGERS[channel].label} value. ${MESSENGERS[channel].hint}` });
        continue;
      }
      out[channel] = normalized;
    }
    return out;
  });

/** Channels that have a value, in display order, with their chat link. */
export function messengerLinks(m: Messengers | null | undefined): Array<{ channel: MessengerChannel; label: string; value: string; href: string | null }> {
  if (!m) return [];
  return MESSENGER_CHANNELS.filter((c) => m[c]).map((c) => ({ channel: c, label: MESSENGERS[c].label, value: c === "telegram" && !m[c]!.startsWith("+") ? `@${m[c]}` : m[c]!, href: MESSENGERS[c].link(m[c]!) }));
}
