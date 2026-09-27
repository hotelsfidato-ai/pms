import { useQuery } from "@tanstack/react-query";
import { useParams, useSearchParams } from "react-router";
import { MessageSquare, Mail, Phone } from "lucide-react";
import { dateShort } from "@/lib/format";
import { ApiError } from "@/lib/api";
import {
  Page, PageHeader, Card, CardHeader, CardBody, Skeleton, EmptyState, ErrorState,
  DataTable, StatusPill, type Column, type Tone,
} from "@/components/ui";
import {
  getGuestMessages, type SentMessage,
} from "@/modules/guest-messaging/data/guestMessages";
import { MessagesToTheDesk } from "@/modules/online-checkin";

/* ══════════════════════════════════════════════════════════════════
   WHAT WAS SENT TO THIS GUEST

   "Did the guest get their confirmation?" is asked at the desk, the day
   after, by somebody who was not there. Until migration 117 the honest
   answer was that nobody knew - n8n's own log is behind a sign-in the
   desk does not have, and it is pruned.

   ⚠ THIS SCREEN NEVER SENDS AND HAS NO BUTTON THAT DOES. The two
   messages this system sends by itself (D18-11, D18-12) go out on their
   own; a bill after check-out stays a button somebody presses, and that
   button is the front desk's (D17-34, D17-91). What is here is the
   record.

   ⚠ AND IT IS HONEST ABOUT BEING SWITCHED OFF. An empty list means one
   of two completely different things, and the difference is the whole of
   what the desk needs: nothing has been sent, or nothing CAN be. The
   notice says which, in the sender's own words, and it is not a screen
   that looks broken.
   ══════════════════════════════════════════════════════════════════ */

const STATUS_WORDS: Record<string, string> = {
  sent: "Delivered to the sender",
  failed: "Did not go",
};

const STATUS_TONE: Record<string, Tone> = {
  sent: "success",
  failed: "danger",
};

const unreachable = (error: unknown) =>
  error instanceof ApiError && error.status === 0;

/** Where it went, in the form the channel uses. A message with neither
    is not a message that was attempted, so this never reads blank. */
const wentTo = (m: SentMessage) =>
  (m.channel === "email" ? m.to.email : m.to.phone) ?? m.to.email ?? m.to.phone ?? "-";

