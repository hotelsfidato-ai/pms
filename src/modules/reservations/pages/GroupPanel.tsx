import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams, Link } from "react-router";
import { Users, Wallet, ArrowRight, Check, Flag } from "lucide-react";
import { cn } from "@/lib/cn";
import { money } from "@/lib/format";
import { useUi } from "@/lib/ui";
import {
  Page, PageHeader, Card, CardBody, CardHeader, Button, Skeleton,
  EmptyState, StatusPill, FigureRow, FigureTile, toast, type Tone,
} from "@/components/ui";
import {
  getGroup, openMasterFolio, routeRoomToGroup, setGroupLead, type GroupRoom,
} from "@/modules/reservations/data/groups";

/* ══════════════════════════════════════════════════════════════════
   THE GROUP PANEL

   A wedding block: twelve rooms, one host. The host settles the
   accommodation; every guest pays their own bar tab.

   TWO BALANCES, SIDE BY SIDE, NEVER ADDED. What the host owes and
   what the guests owe are different debts collected from different
   people. A single "group balance" reads like one number somebody can
   be asked for, and it is not — presenting it that way is how a front
   desk asks a departing guest for the host's account.

   ROUTING IS PER ROOM. A group is rarely uniform: the couple's own
   room is usually settled by them while the rest go to the host, and
   a group-level switch cannot say that.

   ROOM CHARGES ONLY. A bar tab follows whoever signed for it unless
   somebody says otherwise — the arrangement every hotel operates, and
   the one a guest expects when they sign a chit.
   ══════════════════════════════════════════════════════════════════ */

function useHotel(): string {
  const params = useParams();
  const fallback = useUi((s) => s.hotelId);
  return params["code"] ?? fallback;
}

/* One colour per state, everywhere (D27-48): in house blue, due in
   (a confirmed booking not yet arrived) orange. */
const STATUS_TONE: Record<string, Tone> = {
  confirmed: "accent",
  checked_in: "info",
  checked_out: "neutral",
  cancelled: "warning",
  no_show: "warning",
};

