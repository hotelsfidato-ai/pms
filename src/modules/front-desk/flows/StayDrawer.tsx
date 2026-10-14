import { vipLevels } from "@/modules/front-desk/data/lists";
import { useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Phone, Mail, Globe, LogOut } from "lucide-react";
import { cn } from "@/lib/cn";
import { money, moneyPrecise, dateShort } from "@/lib/format";
import {
  Button, Drawer, DrawerContent, StatusPill, Skeleton, toast,
  Tabs, TabsList, TabsTrigger, TabsContent, type Tone,
} from "@/components/ui";
import { getFolio, useStayDue } from "@/modules/finance";
import { queryKeys, type Stay } from "@/data/repositories";
import { setGuestVip, EditGuestFlow } from "@/modules/guests";
import { CheckInFlow } from "@/modules/front-desk/flows/CheckInFlow";
import { StayActions } from "@/modules/front-desk/flows/StayActions";
import { FolioPanel } from "@/modules/finance";
import { StayMarks } from "@/modules/front-desk/flows/StayMarks";
import { AddIdPhotoAtDesk } from "@/modules/online-checkin";
import { CrsFacts } from "@/modules/crs";
import { GuestMarks } from "@/modules/front-desk/flows/GuestMarks";
import { GroupRoomsList } from "@/modules/reservations";
import { KeyCards } from "@/modules/room-systems";
import { useRole } from "@/lib/session";
import { can } from "@/lib/permissions";

/* ══════════════════════════════════════════════════════════════════
   THE STAY PANEL — one of it

   ⚠ THIS EXISTED TWICE. The tape chart drew `StayDetail` and the
   arrival, in-house and departure lists drew `StaySummary`, each inside
   its own copy of the drawer. The list's comment called it "the same
   panel the tape chart opens"; it was a second panel with fewer rows,
   and every fix to one had to be remembered for the other. Defect 143
   was this shape, and StayMarks was split out of it once already.

   REBUILT ON 14 SEPTEMBER from the owner's screenshot — "looks terrible
   and is not very readable" — against the reference layout he sent:

     name, then how to reach the guest      the header
     the act, then everything else          one action row, at the TOP
     the booking in two columns             labels above values
     what is owed, always in view           a pinned footer
     the group's rooms beside the booking   a column, not a dialog

   Nothing is offered here that does not already work. The reference
   carries "Print / Send" and "Edit Reservation"; this system has no
   print for a stay, and editing is "Change dates or guests" inside
   More options, where the product put the rare acts deliberately.
   ══════════════════════════════════════════════════════════════════ */

export interface StayPill {
  tone: Tone;
  label: string;
}

export function StayDrawer({
  hotelId, stay, businessDate, status, onClose,
  defaultTab = "stay", offerCheckIn = true,
}: {
  /** The property code. */
  hotelId: string;
  /** Null closes the panel. */
  stay: Stay | null;
  businessDate: string;
  /** THE PILL IS THE CALLER'S. The chart shows a derived tone (due-out
      is a status plus a date) and the lists show the status itself —
      they mean different things, see StayMarks. */
  status: StayPill | null;
  onClose: () => void;
  defaultTab?: "stay" | "folio";
  offerCheckIn?: boolean;
}) {
  /* The bill is `invoice` view (D27-143): the revenue manager, housekeeping,
     the kitchen manager and the till read the booking and not its bill, so
     no Bill tab and no totals - the server refuses them anyway. */
  const seesBills = can(useRole(), "view", "invoice");
  return (
    <Drawer open={!!stay} onOpenChange={(open) => !open && onClose()}>
      {stay && (
        <DrawerContent
          title={<span className="text-lg font-semibold">{stay.guest}</span>}
          description={<HeaderLine stay={stay} />}
          width={stay.group ? "xl" : "lg"}
          footer={seesBills ? <FolioTotals hotelId={hotelId} stay={stay} /> : undefined}
        >
          {/* Keyed, so opening another room of the group starts on its
              own first tab rather than wherever the last one was left. */}
          <StayBody
            key={stay.id}
            hotelId={hotelId}
            stay={stay}
            businessDate={businessDate}
            status={status}
            defaultTab={defaultTab}
            offerCheckIn={offerCheckIn}
          />
        </DrawerContent>
      )}
    </Drawer>
  );
}