export default function GuestMessagesPage() {
  const { code = "" } = useParams<{ code: string }>();
  const [params] = useSearchParams();
  /* One booking, when the desk arrived here asking about one. The server
     filters on migration 117's own index. */
  const reservation = params.get("reservation") ?? undefined;

  const q = useQuery({
    queryKey: ["guest-messages", code, reservation ?? "all"],
    queryFn: () => getGuestMessages(code, reservation),
    enabled: !!code,
  });

  const data = q.data;
  const messages = data?.messages ?? [];

  const columns: Column<SentMessage>[] = [
    {
      key: "sentAt",
      header: "When",
      cell: (m) => dateShort(m.sentAt),
    },
    {
      key: "kind",
      header: "What",
      cell: (m) => <span className="font-medium text-ink-900">{m.kindLabel}</span>,
    },
    {
      key: "about",
      header: "Booking",
      /* A message about a purchase order or a bill has no booking
         reference, and a dash is the honest answer (D17-49). */
      cell: (m) => m.about?.reference ?? "-",
      hideBelow: "sm",
    },
    {
      key: "to",
      header: "To",
      cell: (m) => (
        <span className="inline-flex items-center gap-1.5 text-ink-900">
          {m.channel === "email"
            ? <Mail className="size-3.5 text-grey-400 shrink-0" aria-hidden />
            : <Phone className="size-3.5 text-grey-400 shrink-0" aria-hidden />}
          <span>{wentTo(m)}</span>
        </span>
      ),
    },
    {
      key: "status",
      header: "State",
      cell: (m) => (
        <StatusPill tone={STATUS_TONE[m.status] ?? "neutral"}>
          {STATUS_WORDS[m.status] ?? m.status}
        </StatusPill>
      ),
    },
    {
      key: "sentBy",
      header: "Sent by",
      /* ⚠ THREE ANSWERS, NOT TWO. Most messages have nobody behind them
         (migration 117 keeps `sent_by` null for exactly that), but a name
         can also be missing because `staff` is row-secured and this reader
         may not see that colleague - and printing "The system" then is a
         plain untruth about who did something. */
      cell: (m) => m.sentBy ?? (m.byAPerson ? "A member of staff" : "The system"),
      hideBelow: "lg",
    },
    {
      key: "detail",
      header: "What came back",
      cell: (m) => <span className={m.detail ? "text-grey-600" : "text-grey-500"}>{m.detail ?? "-"}</span>,
      hideBelow: "lg",
    },
  ];

  const body = (() => {
    if (data === undefined) {
      /* FOUR STATES, NOT ONE. A read that cannot reach the server must
         not draw "nothing has been sent" - the fault STO-2 and POS-4
         were both filed for. */
      if (q.isPaused) {
        return (
          <Card><ErrorState
            title="No connection"
            description="This device is offline, so what was sent cannot load. It loads by itself as soon as the connection is back."
          /></Card>
        );
      }
      if (q.isError) {
        return (
          <Card><ErrorState
            title="What was sent did not load"
            error={q.error}
            description={unreachable(q.error)
              ? "Could not reach the server, and there is nothing from earlier to show in its place. Check the connection, then try again."
              : undefined}
            onRetry={() => void q.refetch()}
          /></Card>
        );
      }
      return <Skeleton className="h-64" />;
    }

    if (messages.length === 0) {
      /* TWO DIFFERENT EMPTIES, AND THE SCREEN SAYS WHICH. */
      return data.connected
        ? (
          <Card><EmptyState
            icon={<MessageSquare />}
            title="Nothing has been sent yet"
            description={
              "A booking confirmed from here, from the central system or from "
              + "a booking site gets its confirmation and the guest's own link, "
              + "and the link again the day before they arrive. Each one shows "
              + "up here with what came back."
            }
          /></Card>
        )
        : (
          <Card><EmptyState
            icon={<MessageSquare />}
            title="Nothing has been sent, because nothing can be yet"
            description={
              "This is not a fault and nothing has failed. No message has been "
              + "attempted, so there is nothing to show."
            }
          /></Card>
        );
    }

    return <DataTable rows={messages} columns={columns} rowKey={(m) => m.id} />;
  })();

  return (
    <Page>
      <PageHeader
        title="Guest messages"
        description={reservation
          ? "What this system sent about this booking"
          : "What this system sent guests, and whether it arrived"}
      />

      {/* What guests wrote to the desk from their own page (D23-14). It
          draws nothing for a role that is not the desk's, so its 20px go
          with it. */}
      <div className="mb-5 empty:hidden">
        <MessagesToTheDesk code={code} reservation={reservation} />
      </div>

      {/* THE SENDER'S OWN SENTENCE, not a second one written here. One
          wording, so the desk reads the same thing wherever it meets
          this - and it comes from the server, because only the server
          knows whether the workflow and its secret are in place. */}
      {data && !data.connected && data.notConnected && (
        /* The warning wash on the brand's yellow steps (it was stock amber). */
        <Card className="mb-5 border-brand-yellow-100 bg-brand-yellow-50">
          <CardBody>
            <p className="text-sm text-ink-900 leading-relaxed">
              <span className="font-medium">Nothing is sent yet</span>
              {" - "}
              {data.notConnected}
            </p>
          </CardBody>
        </Card>
      )}

      {/* MSG-3. Nothing is recorded where nothing was attempted, so a guest
          the sweep cannot reach would otherwise leave no trace on this
          screen at all. Shown whether or not sending is on: a booking
          fixed now is a guest reached on the day it is. A list, not a
          second table - the record below is the table. */}
      {data && data.unreachable.length > 0 && (
        <Card className="mb-5">
          <CardHeader
            title={data.unreachable.length === 1
              ? "1 booking no message can reach"
              : `${data.unreachable.length} bookings no message can reach`}
            description={
              "These guests will get no confirmation and no reminder. Add an "
              + "email address to the booking, or tick WhatsApp on it if the "
              + "guest agrees."
            }
          />
          {/* List rows: 12px, a hairline between. */}
          <CardBody className="py-0">
            <ul className="divide-y divide-grey-100 text-sm">
              {data.unreachable.map((u) => (
                <li key={u.id} className="flex flex-wrap gap-x-4 gap-y-0.5 py-3">
                  <span className="font-medium text-ink-900 tabular">{u.reference}</span>
                  <span className="text-ink-900">{u.guest}</span>
                  <span className="text-grey-600">Arrives {dateShort(u.checkIn)}</span>
                  <span className="text-grey-600">{u.why}</span>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      )}

      {body}
    </Page>
  );
}
