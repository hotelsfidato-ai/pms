import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "react-router";
import { Link2, Mail, MessageCircle, Star } from "lucide-react";
import { dateShort, dateTime, NO_DATE } from "@/lib/format";
import {
  Page, PageHeader, Card, CardBody, CardHeader, Button, Input,
  DataTable, type Column, StatusPill, Skeleton, ErrorState, EmptyState, toast,
} from "@/components/ui";
import {
  getReviews, setReviewLink, askForReview, type Departure,
} from "@/modules/reputation/data/reputation";

/* ══════════════════════════════════════════════════════════════════
   REVIEWS — who was asked, who has not been, and what came back

   The owner's D18-14. Three things on this screen and nothing else.

   ⚠ THE GROUP'S REVIEW LINK DOES NOT EXIST YET, and this screen is
   written so that a person reading it cannot come away thinking it does.
   The link shows a DASH, the same as any figure nobody has set. There is
   no example address in the box, no greyed-out suggestion and no
   "https://g.page/..." placeholder - somebody would copy it. Until a link
   is typed in, no row offers to send, and the card at the top says so in
   one sentence.

   AND NOTHING IS PULLED IN. No Google, no TripAdvisor, no booking sites
   (D18-14). "What came back" is therefore the state of the ASK, not a
   rating - and the last card says that where somebody would go looking
   for the reviews themselves, rather than leaving them to wonder.

   NOT ASKED IS A DASH TOO, not "Pending". Pending reads as if something
   were already on its way.
   ══════════════════════════════════════════════════════════════════ */

/** What a person reads for the state of the ask. */
function AskState({ row }: { row: Departure }) {
  if (row.askStatus === null) return <span className="text-ink-400">{NO_DATE}</span>;
  if (row.askStatus === "sent") {
    return <StatusPill tone="success">Asked</StatusPill>;
  }
  return <StatusPill tone="danger">Did not go</StatusPill>;
}

