import "server-only";
import nodemailer from "nodemailer";
import type { EmailSender } from "@/server/automation/engine";

/**
 * Outgoing e-mail: Resend (RESEND_API_KEY) or any SMTP server (SMTP_HOST…), for example Yandex 360
 * (smtp.yandex.ru:465), Mail.ru (smtp.mail.ru:465) or Unisender Go, which keeps mail with Russian
 * providers (152-FZ). NEXORA_EMAIL_FROM is the sender in both cases. Resend wins when both are set.
 */

export type EmailProvider = "resend" | "smtp";

export function smtpConfig(env: NodeJS.ProcessEnv = process.env) {
  const host = env.SMTP_HOST?.trim();
  const user = env.SMTP_USER?.trim();
  const password = env.SMTP_PASSWORD?.trim();
  if (!host || !user || !password) return null;
  const port = Number(env.SMTP_PORT || 465);
  return { host, port, secure: port === 465, user, password };
}

export function emailProvider(env: NodeJS.ProcessEnv = process.env): EmailProvider | null {
  if (!env.NEXORA_EMAIL_FROM?.trim()) return null;
  if (env.RESEND_API_KEY?.trim()) return "resend";
  return smtpConfig(env) ? "smtp" : null;
}

function resendSender(key: string, from: string): EmailSender {
  return {
    configured: true,
    async send(message) {
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from, to: message.to, subject: message.subject, text: message.text, ...(message.replyTo && { reply_to: message.replyTo }) }),
        signal: AbortSignal.timeout(4_000),
      });
      if (!response.ok) throw new Error(`Email provider returned ${response.status}`);
      const body = (await response.json()) as { id?: string };
      return { id: body.id ?? "unknown" };
    },
  };
}

function smtpSender(config: NonNullable<ReturnType<typeof smtpConfig>>, from: string): EmailSender {
  const transport = nodemailer.createTransport({ host: config.host, port: config.port, secure: config.secure, auth: { user: config.user, pass: config.password }, connectionTimeout: 8_000, greetingTimeout: 8_000, socketTimeout: 15_000 });
  return {
    configured: true,
    async send(message) {
      const info = await transport.sendMail({ from, to: message.to, subject: message.subject, text: message.text, ...(message.replyTo && { replyTo: message.replyTo }) });
      return { id: info.messageId ?? "unknown" };
    },
  };
}

/** The configured sender, or one that reports "not configured" (steps are then skipped, never faked). */
export function outboundEmail(env: NodeJS.ProcessEnv = process.env): EmailSender {
  const from = env.NEXORA_EMAIL_FROM?.trim() ?? "";
  const provider = emailProvider(env);
  if (provider === "resend") return resendSender(env.RESEND_API_KEY!.trim(), from);
  if (provider === "smtp") return smtpSender(smtpConfig(env)!, from);
  return {
    configured: false,
    async send() {
      throw new Error("E-mail is not configured.");
    },
  };
}