/* ── The header ───────────────────────────────────────────────────
   The reference number, and every way to reach the guest that the
   booking captured. A contact that is not there is simply absent — a
   header of dashes is noise, and the rows below already say "—" where
   a dash is information. */
function HeaderLine({ stay }: { stay: Stay }) {
  const item = "inline-flex items-center gap-1.5 text-grey-600";
  return (
    <span className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-0.5">
      <span className="tabular text-grey-600">{stay.reference}</span>
      {stay.phone && (
        <a href={`tel:${stay.phone}`}
           className={cn(item, "hover:text-ink-900 tabular")}>
          <Phone className="size-3.5" aria-hidden />
          {stay.phone}
        </a>
      )}
      {stay.email && (
        <a href={`mailto:${stay.email}`}
           className={cn(item, "hover:text-ink-900 min-w-0 break-all")}>
          <Mail className="size-3.5 shrink-0" aria-hidden />
          {stay.email}
        </a>
      )}
      {/* ONLY A FOREIGN GUEST. `guests.nationality` is NOT NULL with a
          default of 'IN', so "IN" is on every guest whether anybody asked
          or not — a default, not a fact somebody recorded. A foreign
          nationality is the one the desk acts on: it means Form C. */}
      {stay.nationality && stay.nationality.toUpperCase() !== "IN" && (
        <span className={cn(item, "font-medium text-ink-900")}>
          <Globe className="size-3.5" aria-hidden />
          {stay.nationality}
        </span>
      )}
    </span>
  );
}

function StayBody({
  hotelId, stay, businessDate, status, defaultTab, offerCheckIn,
}: {
  hotelId: string; stay: Stay; businessDate: string;
  status: StayPill | null; defaultTab: "stay" | "folio";
  offerCheckIn: boolean;
}) {
  /* No Bill tab without bills (D27-143), so never open on it. */
  const [tab, setTab] = useState<"stay" | "folio">(
    can(useRole(), "view", "invoice") ? defaultTab : "stay");
  const arrived = stay.status === "in-house" || stay.status === "due-out";
  /* D24-27: each act offered only to a role the server's gate lets do it
     (roleGate, from the one matrix). Check-in is reservation edit; the VIP
     mark is the guest's record, customer edit; "Settle and check out" leads
     to both a payment (payment create) and the check-out (reservation edit),
     so it is for whoever may do either (the owner, 24 September). */
  const role = useRole();
  const seesBills = can(role, "view", "invoice");
  const mayEdit = can(role, "edit", "reservation");
  const maySettle = can(role, "create", "payment") || mayEdit;

  return (
    <div
      className={cn(
        stay.group &&
          "lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(280px,340px)] lg:gap-8",
      )}
    >
      <div className="min-w-0 space-y-5">
        <div className="flex flex-wrap items-center gap-2">
          {status && <StatusPill tone={status.tone} dot>{status.label}</StatusPill>}
          <StayMarks stay={stay} />
          {/* The toggle, not a mark — it CHANGES the guest rather than
              reporting them, so it sits beside the marks, not in them. */}
          {stay.guestId && can(role, "edit", "customer") && (
            <>
              <VipToggle hotelId={hotelId} stay={stay} />
              {/* GU-1: nothing could correct a guest's record before. */}
              <EditGuest hotelId={hotelId} guestId={stay.guestId} />
            </>
          )}
          {/* The CRM's: stayed with the group before, the WhatsApp tick,
              and Guest 360 for the three who may open it. */}
          <GuestMarks hotelId={hotelId} stay={stay} />
        </div>

        {/* ── The act, then everything else ──────────────────────────
            At the TOP. It was below thirteen rows, which on a phone is
            a scroll before the clerk can do the one thing the panel was
            opened for. One orange button: check in on an arrival;
            settle-and-leave for somebody in the house. The rare acts —
            amend, move, exchange, void — stay inside More options. */}
        <div className="flex flex-wrap items-start gap-2">
          {offerCheckIn && stay.status === "due-in" && mayEdit && (
            <CheckInFlow hotelId={hotelId} stay={stay} businessDate={businessDate} />
          )}
          {arrived && tab !== "folio" && maySettle && (
            /* The folio is where settling and check-out happen, with
               check-out shown blocked and the reason why while anything
               is owed. This takes the clerk there; it does not bypass it. */
            <Button
              variant="primary"
              leadingIcon={<LogOut className="size-4" />}
              onClick={() => setTab("folio")}
            >
              Settle and check out
            </Button>
          )}
          <StayActions hotelId={hotelId} stay={stay} businessDate={businessDate} />
        </div>

        <Tabs value={tab} onValueChange={(v) => setTab(v === "folio" ? "folio" : "stay")}>
          <TabsList>
            <TabsTrigger value="stay">Stay</TabsTrigger>
            {seesBills && <TabsTrigger value="folio">Bill</TabsTrigger>}
          </TabsList>
          <TabsContent value="stay">
            <div className="flex flex-col gap-6">
              <StayFacts stay={stay} />
              {/* D27-168: the CRS number, salesperson, company and any change
                  made in the CRS since; nothing for a booking the CRS did not sell. */}
              <CrsFacts code={hotelId} reservationId={stay.id} />
              {/* D27-210: the desk adds the ID photo here too; it draws nothing for anybody else. */}
              <AddIdPhotoAtDesk stayId={stay.id} />
              {arrived && <KeyCards hotelId={hotelId} stay={stay} />}
            </div>
          </TabsContent>
          {seesBills && (
            <TabsContent value="folio">
              <FolioPanel hotelId={hotelId} stay={stay} businessDate={businessDate} />
            </TabsContent>
          )}
        </Tabs>
      </div>

      {stay.group && (
        <aside
          className="mt-8 pt-6 border-t border-grey-200
                     lg:mt-0 lg:pt-0 lg:border-t-0 lg:border-l lg:pl-8"
        >
          <GroupRoomsList
            hotelId={hotelId}
            groupId={stay.group.id}
            currentStayId={stay.id}
          />
        </aside>
      )}
    </div>
  );
}

