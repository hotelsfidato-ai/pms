import { useState } from "react";
import { Link } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { dateTime } from "@/lib/format";
import { useRole } from "@/lib/session";
import { Button, Card, CardBody, CardHeader, Field, fieldProps, StatusPill, Textarea } from "@/components/ui";
import { getDeskMessages, handleRequest, replyToGuest } from "@/modules/online-checkin/data/desk";
import { DESK_ROLES } from "@/modules/online-checkin/nav";

/* ══════════════════════════════════════════════════════════════════
   MESSAGES TO THE FRONT DESK (D23-14) - drawn inside Guest messages

   What a guest typed in "Message the front desk" on their own page. On a
   booking's Guest messages (`?reservation=`) every message it sent, the
   handled ones with who and when; on the property's, every booking's
   unread ones. Unread until somebody marks it handled.

   REPLIES (D27-224): on a booking's Guest messages, under its messages,
   one box. The guest reads the reply on their own page as "Front desk";
   nothing goes on WhatsApp. A reply marks the booking's unread messages
   handled. None once the guest has checked out - the server says whether
   the box is offered. On the property's list, each unread message links to
   its booking's, to reply there.

   The guest's words are a text node: React escapes them, and nothing here
   draws them as HTML. Only the desk's roles (the server's DESK_ROLES) are
   shown this; for anybody else it draws nothing and asks nothing.
   ══════════════════════════════════════════════════════════════════ */
export default function MessagesToTheDesk(
  { code, reservation }: { code: string; reservation?: string },
) {
  const desk = DESK_ROLES.includes(useRole());
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["desk-messages", code, reservation ?? "unread"],
    queryFn: () => getDeskMessages(code, reservation),
    enabled: desk && !!code,
    /* A count read once and kept is a count that is wrong: asked again
       every time the screen opens. */
    staleTime: 0,
  });
  const handle = useMutation({
    mutationFn: (id: string) => handleRequest(code, id, "done"),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["desk-messages", code] }),
  });
  const [reply, setReply] = useState("");
  const send = useMutation({
    mutationFn: () => replyToGuest(code, reservation!, reply.trim()),
    onSuccess: async () => {
      setReply("");
      await qc.invalidateQueries({ queryKey: ["desk-messages", code] });
    },
  });

  if (!desk) return null;
  if (q.isError) {
    return (
      <Card><CardBody>
        <p className="text-sm text-brand-red-700">
          Messages from guests did not load. {(q.error as Error).message}
        </p>
      </CardBody></Card>
    );
  }
  const messages = q.data?.messages ?? [];
  if (messages.length === 0) return null;
  const unread = messages.filter((m) => !m.handledAt).length;
  /* The guest's messages and the desk's replies, in one list, newest first. */
  const lines = [
    ...messages.map((m) => ({ at: m.createdAt, m, r: null })),
    ...(q.data?.replies ?? []).map((r) => ({ at: r.sentAt, m: null, r })),
  ].sort((a, b) => b.at.localeCompare(a.at));

  return (
    <Card>
      <CardHeader
        title={reservation ? "Messages from the guest" : "Messages from guests"}
        actions={unread > 0 && <StatusPill tone="warning">{unread} unread</StatusPill>}
      />
      {/* List rows: 16px sides as the card's, 12px top and bottom. */}
      <ul className="divide-y divide-grey-100">
        {lines.map(({ m, r }) => r ? (
          <li key={r.id} className="px-4 py-3 min-h-14 bg-grey-50">
            <p className="text-sm font-semibold text-ink-900">Reply from the front desk</p>
            <p className="text-base text-ink-900 whitespace-pre-line break-words mt-0.5">{r.what}</p>
            <p className="text-sm text-grey-600 mt-0.5">
              {r.sentBy ?? "A member of staff"}, {dateTime(r.sentAt)}
            </p>
          </li>
        ) : m && (
          <li key={m.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 min-h-14">
            <div className="min-w-0 flex-1">
              <p className="text-base text-ink-900 whitespace-pre-line break-words">{m.what}</p>
              <p className="text-sm text-grey-600 mt-0.5">
                {m.guest} · {m.reference} · {dateTime(m.createdAt)}
              </p>
              {m.handledAt && (
                <p className="text-sm text-grey-600 mt-0.5">
                  Handled by {m.handledBy ?? "a member of staff"}, {dateTime(m.handledAt)}
                </p>
              )}
            </div>
            {!m.handledAt && !reservation && m.reservationId && (
              <Link to={`/h/${encodeURIComponent(code)}/guest-messages?reservation=${encodeURIComponent(m.reservationId)}`}
                className="text-sm text-brand-orange-700 hover:underline font-medium">
                Reply
              </Link>
            )}
            {!m.handledAt && (
              <Button variant="secondary" disabled={handle.isPending} onClick={() => handle.mutate(m.id)}>
                Mark handled
              </Button>
            )}
          </li>
        ))}
      </ul>
      {handle.error && (
        <p className="px-4 pb-3.5 text-sm text-brand-red-700">{(handle.error as Error).message}</p>
      )}
      {reservation && (q.data?.canReply ? (
        <form onSubmit={(e) => { e.preventDefault(); send.mutate(); }}
          className="flex flex-col gap-3 px-4 py-3.5 border-t border-grey-100">
          <Field label="Reply to the guest"
            hint="They see it on their own page as “Front desk”. It is not sent on WhatsApp.">
            {(f) => (
              <Textarea {...fieldProps(f)} rows={3} maxLength={500}
                value={reply} onChange={(e) => setReply(e.target.value)} />
            )}
          </Field>
          <div>
            <Button type="submit" disabled={send.isPending || reply.trim() === ""}>
              {send.isPending ? "Sending…" : "Send reply"}
            </Button>
          </div>
          {send.error && <p className="text-sm text-brand-red-700">{(send.error as Error).message}</p>}
        </form>
      ) : (
        <p className="px-4 py-3.5 border-t border-grey-100 text-sm text-grey-600">
          This guest has checked out. Replies stop at check-out.
        </p>
      ))}
    </Card>
  );
}
