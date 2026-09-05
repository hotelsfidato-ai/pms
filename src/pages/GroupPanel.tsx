import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams, Link } from "react-router";
import { Users, Wallet, ArrowRight, Check } from "lucide-react";
import { cn } from "@/lib/cn";
import { money } from "@/lib/format";
import { useUi } from "@/lib/ui";
import {
  Page, PageHeader, Card, CardBody, CardHeader, Button, Skeleton,
  EmptyState, StatusPill, toast,
} from "@/components/ui";
import {
  getGroup, openMasterFolio, routeRoomToGroup, type GroupRoom,
} from "@/data/repositories";

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

const STATUS_TONE: Record<string, "neutral" | "success" | "warning"> = {
  confirmed: "neutral",
  checked_in: "success",
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
          { label: "Reservations", to: `/h/${hotelId}/reservations` },
          { label: g.name },
        ]}
        description={[
          g.blockCode,
          g.company,
          `${g.rooms.length} ${g.rooms.length === 1 ? "room" : "rooms"}`,
        ].filter(Boolean).join(" · ")}
      />

      {/* ── The two balances ─────────────────────────────────────── */}
      <div className="grid gap-4 sm:grid-cols-2">
        <Card className={cn(g.master && "border-l-3 border-l-brand-orange")}>
          <CardBody>
            <p className="flex items-center gap-2 text-sm text-grey-500">
              <Wallet className="size-4" /> The host
            </p>
            {g.master ? (
              <>
                <p className="mt-1 text-2xl font-semibold tabular">
                  {money(g.master.balance)}
                </p>
                <p className="mt-0.5 text-sm text-grey-500">
                  {routedCount} of {g.rooms.length}{" "}
                  {routedCount === 1 ? "room routed here" : "rooms routed here"}
                </p>
              </>
            ) : (
              <>
                {/* A dash, not a zero. No master folio is not the same as a
                    host who owes nothing. */}
                <p className="mt-1 text-2xl font-semibold text-grey-300">—</p>
                <p className="mt-0.5 text-sm text-grey-500">
                  No host account. Every room settles its own.
                </p>
                <Button
                  variant="secondary" className="mt-3 h-11"
                  disabled={busy === "master"}
                  onClick={() => void openMaster()}
                >
                  Open a host account
                </Button>
              </>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardBody>
            <p className="flex items-center gap-2 text-sm text-grey-500">
              <Users className="size-4" /> The guests
            </p>
            <p className="mt-1 text-2xl font-semibold tabular">
              {money(g.guestBalance)}
            </p>
            <p className="mt-0.5 text-sm text-grey-500">
              Across {g.rooms.length} {g.rooms.length === 1 ? "folio" : "folios"}
            </p>
          </CardBody>
        </Card>
      </div>

      {/* Said once, plainly, because a combined figure is what somebody
          will otherwise work out for themselves and then quote. */}
      <p className="mt-3 text-sm text-grey-600">
        Two accounts, not one total. The host is billed for the rooms routed
        to them; each guest is billed for their own folio. Adding them would
        give a number nobody can be asked to pay.
      </p>

      {/* ── The rooms ────────────────────────────────────────────── */}
      <Card className="mt-6">
        <CardHeader
          title="Rooms"
          description="Tick a room to put its accommodation on the host's account."
        />
        <CardBody className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-base border-collapse">
              <thead>
                <tr className="border-b border-grey-200">
                  <th className="px-4 py-2 text-left font-medium">Guest</th>
                  <th className="px-4 py-2 text-left font-medium">Room</th>
                  <th className="px-4 py-2 text-left font-medium">Dates</th>
                  <th className="px-4 py-2 text-right font-medium">Rate</th>
                  <th className="px-4 py-2 text-right font-medium">Own folio</th>
                  <th className="px-4 py-2 text-center font-medium">Host pays</th>
                </tr>
              </thead>
              <tbody>
                {g.rooms.map((r) => (
                  <tr key={r.reservationId} className="border-b border-grey-200">
                    <td className="px-4 py-3">
                      <Link
                        to={`/h/${hotelId}/stay?res=${r.reservationId}`}
                        className="font-medium hover:underline"
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
                        <span className="text-grey-300">—</span>
                      )}
                      <span className="block text-xs text-grey-500">
                        {r.roomType}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="tabular text-sm">
                        {r.checkIn} → {r.checkOut}
                      </span>
                      <span className="block text-xs text-grey-500">
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
                          "size-11 rounded-lg border grid place-items-center",
                          "cursor-pointer transition-colors duration-150",
                          "disabled:opacity-50 disabled:cursor-not-allowed",
                          r.routed
                            ? "bg-ink-900 border-ink-900 text-white"
                            : "bg-white border-grey-300 hover:border-grey-400",
                        )}
                      >
                        {r.routed && <Check className="size-4" />}
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
        <Card className="mt-6">
          <CardHeader
            title="The host's account"
            description="Every line says which room it is for."
          />
          <CardBody>
            {g.master.lines.length === 0 ? (
              <p className="text-grey-500">
                Nothing has been charged to the host yet. Route a room above,
                and tonight&rsquo;s audit will post it here.
              </p>
            ) : (
              <ul className="divide-y divide-grey-200">
                {g.master.lines.map((l, i) => (
                  <li key={i} className="flex items-baseline gap-3 py-2.5">
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
          </CardBody>
        </Card>
      )}

      <p className="mt-4 text-sm text-grey-600">
        Changing who pays affects nights <b>not yet charged</b>. The audit
        posts one night at a time, so anything already on a folio stays where
        it was posted — moving it is a reversal and a re-post, with a reason
        beside it. <ArrowRight className="inline size-3" /> the folio.
      </p>
    </Page>
  );
}
