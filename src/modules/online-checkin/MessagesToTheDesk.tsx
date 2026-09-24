import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { dateTime } from "@/lib/format";
import { useRole } from "@/lib/session";
import { Button, Card, CardBody, CardHeader, StatusPill } from "@/components/ui";
import { getDeskMessages, handleRequest } from "@/modules/online-checkin/data/desk";
import { DESK_ROLES } from "@/modules/online-checkin/nav";

/* ══════════════════════════════════════════════════════════════════
   MESSAGES TO THE FRONT DESK (D23-14) - drawn inside Guest messages

   What a guest typed in "Message the front desk" on their own page. On a
   booking's Guest messages (`?reservation=`) every message it sent, the
   handled ones with who and when; on the property's, every booking's
   unread ones. Unread until somebody marks it handled.

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

  if (!desk) return null;
  if (q.isError) {
    return (
      <Card><CardBody>
        <p className="text-sm text-brand-red">
          Messages from guests did not load. {(q.error as Error).message}
        </p>
      </CardBody></Card>
    );
  }
  const messages = q.data?.messages ?? [];
  if (messages.length === 0) return null;
  const unread = messages.filter((m) => !m.handledAt).length;

  return (
    <Card>
      <CardHeader
        title={reservation ? "Messages from the guest" : "Messages from guests"}
        actions={unread > 0 && <StatusPill tone="warning">{unread} unread</StatusPill>}
      />
      <ul className="divide-y divide-grey-200">
        {messages.map((m) => (
          <li key={m.id} className="flex flex-wrap items-start justify-between gap-3 px-5 py-3">
            <div className="min-w-0">
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
            {!m.handledAt && (
              <Button variant="secondary" disabled={handle.isPending} onClick={() => handle.mutate(m.id)}>
                Mark handled
              </Button>
            )}
          </li>
        ))}
      </ul>
      {handle.error && (
        <p className="px-5 pb-3 text-sm text-brand-red">{(handle.error as Error).message}</p>
      )}
    </Card>
  );
}
