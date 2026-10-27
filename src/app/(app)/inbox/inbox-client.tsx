"use client";

import { Archive, ArchiveRestore, Send } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { tr } from "@/lib/i18n";
import { replyAction, setConversationStatusAction } from "@/server/actions/inbox";

/** Keeps the inbox current: new conversations and messages show up without reloading. */
export function InboxRefresh({ every = 5000 }: { every?: number }) {
  const router = useRouter();
  useEffect(() => {
    const timer = setInterval(() => {
      if (!document.hidden) router.refresh();
    }, every);
    return () => clearInterval(timer);
  }, [router, every]);
  return null;
}

/** Scrolls the thread (its parent) to the newest message without moving the page. */
export function ScrollToEnd({ count }: { count: number }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const list = ref.current?.parentElement;
    if (list) list.scrollTop = list.scrollHeight;
  }, [count]);
  return <div ref={ref} />;
}

export function ReplyBox({ conversationId, channelName, disabledReason }: { conversationId: string; channelName: string; disabledReason: string | null }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [pending, start] = useTransition();
  const send = () =>
    start(async () => {
      const r = await replyAction({ conversation_id: conversationId, text });
      if (!r.ok) return void toast.error(r.fieldErrors?.text?.[0] ?? r.error);
      setText("");
      router.refresh();
    });
  return (
    <form
      className="space-y-2 border-t border-border p-3"
      onSubmit={(e) => {
        e.preventDefault();
        send();
      }}
    >
      {disabledReason && <p className="text-xs text-warning">{disabledReason}</p>}
      <div className="flex items-end gap-2">
        <Textarea
          aria-label={tr("Reply")}
          placeholder={tr("Reply in {p0}…", { p0: channelName })}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && text.trim()) send();
          }}
          rows={2}
          maxLength={4096}
          className="min-h-0 flex-1"
          disabled={!!disabledReason}
          data-testid="reply-text"
        />
        <Button type="submit" disabled={pending || !text.trim() || !!disabledReason} data-testid="reply-send">
          <Send aria-hidden />
          {pending ? tr("Sending…") : tr("Send")}
        </Button>
      </div>
      <p className="text-[11px] text-text-muted">{tr("Ctrl+Enter to send. The reply is also saved on the timeline.")}</p>
    </form>
  );
}

export function StatusButton({ id, status }: { id: string; status: "open" | "closed" }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      size="sm"
      variant="outline"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const r = await setConversationStatusAction({ id, status: status === "open" ? "closed" : "open" });
          if (!r.ok) return void toast.error(r.error);
          toast.success(status === "open" ? tr("Conversation closed") : tr("Conversation reopened"));
          router.refresh();
        })
      }
    >
      {status === "open" ? <Archive aria-hidden /> : <ArchiveRestore aria-hidden />}
      {status === "open" ? tr("Close") : tr("Reopen")}
    </Button>
  );
}
