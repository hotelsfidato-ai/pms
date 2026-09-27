import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router";
import { Users, ChevronRight, ChevronDown, BedDouble } from "lucide-react";
import { cn } from "@/lib/cn";
import { money, dateShort } from "@/lib/format";
import {
  Page, PageHeader, Card, CardBody, Button, Skeleton, EmptyState, StatusPill, Segmented,
} from "@/components/ui";
import { listGroups, getGroup, type StayGroup } from "@/modules/reservations/data/groups";

/* ══════════════════════════════════════════════════════════════════
   ONE BOOKING, ITS ROOMS BENEATH IT

   A group is HOW A HOTEL ACTUALLY SELLS TO A WEDDING: one conversation,
   one contact, one set of dates, and nine rooms. Every list in this
   system showed those nine as nine unrelated bookings, so the person
   taking the call had to hold the relationship in their head.

   The group PANEL has existed since 056 and could be reached only by
   somebody who already knew a group's id — no list, no navigation
   entry, no way in from any screen. The endpoint behind this list
   existed too, and was called by nothing but a test. Built and
   unreachable is the same hole room types had, and the front desk's
   hours, and every one of the admin endpoints: a feature is not built
   until the people it is for can reach it.

   THE ROOMS LOAD WHEN A GROUP IS OPENED, not before. A property with
   forty groups would otherwise fetch four hundred bookings to draw a
   list nobody has expanded.

   TWO BALANCES, NEVER ONE. `masterBalance` is what the HOST owes on
   their own account; `guestBalance` is the sum of what the individual
   rooms owe on theirs. Adding them produces a number nobody is being
   asked to pay — which is why the panel keeps them apart and why this
   does too. And null is not zero: most groups have no host account at
   all, and zero would say the host owes nothing.
   ══════════════════════════════════════════════════════════════════ */

export default function GroupsPage() {
  const { code = "" } = useParams<{ code: string }>();
  const [scope, setScope] = useState<"current" | "all">("current");
  const [open, setOpen] = useState<string | null>(null);

  const q = useQuery({
    queryKey: ["groups", code, scope],
    queryFn: () => listGroups(code, scope),
    enabled: !!code,
  });

  const groups = q.data ?? [];

  return (
    <Page className="max-w-5xl">
      <PageHeader
        title="Groups"
        description={
          groups.length === 0
            ? "A wedding, a conference, a family - one booking with several rooms."
            : `${groups.length} group${groups.length === 1 ? "" : "s"} · `
              + `${groups.reduce((n, g) => n + g.rooms, 0)} rooms`
        }
        actions={
          /* A choice of view, so the view control. It was two buttons with
             the selected one drawn PRIMARY — the colour that means "this is
             the action to take", used to mean "this is selected". */
          <Segmented<"current" | "all">
            value={scope}
            onChange={setScope}
            className="max-sm:flex max-sm:w-full max-sm:[&>button]:flex-1"
            options={[
              { value: "current", label: "Here and coming" },
              { value: "all", label: "All" },
            ]}
          />
        }
      />

      {q.isLoading ? (
        <Skeleton className="h-64" />
      ) : groups.length === 0 ? (
        <EmptyState
          icon={<Users />}
          title={scope === "current" ? "No groups here or coming" : "No groups yet"}
          description={
            scope === "current"
              ? "Nothing with more than one room is in the house or due. Past "
                + "groups are under All."
              : "A booking made for more than one room becomes a group "
                + "automatically. Nothing has been made yet."
          }
        />
      ) : (
        <ul className="space-y-3">
          {groups.map((g) => (
            <GroupRow
              key={g.id}
              group={g}
              code={code}
              open={open === g.id}
              onToggle={() => setOpen(open === g.id ? null : g.id)}
            />
          ))}
        </ul>
      )}
    </Page>
  );
}

