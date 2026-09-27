import { useState } from "react";
import { Link, useParams } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Search, UserX, ShieldAlert, ChevronRight } from "lucide-react";
import { money, dateShort } from "@/lib/format";
import { useUi } from "@/lib/ui";
import {
  Page, PageHeader, Card, CardBody, CardHeader, Button, Field, Input, SearchInput,
  StatusPill, EmptyState, ErrorState, Skeleton, DataTable, toast, type Column,
} from "@/components/ui";
import {
  searchGuests, getGuest360, blacklistGuest, clearBlacklist, recordNoOffers,
  clearNoOffers, getOffersYes, recordOffersYes, type Guest360,
} from "@/modules/crm/data/crm";
import { agreedToOffers, stayedWords } from "@/modules/guests";

/* ══════════════════════════════════════════════════════════════════
   GUEST 360 — one person, across the whole group (D21-3, D21-4)

   Every stay at every hotel, what they were charged, what was sent to
   them, the blacklist and "no offers". For the owner, an administrator
   and the GM only: a whole person's history across seven hotels is more
   than any one desk sees (D21-4). The desk sees "stayed with the group N
   times" and nothing more (D21-13).

   READ ONLY, except the two things the owner gave these three: the
   blacklist (D21-21) and "no offers" (D21-22). Editing a guest stays on
   the Guests screen. An ID document is never shown - only whether one is
   on file (the brief, rule 1). The leads app's conversations will be a
   link, never a copy (D21-5); that app is not connected yet, so there is
   no link to draw.

   "Charged" is the Guests screen's "total spend", read from one place in
   the database so the two cannot disagree (the owner, 21 September).
   ══════════════════════════════════════════════════════════════════ */

const DASH = "-";