export default function ReviewsPage() {
  const { code = "" } = useParams<{ code: string }>();
  const qc = useQueryClient();
  const [typed, setTyped] = useState<string | null>(null);
  const [sending, setSending] = useState<string | null>(null);

  const q = useQuery({
    queryKey: ["reviews", code],
    queryFn: () => getReviews(code),
    enabled: !!code,
  });

  const refresh = () => void qc.invalidateQueries({ queryKey: ["reviews", code] });

  const saveLink = async (url: string) => {
    const out = await setReviewLink(code, url);
    if (!out.ok) { toast.error(out.reason); return; }
    toast.success(url.trim() === ""
      ? "The review link is cleared. Nothing will be sent until there is one."
      : "The review link is saved.");
    setTyped(null);
    refresh();
  };

  const ask = async (row: Departure, channel: "whatsapp" | "email") => {
    setSending(`${row.id}:${channel}`);
    const out = await askForReview(code, row.id, channel);
    setSending(null);
    if (!out.ok) { toast.error(out.reason); return; }
    toast.success(`${row.guest} has been asked for a review.`);
    refresh();
  };

  const body = (() => {
    if (q.data === undefined) {
      if (q.isError) {
        return (
          <ErrorState
            title="Reviews did not load"
            error={q.error}
            onRetry={() => void q.refetch()}
          />
        );
      }
      return <Skeleton className="h-64" />;
    }

    const page = q.data;
    /* THE TWO THINGS THAT STOP A SEND, and each says its own sentence.
       Asked here as well as on the server, because a button that cannot
       work should not be drawn at all. */
    const noLink = page.link === null;
    const mayActuallySend = page.mayAsk && page.canSend && !noLink;

    const columns: Column<Departure>[] = [
      {
        key: "guest", header: "Guest",
        cell: (r) => (
          <div>
            <div className="font-medium text-ink-900">{r.guest}</div>
            <div className="text-xs text-ink-500">{r.reference}</div>
          </div>
        ),
      },
      {
        key: "departed", header: "Left", numeric: true, width: "w-[120px]",
        cell: (r) => dateShort(r.departed),
      },
      {
        key: "stay", header: "Stay", hideBelow: "md", numeric: true,
        cell: (r) => `${dateShort(r.arrived)} - ${dateShort(r.departed)}`,
      },
      {
        key: "asked", header: "Review asked", width: "w-[160px]",
        cell: (r) => (
          <div>
            <AskState row={r} />
            {r.askedAt && (
              <div className="text-xs text-ink-500 mt-0.5">{dateTime(r.askedAt)}</div>
            )}
            {r.askStatus === "failed" && r.askDetail && (
              <div className="text-xs text-danger-700 mt-0.5">{r.askDetail}</div>
            )}
          </div>
        ),
      },
      {
        key: "ask", header: "", width: "w-[200px]",
        cell: (r) => {
          /* Once per group, at its lead guest's room (D22-10). */
          if (r.leadId && r.leadId !== r.id) {
            return (
              <p className="text-xs text-ink-500 text-right">
                The group is asked once, at {r.leadReference ?? "its lead room"}.
              </p>
            );
          }
          if (!mayActuallySend) return null;
          return (
            <div className="flex gap-2 justify-end">
              {/* A way is offered only where the booking carries an address
                  for it. Offering both and refusing one afterwards tells
                  somebody after the press what they could have known
                  before it. */}
              <Button
                size="sm" variant="secondary"
                disabled={!r.phone || sending !== null}
                loading={sending === `${r.id}:whatsapp`}
                onClick={() => void ask(r, "whatsapp")}
              >
                <MessageCircle className="size-4" aria-hidden />
                WhatsApp
              </Button>
              <Button
                size="sm" variant="secondary"
                disabled={!r.email || sending !== null}
                loading={sending === `${r.id}:email`}
                onClick={() => void ask(r, "email")}
              >
                <Mail className="size-4" aria-hidden />
                Email
              </Button>
            </div>
          );
        },
      },
    ];

    return (
      <div className="space-y-4">
        {/* ── nothing sends at all yet ───────────────────────────── */}
        {!page.canSend && page.notConnected && (
          <Card>
            <CardBody className="text-sm text-ink-700">{page.notConnected}</CardBody>
          </Card>
        )}

        {/* ── the link ───────────────────────────────────────────── */}
        <Card>
          <CardHeader
            title="The review link"
            description="The address a guest is sent to leave their review."
          />
          <CardBody className="space-y-3">
            <dl className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm">
              <dt className="text-ink-500">This property sends:</dt>
              <dd className="font-medium text-ink-900 break-all">
                {page.link ?? <span className="text-ink-400">{NO_DATE}</span>}
              </dd>
            </dl>

            {page.link === null ? (
              <p className="text-sm text-ink-700">
                No review link has been set for this property, so nobody can be
                asked for a review yet. This hotel's own Google review link has not been given.
                Nothing is sent until somebody pastes one here.
              </p>
            ) : (
              <p className="text-xs text-ink-500">
                Set by {page.linkSetBy ?? NO_DATE}
                {page.linkSetAt ? ` on ${dateTime(page.linkSetAt)}` : ""}.
              </p>
            )}

            {page.maySetLink ? (
              <div className="flex flex-wrap gap-2 items-end">
                <div className="min-w-[18rem] flex-1">
                  <label
                    htmlFor="review-link"
                    className="block text-sm font-medium text-ink-700 mb-1.5"
                  >
                    Paste the link
                  </label>
                  <Input
                    id="review-link"
                    /* NO PLACEHOLDER THAT LOOKS LIKE A LINK. Somebody would
                       copy it out, and it would go to a guest. */
                    placeholder=""
                    inputMode="url"
                    value={typed ?? page.link ?? ""}
                    onChange={(e) => setTyped(e.target.value)}
                  />
                </div>
                <Button
                  onClick={() => void saveLink(typed ?? page.link ?? "")}
                  disabled={typed === null}
                >
                  <Link2 className="size-4" aria-hidden />
                  Save the link
                </Button>
                {page.link !== null && (
                  <Button variant="ghost" onClick={() => void saveLink("")}>
                    Clear it
                  </Button>
                )}
              </div>
            ) : (
              <p className="text-sm text-ink-700">
                Setting this is for the owner or an administrator. Ask one of
                them.
              </p>
            )}
          </CardBody>
        </Card>

        {/* ── who was asked, who has not been ────────────────────── */}
        <Card>
          <CardHeader
            title="Departures"
            description={`Guests who left in the last ${page.daysBack} days. A guest is asked after they have gone, never before.`}
          />
          <CardBody className="p-0">
            <DataTable
              columns={columns}
              rows={page.departures}
              rowKey={(r) => r.id}
              empty={
                <EmptyState
                  icon={<Star />}
                  title="Nobody has left in the last 30 days"
                  description="A guest can be asked for a review once they have checked out."
                />
              }
            />
          </CardBody>
        </Card>

        {/* ── what came back ─────────────────────────────────────── */}
        <Card>
          <CardHeader title="What guests wrote" />
          <CardBody className="text-sm text-ink-700">
            Reviews left on Google, TripAdvisor and the booking sites are not
            read into this system. Nothing is pulled in from anywhere, so this
            screen can say who was asked and cannot say what they wrote. Open
            the site itself to read them.
          </CardBody>
        </Card>
      </div>
    );
  })();

  return (
    <Page>
      <PageHeader
        title="Reviews"
        description="Ask a guest for a review after they have left, and see who has been asked."
      />
      {body}
    </Page>
  );
}