function GroupRow({ group, code, open, onToggle }: {
  group: StayGroup; code: string; open: boolean; onToggle: () => void;
}) {
  /* Only when opened. Forty groups would otherwise fetch four hundred
     bookings to draw a list nobody has expanded. */
  const detail = useQuery({
    queryKey: ["group", code, group.id],
    queryFn: () => getGroup(code, group.id),
    enabled: open,
  });

  const Chevron = open ? ChevronDown : ChevronRight;

  return (
    <li>
      <Card>
        <CardBody className="p-0">
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={open}
            className={cn(
              "w-full flex items-start gap-2.5 text-left px-4 py-3.5",
              "cursor-pointer hover:bg-grey-50 transition-colors duration-150",
              "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange",
              open ? "rounded-t-lg" : "rounded-lg",
            )}
          >
            <Chevron className="size-4 text-grey-400 shrink-0 mt-1" />

            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-2 flex-wrap">
                <span className="text-base font-medium text-ink-900">
                  {group.name}
                </span>
                {group.reference && (
                  <span className="text-sm tabular text-grey-500">
                    {group.reference}
                  </span>
                )}
                {group.company && (
                  <span className="text-sm text-grey-500">
                    · {group.company}
                  </span>
                )}
              </div>

              <p className="text-sm text-grey-600 mt-0.5">
                {group.rooms} room{group.rooms === 1 ? "" : "s"}
                {" · "}{group.nights} room-night{group.nights === 1 ? "" : "s"}
                {" · "}{dateShort(group.arrival)} to {dateShort(group.departure)}
              </p>

              {/* Where the group is TODAY, which is what somebody
                  opening this list is asking. Only the states that are
                  actually there — a row reading "0 in house, 0 due in,
                  0 departed" says nothing. */}
              <div className="flex flex-wrap gap-1.5 mt-2">
                {/* One colour per state, everywhere (D27-48): in house
                    blue, due in orange, cancelled red. */}
                {group.inHouse > 0 && (
                  <StatusPill tone="info">{group.inHouse} in house</StatusPill>
                )}
                {group.dueIn > 0 && (
                  <StatusPill tone="accent">{group.dueIn} due in</StatusPill>
                )}
                {group.departed > 0 && (
                  <StatusPill tone="neutral">{group.departed} departed</StatusPill>
                )}
                {group.cancelled > 0 && (
                  <StatusPill tone="danger">{group.cancelled} cancelled</StatusPill>
                )}
                {group.routedRooms > 0 && (
                  <StatusPill tone="neutral">
                    {group.routedRooms} billed to the host
                  </StatusPill>
                )}
              </div>
            </div>

            {/* TWO BALANCES, side by side, never summed. */}
            <div className="text-right shrink-0 pl-2">
              <p className="text-sm text-grey-500">Rooms owe</p>
              <p className="text-base tabular font-medium text-ink-900">
                {money(group.guestBalance)}
              </p>
              <p className="text-sm text-grey-500 mt-1">Host owes</p>
              <p className={cn("text-base tabular font-medium",
                group.masterBalance === null ? "text-grey-500" : "text-ink-900")}>
                {/* A dash, because most groups have no host account and
                    zero would say the host owes nothing. */}
                {group.masterBalance === null ? "-" : money(group.masterBalance)}
              </p>
            </div>
          </button>

          {open && (
            <div className="border-t border-grey-200 px-4 py-3.5">
              {detail.isLoading ? (
                <Skeleton className="h-24" />
              ) : !detail.data ? (
                <p className="text-sm text-grey-500">
                  This group's rooms did not load. Nothing was changed.
                </p>
              ) : (
                <>
                  {/* List rows, not boxes in the card (the Rhythm Rule's
                      row: 12px, a hairline between); each opens its stay,
                      so each ends in an arrow. */}
                  {/* `@container`: the room type below shows from a medium
                      list width up (448px); with no container it never
                      showed (the owner, 27 September). */}
                  <ul className="@container -mt-3 divide-y divide-grey-100">
                    {detail.data.rooms.map((r) => (
                      <li key={r.reservationId}>
                        <Link
                          /* The same way the group panel opens one: the tape chart
                             with the stay panel already open. There is no
                             standalone stay route, and inventing one here
                             would make two ways to look at a booking. */
                          to={`/h/${code}/stay?res=${r.reservationId}`}
                          className="flex items-center gap-2.5 -mx-4 px-4 py-3 min-h-14
                                     hover:bg-grey-50 transition-colors duration-150
                                     focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-orange"
                        >
                          <BedDouble className="size-4 text-grey-400 shrink-0" />
                          <span className="tabular font-medium text-ink-900 w-14 shrink-0">
                            {/* Null once they have left. Inventing a room
                                number for somebody who has gone would put
                                them back in it. */}
                            {r.room ?? "-"}
                          </span>
                          <span className="text-base text-ink-900 truncate min-w-0 flex-1">
                            {r.guest}
                          </span>
                          <span className="text-sm text-grey-500 shrink-0 hidden @md:inline">
                            {r.roomType}
                          </span>
                          {r.routed && (
                            <StatusPill tone="neutral">Host pays</StatusPill>
                          )}
                          <span className="text-sm tabular text-ink-900 shrink-0 w-20 text-right">
                            {money(r.balance)}
                          </span>
                          <ChevronRight className="size-4 text-grey-400 shrink-0" aria-hidden />
                        </Link>
                      </li>
                    ))}
                  </ul>

                  <div className="flex justify-end pt-3.5 border-t border-grey-100">
                    {/* A link that looks like the button it is (one element,
                        not a button inside a link). */}
                    <Button asChild variant="secondary">
                      <Link to={`/h/${code}/groups/${group.id}`}>Open the group</Link>
                    </Button>
                  </div>
                </>
              )}
            </div>
          )}
        </CardBody>
      </Card>
    </li>
  );
}