/* ── The booking, in two columns ─────────────────────────────────
   LABELS ABOVE VALUES. Thirteen label-beside-value rows was one long
   column of small grey words on a phone; a grid of pairs reads in
   half the height, and the value — the thing being looked up — is the
   larger, darker text. Three sections, in the order a clerk asks:
   when and where, at what price, and who sent them. */
const DASH = "-";

function StayFacts({ stay: s }: { stay: Stay }) {
  const party = `${s.adults} adult${s.adults === 1 ? "" : "s"}`
    + (s.children ? `, ${s.children} child${s.children === 1 ? "" : "ren"}` : "");

  return (
    <div className="space-y-6">
      <FactGroup title="Stay">
        <Fact label="Arrival" tabular>{dateShort(s.arrival)}</Fact>
        <Fact label="Departure" tabular>{dateShort(s.departure)}</Fact>
        <Fact label="Nights" tabular>{s.isDayUse ? "Day use" : s.nights}</Fact>
        <Fact label="Room">
          {/* A reservation is for a room TYPE; the number arrives when a
              room is assigned. Said, not left blank. */}
          {/* The room's own type; an upgrade names the type booked too (D27-328). */}
          {s.roomNumber
            ? <><span className="tabular">{s.roomNumber}</span> · {s.givenRoomType ?? s.roomType}
                {s.givenRoomType && <span className="font-normal text-grey-600"> · booked {s.roomType}</span>}</>
            : <>{s.roomType} <span className="font-normal text-grey-600">· no room yet</span></>}
        </Fact>
        <Fact label="Guests">{party}</Fact>
      </FactGroup>

      <FactGroup title="Rate">
        <Fact label="Rate plan">{s.ratePlan}</Fact>
        <Fact label="Per night" tabular>
          {s.isComplimentary ? "Complimentary" : money(s.offeredTariff)}
        </Fact>
        <Fact label="Rack rate" tabular>
          {/* A dash when the room type has no rate set — never ₹0.
              Defect 246: the API flattened NULL into 0 and this row
              printed a price nobody had set. */}
          {s.rackTariff === null ? DASH : money(s.rackTariff)}
        </Fact>
      </FactGroup>

      <FactGroup title="Booked through">
        <Fact label="Source">{s.source ?? DASH}</Fact>
        <Fact label="Business source">{s.businessSource ?? DASH}</Fact>
        {/* A dash, never a guess. An invented segment becomes a line in
            a source-mix report an owner sets policy from. */}
        <Fact label="Segment">{s.marketSegment ?? DASH}</Fact>
        {s.salesPerson && <Fact label="Sold by">{s.salesPerson}</Fact>}
      </FactGroup>

      {s.voidReason && (
        <div className="rounded-lg bg-brand-red-50 border border-brand-red-100 px-4 py-3.5">
          <p className="text-xs font-semibold uppercase tracking-wide text-brand-red-700 mb-1">
            Voided
          </p>
          <p className="text-base text-grey-700 leading-relaxed">
            {s.voidReason} - this booking is on the record as never having
            happened, and is left out of revenue and cancellation figures alike.
          </p>
        </div>
      )}

      {s.notes && (
        <div className="rounded-lg bg-grey-50 border border-grey-200 px-4 py-3.5">
          <p className="text-xs font-semibold uppercase tracking-wide text-grey-600 mb-1">
            Note
          </p>
          <p className="text-base text-grey-700 leading-relaxed">{s.notes}</p>
        </div>
      )}
    </div>
  );
}

function FactGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h3 className="text-xs font-semibold uppercase tracking-wide text-grey-600
                     pb-2 mb-3.5 border-b border-grey-200">
        {title}
      </h3>
      <dl className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-4">
        {children}
      </dl>
    </section>
  );
}

function Fact({ label, children, tabular }: {
  label: string; children: ReactNode; tabular?: boolean;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-sm text-grey-600">{label}</dt>
      <dd className={cn(
        "mt-0.5 text-base font-semibold text-ink-900 break-words",
        tabular && "tabular",
      )}>
        {children}
      </dd>
    </div>
  );
}

/* ── What is owed, pinned ─────────────────────────────────────────
   Charged, paid and the balance, always in view whichever tab is open.

   "CHARGED", NOT "TOTAL". Room nights post at the night audit, so an
   arrival that has not slept here yet has been charged nothing — and a
   footer saying "Total ₹0" for a three-night booking would read as a
   free stay. Charged is what the folio holds; it is the truth.

   Charged is balance + payments, not the charge lines summed again:
   the folio's own balance is the one definition of what is owed, and a
   second sum is how two screens come to disagree by a round-off.

   Null folio is dashes, never zeros — a zeroed folio reads as "settled",
   which is the wrong answer to "does this guest owe anything". */
function FolioTotals({ hotelId, stay }: { hotelId: string; stay: Stay }) {
  const q = useQuery({
    queryKey: queryKeys.folio(hotelId, stay.id),
    queryFn: () => getFolio(hotelId, stay.id),
  });
  /* WHILE CHARGES ARE TO COME, THE FOOT SAYS WHAT IS DUE WITH THEM COUNTED -
     finance's one figure, the Bill tab's own (D27-199). The posted balance
     alone read "In advance" under a bill saying an amount was due. */
  const due = useStayDue(hotelId, stay);

  if (q.isLoading) {
    return (
      <div className="grid w-full grid-cols-3 gap-4" aria-busy>
        <Skeleton className="h-10" />
        <Skeleton className="h-10" />
        <Skeleton className="h-10" />
      </div>
    );
  }

  const f = q.data ?? null;
  const balance = f ? f.balance : null;
  /* A CREDIT IS NOT AN OVERPAYMENT UNTIL THEY HAVE LEFT. Most guests pay
     a token when they book and settle at check-out, so a negative balance
     before departure is an ADVANCE — the normal case. */
  const balanceLabel = balance !== null && balance < 0
    ? (stay.status === "checked-out" ? "Overpaid" : "In advance")
    : "Balance";

  const owed = due ? due.after : balance;
  return (
    <dl className="grid w-full grid-cols-3 gap-4" data-stay-totals>
      <Total label="Charged" value={f ? f.balance + f.payments : null} />
      <Total label="Paid" value={f ? f.payments : null} />
      <Total
        label={due && (owed === null || owed > 0) ? "Due" : balanceLabel}
        value={owed === null ? null : Math.abs(owed)}
        precise={!!due}
        className={cn(
          "text-right",
          owed === null ? "text-ink-900"
            : owed > 0 ? "text-brand-red-700"
            : owed < 0 ? "text-info"
            : "text-success-600",
        )}
        emphasis
      />
    </dl>
  );
}

