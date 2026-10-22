import { ExternalLink } from "lucide-react";
import { messengerLinks, type MessengerChannel, type Messengers } from "@/lib/messengers";
import { cn } from "@/lib/utils";

/** Brand color and a short mark for each channel (no third-party logos are bundled). */
const MARK: Record<MessengerChannel, { short: string; color: string }> = {
  telegram: { short: "TG", color: "#229ED9" },
  whatsapp: { short: "WA", color: "#1FAF5A" },
  viber: { short: "Vb", color: "#7360F2" },
  instagram: { short: "IG", color: "#D62976" },
  facebook: { short: "FB", color: "#0866FF" },
  vk: { short: "VK", color: "#0077FF" },
  linkedin: { short: "in", color: "#0A66C2" },
  wechat: { short: "WC", color: "#07A35A" },
};

export function MessengerMark({ channel, className }: { channel: MessengerChannel; className?: string }) {
  const m = MARK[channel];
  return (
    <span className={cn("inline-flex size-6 shrink-0 items-center justify-center rounded-md text-[10px] font-bold text-white", className)} style={{ backgroundColor: m.color }} aria-hidden>
      {m.short}
    </span>
  );
}

/** One row per channel with a "Write" link that opens the chat in the messenger. */
export function MessengerLinks({ messengers, emptyText = "No messengers saved." }: { messengers: Messengers | null | undefined; emptyText?: string }) {
  const links = messengerLinks(messengers);
  if (links.length === 0) return <p className="text-sm text-text-muted">{emptyText}</p>;
  return (
    <ul className="space-y-2" data-testid="messenger-links">
      {links.map((l) => (
        <li key={l.channel} className="flex items-center gap-3">
          <MessengerMark channel={l.channel} />
          <span className="min-w-0 flex-1">
            <span className="block text-xs text-text-muted">{l.label}</span>
            <span className="block truncate text-sm">{l.value}</span>
          </span>
          {l.href ? (
            <a
              href={l.href}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-7 items-center gap-1 rounded-md border border-border px-2 text-xs hover:bg-surface-muted focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
              aria-label={`Write on ${l.label}`}
            >
              Write
              <ExternalLink className="size-3" aria-hidden />
            </a>
          ) : (
            <span className="text-xs text-text-muted">In app only</span>
          )}
        </li>
      ))}
    </ul>
  );
}

/** Compact marks for list rows: which channels a contact can be reached on. */
export function MessengerMarks({ messengers }: { messengers: Messengers | null | undefined }) {
  const links = messengerLinks(messengers);
  if (links.length === 0) return null;
  return (
    <span className="inline-flex gap-1" aria-label={`Reachable on ${links.map((l) => l.label).join(", ")}`}>
      {links.map((l) =>
        l.href ? (
          <a key={l.channel} href={l.href} target="_blank" rel="noopener noreferrer" title={`${l.label}: ${l.value}`} className="rounded-md focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none">
            <MessengerMark channel={l.channel} className="size-5 text-[9px]" />
          </a>
        ) : (
          <span key={l.channel} title={`${l.label}: ${l.value}`}>
            <MessengerMark channel={l.channel} className="size-5 text-[9px]" />
          </span>
        ),
      )}
    </span>
  );
}
