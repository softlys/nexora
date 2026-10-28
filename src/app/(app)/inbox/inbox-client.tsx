"use client";

import { Archive, ArchiveRestore, Briefcase, MessageSquareText, Pencil, Send } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { tr } from "@/lib/i18n";
import { assignConversationAction, dealFromConversationAction, replyAction, saveQuickRepliesAction, setConversationStatusAction } from "@/server/actions/inbox";

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

export function ReplyBox({ conversationId, channelName, disabledReason, quickReplies, canEditReplies }: { conversationId: string; channelName: string; disabledReason: string | null; quickReplies: string[]; canEditReplies: boolean }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [editing, setEditing] = useState(false);
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
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="outline" size="icon" aria-label={tr("Quick replies")} title={tr("Quick replies")} disabled={!!disabledReason} data-testid="quick-replies">
              <MessageSquareText aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-80">
            {quickReplies.length === 0 && <p className="px-2 py-1.5 text-sm text-text-muted">{tr("No quick replies yet.")}</p>}
            {quickReplies.map((r, i) => (
              <DropdownMenuItem key={i} onSelect={() => setText((cur) => (cur.trim() ? `${cur.trimEnd()}\n${r}` : r))} className="line-clamp-2 block">
                {r}
              </DropdownMenuItem>
            ))}
            {canEditReplies && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => setEditing(true)}>
                  <Pencil aria-hidden />
                  {tr("Edit quick replies")}
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
        <Button type="submit" disabled={pending || !text.trim() || !!disabledReason} data-testid="reply-send">
          <Send aria-hidden />
          {pending ? tr("Sending…") : tr("Send")}
        </Button>
      </div>
      <p className="text-[11px] text-text-muted">{tr("Ctrl+Enter to send. The reply is also saved on the timeline.")}</p>
      {editing && <QuickRepliesEditor initial={quickReplies} onClose={() => setEditing(false)} />}
    </form>
  );
}

/** One quick reply per paragraph; empty lines separate them. */
function QuickRepliesEditor({ initial, onClose }: { initial: string[]; onClose: () => void }) {
  const router = useRouter();
  const [value, setValue] = useState(initial.join("\n\n"));
  const [pending, start] = useTransition();
  const save = () =>
    start(async () => {
      const replies = value.split(/\n\s*\n/).map((r) => r.trim()).filter(Boolean);
      const r = await saveQuickRepliesAction({ replies });
      if (!r.ok) return void toast.error(r.error);
      toast.success(tr("Quick replies saved"));
      onClose();
      router.refresh();
    });
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{tr("Quick replies")}</DialogTitle>
          <DialogDescription>{tr("Ready answers for the whole team. Separate replies with an empty line (up to 30).")}</DialogDescription>
        </DialogHeader>
        <Textarea value={value} onChange={(e) => setValue(e.target.value)} rows={12} aria-label={tr("Quick replies")} data-testid="quick-replies-text" />
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {tr("Cancel")}
          </Button>
          <Button onClick={save} disabled={pending} data-testid="save-quick-replies">
            {pending ? tr("Saving…") : tr("Save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const NOBODY = "none";

/** Who answers the chat. Sales reps can only take it themselves. */
export function AssigneeSelect({ id, assigneeId, users, me, canAssignOthers }: { id: string; assigneeId: string | null; users: Array<{ id: string; name: string }>; me: string; canAssignOthers: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const assign = (value: string) =>
    start(async () => {
      const r = await assignConversationAction({ id, assignee_id: value === NOBODY ? null : value });
      if (!r.ok) return void toast.error(r.error);
      router.refresh();
    });
  if (!canAssignOthers && assigneeId !== me)
    return (
      <Button size="sm" variant="outline" disabled={pending} onClick={() => assign(me)} data-testid="take-chat">
        {tr("Take the chat")}
      </Button>
    );
  return (
    <Select value={assigneeId ?? NOBODY} onValueChange={assign} disabled={pending || !canAssignOthers}>
      <SelectTrigger size="sm" className="w-44" aria-label={tr("Assignee")} data-testid="assignee">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NOBODY}>{tr("Not assigned")}</SelectItem>
        {users.map((u) => (
          <SelectItem key={u.id} value={u.id}>
            {u.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** Opens a deal for the chat's contact and goes to it. */
export function DealFromChatButton({ id }: { id: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      size="sm"
      variant="outline"
      disabled={pending}
      data-testid="deal-from-chat"
      onClick={() =>
        start(async () => {
          const r = await dealFromConversationAction({ id });
          if (!r.ok) return void toast.error(r.error);
          toast.success(tr("Deal created"));
          router.push(`/deals/${r.data.id}`);
        })
      }
    >
      <Briefcase aria-hidden />
      {tr("Create deal")}
    </Button>
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
