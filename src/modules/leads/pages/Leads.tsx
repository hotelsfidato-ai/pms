import { useMemo, useState } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router";
import { ArrowLeft, CalendarPlus, ExternalLink, MessageCircle, PlugZap } from "lucide-react";
import { ApiError } from "@/lib/api";
import { cn } from "@/lib/cn";
import { dateTime, NO_DATE, money, phone } from "@/lib/format";
import {
  Page, PageHeader, Card, CardBody, CardHeader, Button, StatusPill, EmptyState,
  ReadFailed, SkeletonText, readError,
} from "@/components/ui";
import {
  bookingPathFor, getConversation, getLeads, CHANNEL_LABELS, STATUS_LABELS, type Lead,
} from "@/modules/leads/data/leads";

/* ══════════════════════════════════════════════════════════════════
   LEADS AND WHATSAPP (D27-100, D27-168, D27-170)

   The leads app's enquiries for this property, READ LIVE as the screen
   opens: the PMS keeps no copy (D27-170), so an enquiry erased there is
   gone here the next time the list loads. Staff keep replying in the
   leads app; each lead links there. The PMS sends nothing and writes
   nothing into it. The one thing done here is "Book this lead", which
   opens New booking with the lead's name, phone, source and campaign.

   Every read counts against the leads app's free allowance, shared with
   the app itself, so the list comes 50 at a time and a conversation is
   read only when it is opened.
   ══════════════════════════════════════════════════════════════════ */

const OPEN = new Set(["NEW", "ASSIGNED", "CLAIMED", "OVERDUE", "CONTACTED", "FOLLOW_UP", "QUOTED"]);
const TONE: Record<string, "neutral" | "info" | "success" | "warning" | "danger" | "accent"> = {
  NEW: "accent", OVERDUE: "accent", ASSIGNED: "info", CLAIMED: "info", CONTACTED: "info",
  FOLLOW_UP: "warning", QUOTED: "info", BOOKED: "success", LONG_TERM: "neutral",
  LOST: "neutral", DEAD: "neutral", CLOSED: "neutral",
};

const statusWord = (s: string) => STATUS_LABELS[s] ?? s;
const channelWord = (c: string) => CHANNEL_LABELS[c] ?? c;

/** The server's own sentence for the cap or the app refusing, else null. */
function sentenceOf(error: unknown): string | null {
  if (!(error instanceof ApiError) || (error.status !== 429 && error.status !== 502)) return null;
  const body = error.body as { error?: string } | undefined;
  return body?.error ?? error.message;
}