export default function GroupPanelPage() {
  const hotelId = useHotel();
  const { id } = useParams();
  const qc = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);

  const group = useQuery({
    queryKey: ["group", hotelId, id],
    queryFn: () => getGroup(hotelId, id ?? ""),
    enabled: Boolean(id),
  });

  const refresh = () =>
    void qc.invalidateQueries({ queryKey: ["group", hotelId, id] });

  if (group.isLoading) {
    return (
      <Page>
        <PageHeader title="Group" description="Loading…" />
        <Skeleton className="h-80" />
      </Page>
    );
  }
  if (!group.data) {
    return (
      <Page>
        <PageHeader title="Group" />
        <EmptyState title="No such group"
          description="It may belong to another property." />
      </Page>
    );
  }

  const g = group.data;
  const routedCount = g.rooms.filter((r) => r.routed).length;

  const openMaster = async () => {
    setBusy("master");
    const res = await openMasterFolio(hotelId, g.id);
    setBusy(null);
    if (!res.ok) return toast.error("Not opened", res.reason);
    toast.success("Host account open",
      "Room charges can now be routed to it.");
    refresh();
  };

  /* D22-52: the room booked first leads until the desk picks another. */
  const lead = async (room: GroupRoom) => {
    setBusy(`lead:${room.reservationId}`);
    const res = await setGroupLead(hotelId, g.id, room.reservationId);
    setBusy(null);
    if (!res.ok) return toast.error("Not changed", res.reason);
    toast.success(`${room.guest} leads the group`,
      "The group's confirmation and its review request go to them.");
    refresh();
  };

  const toggle = async (room: GroupRoom) => {
    setBusy(room.reservationId);
    const res = await routeRoomToGroup(
      hotelId, room.reservationId, !room.routed);
    setBusy(null);
    if (!res.ok) return toast.error("Not changed", res.reason);
    toast.success(
      room.routed ? `${room.guest} pays their own room`
                  : `${room.guest}'s room goes to the host`,
      "Nights already charged stay where they were posted.");
    refresh();
  };

  return (
    <Page>
      <PageHeader
        title={g.name}
        breadcrumbs={[
          { label: "All bookings", to: `/h/${hotelId}/reservations` },
          { label: g.name },
        ]}
        description={[
          g.blockCode,
          g.company,
          `${g.rooms.length} ${g.rooms.length === 1 ? "room" : "rooms"}`,
        ].filter(Boolean).join(" · ")}
      />

      {/* ── The two balances ─────────────────────────────────────── */}
      {/* The Figure Rule: label with its chip, the figure, its note,
          level across the row. The host's is warm while the host owes. */}
      <FigureRow className="sm:grid-cols-2">
        <FigureTile
          icon={<Wallet />}
          tone={g.master && g.master.balance > 0 ? "orange" : "neutral"}
          label="The host"
          /* A dash, not a zero. No master folio is not the same as a
             host who owes nothing. */
          value={g.master ? money(g.master.balance) : "-"}
          missing={!g.master}
          note={g.master ? (
            <>
              {routedCount} of {g.rooms.length}{" "}
              {routedCount === 1 ? "room routed here" : "rooms routed here"}
            </>
          ) : (
            <>
              <span className="block">No host account. Every room settles its own.</span>
              <Button
                variant="secondary" className="mt-2"
                disabled={busy === "master"}
                onClick={() => void openMaster()}
              >
                Open a host account
              </Button>
            </>
          )}
        />
        <FigureTile
          icon={<Users />}
          label="The guests"
          value={money(g.guestBalance)}
          note={`Across ${g.rooms.length} ${g.rooms.length === 1 ? "bill" : "bills"}`}
        />
      </FigureRow>

      {/* Said once, plainly, because a combined figure is what somebody
          will otherwise work out for themselves and then quote. */}
      <p className="mt-3 text-sm text-grey-600">
        Two accounts, not one total. The host is billed for the rooms routed
        to them; each guest is billed for their own folio. Adding them would
        give a number nobody can be asked to pay.
      </p>

      {/* ── The rooms ────────────────────────────────────────────── */}
      <Card className="mt-5">
        <CardHeader
          title="Rooms"
          description="Tick a room to put its accommodation on the host's account."
        />
        <CardBody className="p-0">
          {/* The table's look (DESIGN.md, Tables): a 40px grey-50 head in
              12px capitals, hairlines between rows. On a phone it scrolls
              inside the card, never the page. */}
          <div className="overflow-x-auto scrollbar-quiet">
            <table className="w-full text-base border-collapse">
              <thead className="bg-grey-50 border-b border-grey-200">
                <tr className="[&>th]:px-4 [&>th]:h-10 [&>th]:whitespace-nowrap [&>th]:text-2xs [&>th]:font-semibold [&>th]:uppercase [&>th]:tracking-wide [&>th]:text-grey-500">
                  <th className="text-left">Guest</th>
                  <th className="text-left">Room</th>
                  <th className="text-left">Dates</th>
                  <th className="text-right">Rate</th>
                  <th className="text-right">Own bill</th>
                  <th className="text-center">Host pays</th>
                  <th className="text-center">Lead guest</th>
                </tr>
              </thead>
              <tbody>
                {g.rooms.map((r) => (
                  <tr key={r.reservationId} className="border-b border-grey-100 last:border-b-0 [&>td]:align-middle">
                    <td className="px-4 py-3">
                      {/* It opens the stay: a link, so orange (the Tappable Rule). */}
                      <Link
                        to={`/h/${hotelId}/stay?res=${r.reservationId}`}
                        className="font-medium text-brand-orange-700 hover:underline underline-offset-4"
                      >
                        {r.guest}
                      </Link>
                      <span className="block text-xs text-grey-500">
                        {r.reference}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {/* A dash once they have left. The assignment is
                          released, and printing a room number would put
                          somebody back in a room they have vacated. */}
                      {r.room ? (
                        <span className="tabular">{r.room}</span>
                      ) : (
                        <span className="text-grey-500">-</span>
                      )}
                      <span className="block text-xs text-grey-500">
                        {r.roomType}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="tabular text-sm whitespace-nowrap">
                        {r.checkIn} → {r.checkOut}
                      </span>
                      <span className="block text-xs text-grey-500 whitespace-nowrap">
                        {r.nights} {r.nights === 1 ? "night" : "nights"} ·{" "}
                        <StatusPill tone={STATUS_TONE[r.status] ?? "neutral"}>
                          {r.status.replace("_", " ")}
                        </StatusPill>
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right tabular">
                      {money(r.agreedRate)}
                    </td>
                    <td className="px-4 py-3 text-right tabular">
                      {money(r.balance)}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <button
                        type="button"
                        onClick={() => void toggle(r)}
                        disabled={busy === r.reservationId}
                        aria-pressed={r.routed}
                        aria-label={`Host pays for ${r.guest}`}
                        className={cn(
                          "press size-11 rounded-lg border inline-grid place-items-center align-middle",
                          "cursor-pointer",
                          "disabled:opacity-50 disabled:cursor-not-allowed",
                          r.routed
                            ? "bg-ink-900 border-ink-900 text-white"
                            : "bg-white border-grey-300 hover:border-grey-400",
                        )}
                      >
                        {r.routed && <Check className="size-4" />}
                      </button>
                    </td>
                    <td className="px-4 py-3 text-center">
                      {/* Only a room that still stands can lead (D22-52). */}
                      <button
                        type="button"
                        onClick={() => void lead(r)}
                        disabled={busy !== null || r.reservationId === g.leadId
                          || ["cancelled", "void", "no_show"].includes(r.status)}
                        aria-pressed={r.reservationId === g.leadId}
                        aria-label={`${r.guest} leads the group`}
                        className={cn(
                          "press size-11 rounded-lg border inline-grid place-items-center align-middle",
                          "cursor-pointer",
                          "disabled:cursor-not-allowed",
                          r.reservationId === g.leadId
                            ? "bg-ink-900 border-ink-900 text-white"
                            : "bg-white border-grey-300 hover:border-grey-400 disabled:opacity-50",
                        )}
                      >
                        {r.reservationId === g.leadId && <Flag className="size-4" />}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardBody>
      </Card>

      {/* ── The host's account ───────────────────────────────────── */}
      {g.master && (
        <Card className="mt-5">
          <CardHeader
            title="The host's account"
            description="Every line says which room it is for."
          />
          {g.master.lines.length === 0 ? (
            <CardBody>
              <p className="text-grey-500">
                Nothing has been charged to the host yet. Route a room above,
                and tonight&rsquo;s audit will post it here.
              </p>
            </CardBody>
          ) : (
            /* List rows (the Rhythm Rule): 12px, at least 56px, a hairline
               between, every row's words at the same x. */
            <ul className="divide-y divide-grey-100 px-4">
              {g.master.lines.map((l, i) => (
                <li key={i} className="flex items-center gap-3 py-3 min-h-14">
                  <span className="w-24 shrink-0 tabular text-sm text-grey-500">
                    {l.date}
                  </span>
                  <span className="flex-1 min-w-0">
                    {l.description}
                    {l.room && (
                      <span className="ml-2 text-sm text-grey-500">
                        Room {l.room}
                      </span>
                    )}
                  </span>
                  <span className="tabular font-medium">{money(l.amount)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      <p className="mt-5 text-sm text-grey-600">
        Changing who pays affects nights <b>not yet charged</b>. The audit
        posts one night at a time, so anything already on a folio stays where
        it was posted - moving it is a reversal and a re-post, with a reason
        beside it. <ArrowRight className="inline size-3" /> the folio.
      </p>
    </Page>
  );
}