function Total({ label, value, emphasis, precise, className }: {
  label: string; value: number | null; emphasis?: boolean;
  /** To the paisa, as the Bill tab's headline prints the same figure. */
  precise?: boolean; className?: string;
}) {
  return (
    <div className={cn("min-w-0", className)}>
      <dt className="text-sm text-grey-600">{label}</dt>
      <dd className={cn(
        "tabular font-semibold",
        emphasis ? "text-lg" : "text-md text-ink-900",
      )}>
        {value === null ? DASH : precise ? moneyPrecise(value) : money(value)}
      </dd>
    </div>
  );
}

/* ── Correcting the guest (GU-1) ──────────────────────────────────
   The same quiet link as Mark VIP: it changes the guest, not the stay. */
function EditGuest({ hotelId, guestId }: { hotelId: string; guestId: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="min-h-8 px-1 text-sm font-medium text-grey-600 hover:text-ink-900
                   underline underline-offset-4 cursor-pointer
                   rounded-sm focus-visible:outline-2 focus-visible:outline-brand-orange"
      >
        Edit guest
      </button>
      {open && <EditGuestFlow hotelId={hotelId} guestId={guestId} open onOpenChange={setOpen} />}
    </>
  );
}

/* ── Marking a VIP ────────────────────────────────────────────────
   Not a switch in a settings panel. The moment somebody knows is the
   moment they are looking at the booking, and a mark that needs a
   different screen is a mark nobody makes. */
function VipToggle({ hotelId, stay }: { hotelId: string; stay: Stay }) {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);

  /* The group's VIP levels (192, D27-260 Q7): with any, marking asks which. */
  const levels = useQuery({ queryKey: ["vip-levels", hotelId], queryFn: () => vipLevels(hotelId) });
  const active = (levels.data ?? []).filter((l) => l.active);

  const toggle = async (levelId?: string) => {
    if (!stay.guestId) return;
    setBusy(true);
    const result = await setGuestVip(hotelId, stay.guestId, !stay.isVip, levelId);
    setBusy(false);
    if (!result.ok) return toast.error("Not changed", result.reason);
    toast.success(
      stay.isVip ? "No longer marked VIP" : "Marked VIP",
      `${result.guest} - this holds for their next visit too.`);
    void queryClient.invalidateQueries();
  };

  if (!stay.isVip && active.length > 0) {
    return (
      <select aria-label="Mark VIP" disabled={busy} value=""
        onChange={(e) => e.target.value && void toggle(e.target.value)}
        className="min-h-8 px-1 text-sm font-medium text-grey-600 bg-transparent underline underline-offset-4 cursor-pointer rounded-sm">
        <option value="">Mark VIP</option>
        {active.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
      </select>
    );
  }

  return (
    <button
      type="button"
      onClick={() => void toggle()}
      disabled={busy}
      aria-pressed={stay.isVip}
      className="min-h-8 px-1 text-sm font-medium text-grey-600 hover:text-ink-900
                 underline underline-offset-4 cursor-pointer disabled:opacity-50
                 rounded-sm focus-visible:outline-2 focus-visible:outline-brand-orange"
    >
      {stay.isVip ? "Remove VIP" : "Mark VIP"}
    </button>
  );
}