export default function LeadsPage() {
  const { code = "" } = useParams<{ code: string }>();
  const [filter, setFilter] = useState<string>("all");
  const [open, setOpen] = useState<Lead | null>(null);

  const q = useInfiniteQuery({
    queryKey: ["leads", code],
    queryFn: ({ pageParam }) => getLeads(code, pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.more,
    enabled: !!code,
    /* Every load is a read of the leads app: never on focus, never on a timer. */
    refetchOnWindowFocus: false,
    staleTime: 60_000,
  });

  const first = q.data?.pages[0];
  const leads = useMemo(() => q.data?.pages.flatMap((p) => p.leads) ?? [], [q.data]);
  const counts = useMemo(() => {
    const c = new Map<string, number>();
    for (const l of leads) c.set(l.status, (c.get(l.status) ?? 0) + 1);
    return c;
  }, [leads]);
  const shown = filter === "all" ? leads : filter === "open" ? leads.filter((l) => OPEN.has(l.status))
    : leads.filter((l) => l.status === filter);

  const header = (
    <PageHeader
      title="Leads and WhatsApp"
      description="Enquiries from the leads app, read as you open this page. Staff reply in the leads app."
    />
  );

  if (q.isPending) {
    return <Page>{header}<Card><CardBody><SkeletonText lines={6} /></CardBody></Card></Page>;
  }
  const failure = readError(q);
  if (failure && !first) {
    const sentence = sentenceOf(failure);
    return (
      <Page>
        {header}
        <Card>
          {sentence
            ? <EmptyState icon={<PlugZap />} title="The leads app was not read" description={sentence} />
            : <ReadFailed error={failure} what="the leads" onRetry={() => void q.refetch()} />}
        </Card>
      </Page>
    );
  }
  if (first && !first.connected) {
    return (
      <Page>
        {header}
        <Card>
          <EmptyState
            icon={<PlugZap />}
            title="Not connected yet"
            description="The leads app is read with a read-only login the owner sets up on the server. Until then nothing is read and nothing is shown here."
          />
        </Card>
      </Page>
    );
  }
  if (first && !first.inApp) {
    return (
      <Page>
        {header}
        <Card>
          <EmptyState
            icon={<MessageCircle />}
            title="This property is not in the leads app"
            description="The leads app has no hotel matched to this property, so it has no enquiries to show here."
          />
        </Card>
      </Page>
    );
  }

  const chips: { key: string; label: string; n: number }[] = [
    { key: "all", label: "All", n: leads.length },
    { key: "open", label: "Open", n: leads.filter((l) => OPEN.has(l.status)).length },
    ...Object.keys(STATUS_LABELS).filter((s) => counts.has(s)).map((s) => ({ key: s, label: statusWord(s), n: counts.get(s)! })),
  ];

  return (
    <Page>
      {header}

      <div className="flex gap-2 overflow-x-auto pb-1 mb-5 -mx-1 px-1 snap-x" role="tablist" aria-label="Show leads by status">
        {chips.map((c) => (
          <button
            key={c.key}
            type="button"
            role="tab"
            aria-selected={filter === c.key}
            onClick={() => setFilter(c.key)}
            className={cn(
              "snap-start shrink-0 min-h-11 px-3.5 rounded-lg text-sm font-medium tabular-nums",
              "shadow-[inset_0_0_0_1px_var(--color-grey-200)]",
              filter === c.key ? "bg-ink-900 text-white shadow-none" : "bg-white text-grey-700 hover:bg-grey-50",
            )}
          >
            {c.label} <span className={filter === c.key ? "text-white/70" : "text-grey-500"}>{c.n}</span>
          </button>
        ))}
      </div>

      <div className="grid grid-cols-12 gap-3">
        <Card className={cn("col-span-12 lg:col-span-5", open && "hidden lg:block")}>
          <CardHeader title="Enquiries" description="Newest message first" />
          {shown.length === 0 ? (
            <EmptyState
              compact
              title={leads.length === 0 ? "No enquiries yet" : "None with this status"}
              description={leads.length === 0 ? "Enquiries arrive in the leads app from WhatsApp, the website and ads, and show here." : "Choose another status above."}
            />
          ) : (
            <ul className="divide-y divide-grey-100">
              {shown.map((l) => (
                <li key={l.ref}>
                  <button
                    type="button"
                    onClick={() => setOpen(l)}
                    aria-current={open?.ref === l.ref}
                    className={cn(
                      "w-full text-left px-4 py-3 min-h-14 flex items-start gap-3 hover:bg-grey-50",
                      open?.ref === l.ref && "bg-grey-50",
                    )}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-ink-900 truncate">{l.name ?? l.phone ?? NO_DATE}</span>
                        <StatusPill tone={TONE[l.status] ?? "neutral"}>{statusWord(l.status)}</StatusPill>
                      </span>
                      <span className="block text-sm text-grey-600 truncate mt-0.5">{l.lastMessage ?? NO_DATE}</span>
                      <span className="block text-xs text-grey-500 mt-0.5">{channelWord(l.channel)}</span>
                    </span>
                    <span className="text-xs text-grey-500 tabular-nums shrink-0">{dateTime(l.lastMessageAt)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {q.hasNextPage && (
            <div className="px-4 py-3 border-t border-grey-100">
              <Button size="sm" onClick={() => void q.fetchNextPage()} disabled={q.isFetchingNextPage}>
                {q.isFetchingNextPage ? "Reading" : "Show older enquiries"}
              </Button>
            </div>
          )}
          {failure != null && first && (
            <p className="px-4 py-3 text-sm text-grey-600 border-t border-grey-100">
              {sentenceOf(failure) ?? "The next enquiries did not load. Try again."}
            </p>
          )}
        </Card>

        <div className={cn("col-span-12 lg:col-span-7", !open && "hidden lg:block")}>
          {open ? <LeadPanel code={code} lead={open} onBack={() => setOpen(null)} /> : (
            <Card>
              <EmptyState compact icon={<MessageCircle />} title="Choose an enquiry" description="Its conversation is read from the leads app when you open it." />
            </Card>
          )}
        </div>
      </div>
    </Page>
  );
}

function LeadPanel({ code, lead, onBack }: { code: string; lead: Lead; onBack: () => void }) {
  const q = useQuery({
    queryKey: ["lead", code, lead.ref],
    queryFn: () => getConversation(code, lead.ref),
    refetchOnWindowFocus: false,
    staleTime: 60_000,
  });
  const failure = readError(q);

  return (
    <Card>
      <CardHeader
        title={lead.name ?? lead.phone ?? NO_DATE}
        description={[lead.phone && phone(lead.phone), channelWord(lead.channel)].filter(Boolean).join(" · ")}
        actions={<StatusPill tone={TONE[lead.status] ?? "neutral"}>{statusWord(lead.status)}</StatusPill>}
      />
      <CardBody className="flex flex-col gap-4">
        <button type="button" onClick={onBack} className="lg:hidden inline-flex items-center gap-2 text-sm font-medium text-grey-700 min-h-11 self-start">
          <ArrowLeft className="size-4" /> Back to the enquiries
        </button>

        {/* On a phone each label sits over its value: side by side they wrap (Breathing Room). */}
        <dl className="grid grid-cols-1 sm:grid-cols-[auto_1fr] gap-x-4 sm:gap-y-2 text-sm [&>dt]:whitespace-nowrap [&>dd]:mb-2 sm:[&>dd]:mb-0 sm:[&>dd]:text-right">
          <dt className="text-grey-500">Came in</dt><dd className="text-grey-700 tabular-nums">{dateTime(lead.receivedAt)}</dd>
          {lead.status === "BOOKED" && <>
            <dt className="text-grey-500">Booking in the leads app</dt>
            <dd className="text-grey-700">{lead.bookingRef ?? NO_DATE}</dd>
            <dt className="text-grey-500">Value typed there</dt>
            <dd className="text-grey-700 tabular-nums">{lead.bookingValue === null ? NO_DATE : money(lead.bookingValue)}</dd>
          </>}
        </dl>
        {lead.doNotContact && (
          <p className="text-sm text-grey-700 bg-brand-yellow-50 shadow-[inset_0_0_0_1px_var(--color-brand-yellow-100)] rounded-lg px-3 py-2">
            The guest asked not to be messaged. The leads app refuses replies to them.
          </p>
        )}

        <div className="flex flex-wrap gap-2">
          <Button variant="primary" asChild>
            <Link to={bookingPathFor(code, lead.ref)}><CalendarPlus /> Book this lead</Link>
          </Button>
          {q.data?.replyUrl && (
            <Button asChild>
              <a href={q.data.replyUrl} target="_blank" rel="noreferrer noopener"><ExternalLink /> Reply in the leads app</a>
            </Button>
          )}
        </div>

        <section aria-label="The conversation" className="border-t border-grey-100 pt-4">
          {q.isPending ? <SkeletonText lines={4} />
            : failure ? (sentenceOf(failure)
              ? <p className="text-sm text-grey-600">{sentenceOf(failure)}</p>
              : <ReadFailed compact error={failure} what="the conversation" onRetry={() => void q.refetch()} />)
            : !q.data || q.data.messages.length === 0
              ? <p className="text-sm text-grey-500">No messages in this enquiry.</p>
              : (
                <ol className="flex flex-col gap-2">
                  {q.data.messages.map((m, i) => (
                    <li key={i} className={cn("max-w-[85%] rounded-lg px-3 py-2", m.direction === "in"
                      ? "self-start bg-grey-50 shadow-[inset_0_0_0_1px_var(--color-grey-200)]"
                      : "self-end bg-info-50 shadow-[inset_0_0_0_1px_var(--color-info-100)]")}>
                      <p className="text-sm text-ink-900 whitespace-pre-wrap break-words">
                        {m.body || (m.kind === "text" ? NO_DATE : `(${m.kind})`)}
                      </p>
                      <p className="text-xs text-grey-500 mt-1 tabular-nums">
                        {m.direction === "in" ? "Guest" : "Hotel"} · {dateTime(m.at)}
                      </p>
                    </li>
                  ))}
                </ol>
              )}
        </section>
      </CardBody>
    </Card>
  );
}