export function Guest360SearchPage() {
  const hotelId = useUi((s) => s.hotelId);
  const [q, setQ] = useState("");
  const found = useQuery({
    queryKey: ["crm", "search", hotelId, q.trim()],
    queryFn: () => searchGuests(hotelId, q),
    enabled: q.trim().length >= 2,
  });

  return (
    <Page>
      <PageHeader
        title="Guest 360"
        description="Find a guest by name, phone or email, and see every stay at every hotel of the group."
      />
      <SearchInput value={q} onChange={(e) => setQ(e.target.value)}
        placeholder="Name, phone or email" aria-label="Find a guest" autoFocus
        className="max-w-xl" />

      <div className="mt-5">
        {q.trim().length < 2 && (
          <p className="text-sm text-grey-500">Type two letters of a name, or a whole phone number or email.</p>
        )}
        {found.error && <Card><ErrorState error={found.error} onRetry={() => void found.refetch()} /></Card>}
        {found.data?.length === 0 && (
          <Card><EmptyState compact icon={<Search />} title="Nobody found"
            description="No guest record has that name, phone or email." /></Card>
        )}
        {!!found.data?.length && (
          <Card>
            <ul className="divide-y divide-grey-100">
              {found.data.map((g) => (
                <li key={g.id}>
                  {/* A row that opens the guest: list-row rhythm, and an
                      arrow at its end (the Tappable Rule). */}
                  <Link to={`/crm/guests/${g.id}`}
                    className="flex items-center gap-3 px-4 py-3 min-h-14 hover:bg-grey-50 transition-colors duration-150
                               focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-orange">
                    <span className="min-w-0 flex-1 flex flex-wrap items-center gap-x-3 gap-y-1">
                      <span className="font-medium text-ink-900">{g.name}</span>
                      {g.isBlacklisted && <StatusPill tone="danger">Blacklisted</StatusPill>}
                      <span className="text-sm text-grey-600 tabular min-w-0 break-words">{g.phone ?? DASH} · {g.email ?? DASH}</span>
                      <span className="sm:ml-auto text-sm text-grey-500">{stayedWords(g.visits)}</span>
                    </span>
                    <ChevronRight className="size-4 text-grey-400 shrink-0" aria-hidden />
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>
    </Page>
  );
}

type StayRow = Guest360["stays"][number];

const STAY_COLUMNS: Column<StayRow>[] = [
  { key: "hotel", header: "Hotel", cell: (s) => s.hotelName },
  { key: "ref", header: "Booking", hideBelow: "md", cell: (s) => <span className="tabular">{s.reference}</span> },
  { key: "dates", header: "Dates",
    cell: (s) => <span className="tabular">{dateShort(s.checkIn)} – {dateShort(s.checkOut)}</span> },
  { key: "type", header: "Room type", hideBelow: "lg", cell: (s) => s.roomType ?? DASH },
  { key: "source", header: "Booked via", hideBelow: "lg", cell: (s) => s.source ?? DASH },
  { key: "status", header: "Status", cell: (s) => s.status.replace("_", " ") },
  { key: "charged", header: "Charged", numeric: true, cell: (s) => <span className="tabular">{money(s.charged)}</span> },
];

export function Guest360Page() {
  const hotelId = useUi((s) => s.hotelId);
  const { id = "" } = useParams();
  const whole = useQuery({
    queryKey: ["crm", "guest", hotelId, id],
    queryFn: () => getGuest360(hotelId, id),
  });
  const g = whole.data;

  if (whole.isLoading) {
    return <Page><PageHeader title="Guest 360" /><Skeleton className="h-80" /></Page>;
  }
  if (whole.error) {
    return <Page><PageHeader title="Guest 360" />
      <Card><ErrorState error={whole.error} onRetry={() => void whole.refetch()} /></Card></Page>;
  }
  if (!g) {
    return <Page><PageHeader title="Guest 360" />
      <Card><EmptyState compact icon={<UserX />} title="No such guest"
        description="The link may be old. Find them again by name, phone or email." /></Card></Page>;
  }

  return (
    <Page>
      <PageHeader
        title="Guest 360"
        breadcrumbs={[{ label: "Guest 360", to: "/crm/guests" }, { label: g.name }]}
        description={`${g.name} · ${stayedWords(g.visits)}`}
      />

      {/* The stays get the page's whole width: seven columns beside a side
          column wrapped every date onto three lines. Cards 12px apart. */}
      <div className="space-y-3">
        <div className="grid gap-3 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <Card>
            <CardHeader title="Who they are" />
            <CardBody className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-lg font-semibold text-ink-900">{g.name}</span>
                {g.isVip && <StatusPill tone="accent">VIP</StatusPill>}
                {g.isBlacklisted && <StatusPill tone="danger">Blacklisted</StatusPill>}
              </div>
              <p className="text-grey-600 tabular break-words">{g.phone ?? DASH} · {g.email ?? DASH}</p>
              <p className="text-grey-600">
                Nationality {g.nationality ?? DASH} · {g.hasId ? "an ID is on file" : "no ID on file"}
                {g.companies.length > 0 && ` · books under ${g.companies.join(", ")}`}
              </p>
              {g.joined.length > 0 && (
                <p className="text-sm text-grey-500">
                  Joined into this record: {g.joined.map((j) => j.name).join(", ")}.{" "}
                  <Link to="/crm/same-person" className="font-medium text-brand-orange-700 hover:underline underline-offset-4">Undo a join</Link>
                </p>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="What they are worth" />
            {/* Labelled figures as rows: label left, value right. */}
            <CardBody className="py-2 divide-y divide-grey-100">
              <Row label="Visits" value={String(g.visits)} />
              <Row label="Nights" value={String(g.nights)} />
              <Row label="Charged" value={money(g.charged)} />
              <Row label="First stay" value={dateShort(g.firstStay)} />
              <Row label="Last stay" value={dateShort(g.lastStay)} />
            </CardBody>
          </Card>
        </div>

        {/* The card draws the frame; the table draws none of its own. */}
        <Card>
          <CardHeader title="Every stay, at every hotel" />
          <DataTable<StayRow> rows={g.stays} columns={STAY_COLUMNS} rowKey={(s) => s.id}
            className="border-0 rounded-t-none"
            empty={<EmptyState compact title="No stays"
              description="A booking made for this guest appears here, whichever hotel it is at." />} />
        </Card>

        <div className="grid gap-3 lg:grid-cols-3">
          <Card>
            <CardHeader title="What was sent to them" />
            <CardBody>
              {g.sent.length === 0 ? (
                <p className="text-sm text-grey-500">Nothing has been sent to this guest from any hotel.</p>
              ) : (
                <ul className="-my-3.5 divide-y divide-grey-100">
                  {g.sent.map((m, i) => (
                    <li key={`${m.at}-${i}`} className="flex flex-wrap gap-x-3 gap-y-0.5 py-3 text-sm">
                      <span className="tabular text-grey-600">{dateShort(m.at.slice(0, 10))}</span>
                      <span className="text-ink-900">{m.kind.replace(/_/g, " ")}</span>
                      <span className="text-grey-600">by {m.channel} · {m.status} · {m.hotelName}</span>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
          <BlacklistCard hotelId={hotelId} guest={g} />
          <NoOffersCard hotelId={hotelId} guest={g} />
        </div>
      </div>
    </Page>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2">
      <span className="text-grey-600">{label}</span>
      <span className="tabular font-medium text-ink-900">{value}</span>
    </div>
  );
}

/* D21-21: set with a reason, which the desk is shown at the next booking
   with this phone or email. A warning, never a refusal. */
function BlacklistCard({ hotelId, guest: g }: { hotelId: string; guest: Guest360 }) {
  const qc = useQueryClient();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const done = async (result: Promise<{ ok: true } | { ok: false; reason: string }>, said: string) => {
    setBusy(true);
    const r = await result;
    setBusy(false);
    if (!r.ok) return toast.error("Not changed", r.reason);
    toast.success(said);
    setReason("");
    void qc.invalidateQueries({ queryKey: ["crm"] });
  };

  return (
    <Card>
      <CardHeader title="Blacklist" />
      <CardBody className="space-y-3">
        {g.isBlacklisted ? (
          <>
            <p className="flex items-start gap-2 text-sm text-brand-red-700">
              <ShieldAlert className="size-4 shrink-0 mt-0.5" />
              <span>Reason: {g.blacklistReason ?? DASH}. The desk is warned when they book; it is not refused.</span>
            </p>
            <Button variant="secondary" disabled={busy}
              onClick={() => void done(clearBlacklist(hotelId, g.id), "Blacklist cleared")}>
              Clear the blacklist
            </Button>
          </>
        ) : (
          <>
            <Field label="Reason" hint="The desk is shown this when they book again. It warns; it never refuses.">
              {({ id }) => <Input id={id} value={reason} onChange={(e) => setReason(e.target.value)} />}
            </Field>
            <Button variant="danger" disabled={busy || !reason.trim()}
              onClick={() => void done(blacklistGuest(hotelId, g.id, reason), "Blacklisted")}>
              Blacklist
            </Button>
          </>
        )}
      </CardBody>
    </Card>
  );
}

/* D25-39 (opt-in) and D21-22: against the phone and email themselves, at
   every hotel. Offers go only to a yes; a later answer replaces an earlier one. */
function NoOffersCard({ hotelId, guest: g }: { hotelId: string; guest: Guest360 }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const yes = useQuery({ queryKey: ["crm", "offers-yes", hotelId], queryFn: () => getOffersYes(hotelId) });
  /* Marketing's own gate (mayBeWrittenTo): a yes, and no "no" beside it. */
  const agreed = yes.data
    ? agreedToOffers(yes.data, g.phone, g.email) && g.noOffers.length === 0 : null;
  const act = async (result: Promise<{ ok: true } | { ok: false; reason: string }>) => {
    setBusy(true);
    const r = await result;
    setBusy(false);
    if (!r.ok) return toast.error("Not changed", r.reason);
    void qc.invalidateQueries({ queryKey: ["crm"] });
  };

  return (
    <Card>
      <CardHeader title="Offers" />
      <CardBody className="space-y-3">
        <p className="text-sm text-grey-600">
          {agreed === null ? "-"
            : agreed ? "Agreed to offers. They may be sent to this guest's phone and email, at every hotel."
            : "No offers are sent: this guest has not said yes."}
        </p>
        {g.noOffers.length > 0 && (
          <ul className="border-y border-grey-100 divide-y divide-grey-100">
            {g.noOffers.map((o) => (
              <li key={o.id} className="flex items-center gap-3 py-3 text-sm">
                <span className="min-w-0 flex-1 tabular text-ink-900">
                  No offers to {o.kind === "phone" ? "phone" : "email"} {o.value}
                </span>
                <Button variant="secondary" disabled={busy}
                  onClick={() => void act(clearNoOffers(hotelId, o.id))}>
                  Clear
                </Button>
              </li>
            ))}
          </ul>
        )}
        {(g.phone || g.email) && (
          <div className="flex flex-wrap gap-2">
            {agreed === false && (
              <Button variant="secondary" disabled={busy}
                onClick={() => void act(recordOffersYes(hotelId, { phone: g.phone, email: g.email }))}>
                Record their yes
              </Button>
            )}
            <Button variant="secondary" disabled={busy}
              onClick={() => void act(recordNoOffers(hotelId, { phone: g.phone, email: g.email }))}>
              Record "no offers"
            </Button>
          </div>
        )}
      </CardBody>
    </Card>
  );
}
