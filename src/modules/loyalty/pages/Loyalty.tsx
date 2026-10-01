import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Award } from "lucide-react";
import { isoDate, money, number } from "@/lib/format";
import { useUi } from "@/lib/ui";
import {
  Page, PageHeader, Card, CardBody, CardHeader, Button, Field, Input, Checkbox,
  Dialog, DialogContent, EmptyState, ErrorState, Skeleton, DataTable, toast, type Column,
} from "@/components/ui";
import {
  getLoyalty, saveRules, joinLoyalty, leaveLoyalty, spendPoints, getByHotel,
  type LoyaltyScreen, type LoyaltyStay,
} from "@/modules/loyalty/data/loyalty";

/* ══════════════════════════════════════════════════════════════════
   LOYALTY — the desk's screen (D27-178, D27-179; MODULE.md L1-L18)

   Who is in house, whether each is a member and their points; the desk
   joins a guest who agrees in the programme's own words (L4) and takes
   points off a member's room charges (L13). Points are earned by
   themselves at check-out (L9). The rules card is for whoever sets the
   group's name; the month by hotel for the owner, an administrator and
   the GM (L18). A figure nobody set is a dash.
   ══════════════════════════════════════════════════════════════════ */

const DASH = "-";

export default function LoyaltyPage() {
  const hotelId = useUi((s) => s.hotelId);
  const screen = useQuery({ queryKey: ["loyalty", hotelId], queryFn: () => getLoyalty(hotelId) });
  const s = screen.data;

  if (screen.isLoading) return <Page><PageHeader title="Loyalty" /><Skeleton className="h-80" /></Page>;
  if (screen.error || !s) {
    return <Page><PageHeader title="Loyalty" />
      <Card><ErrorState error={screen.error} onRetry={() => void screen.refetch()} /></Card></Page>;
  }

  return (
    <Page>
      <PageHeader title="Loyalty"
        description={`${s.name ?? "No programme name yet"} · ${s.pointsPer100 === null
          ? "no earn rate set: stays earn nothing"
          : `${number(s.pointsPer100)} points per ₹100 before GST; 1 point is ₹1 off room charges`}`} />
      <div className="space-y-3">
        {!s.isOn && (
          <Card><CardBody>
            <p className="text-sm text-grey-600">
              Loyalty is off at this hotel: nobody joins, earns or uses points here. The owner or an
              administrator turns it on in Settings, under Modules.
            </p>
          </CardBody></Card>
        )}
        <InHouseCard hotelId={hotelId} screen={s} />
        {s.maySetRules && <RulesCard hotelId={hotelId} screen={s} />}
        {s.isManager && <ByHotelCard hotelId={hotelId} />}
      </div>
    </Page>
  );
}

function InHouseCard({ hotelId, screen: s }: { hotelId: string; screen: LoyaltyScreen }) {
  const [joining, setJoining] = useState<LoyaltyStay | null>(null);
  const [spending, setSpending] = useState<LoyaltyStay | null>(null);
  const [leaving, setLeaving] = useState<LoyaltyStay | null>(null);

  const columns: Column<LoyaltyStay>[] = [
    { key: "room", header: "Room", cell: (r) => <span className="tabular">{r.room ?? DASH}</span> },
    { key: "guest", header: "Guest", cell: (r) => r.name },
    { key: "points", header: "Points", numeric: true,
      cell: (r) => (r.member ? <span className="tabular">{number(r.points ?? 0)}</span>
        : <span className="text-grey-500">Not a member</span>) },
    { key: "act", header: "", cell: (r) => (
      <div className="flex flex-wrap justify-end gap-2">
        {r.member ? (
          <>
            {r.direct && <Button size="sm" onClick={() => setSpending(r)}>Use points</Button>}
            <Button size="sm" variant="ghost" onClick={() => setLeaving(r)}>Leave</Button>
          </>
        ) : (
          <Button size="sm" variant="secondary" onClick={() => setJoining(r)}>Join</Button>
        )}
      </div>
    ) },
  ];

  return (
    <Card>
      <CardHeader title="In house" />
      <DataTable<LoyaltyStay> rows={s.stays} columns={columns} rowKey={(r) => r.id}
        className="border-0 rounded-t-none"
        empty={<EmptyState compact icon={<Award />} title="Nobody is checked in"
          description="Guests in house appear here, to join or to use their points." />} />
      {joining && <JoinDialog hotelId={hotelId} stay={joining} words={s.words} onClose={() => setJoining(null)} />}
      {spending && <SpendDialog hotelId={hotelId} stay={spending} onClose={() => setSpending(null)} />}
      {leaving && <LeaveDialog hotelId={hotelId} stay={leaving} onClose={() => setLeaving(null)} />}
    </Card>
  );
}

/** Runs a write, says what the server said, and reloads the screen. */
function useAct(onDone: () => void) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const act = async (result: Promise<{ ok: true } | { ok: false; reason: string }>, said: string) => {
    setBusy(true);
    const r = await result;
    setBusy(false);
    if (!r.ok) return toast.error("Not done", r.reason);
    toast.success(said);
    void qc.invalidateQueries({ queryKey: ["loyalty"] });
    onDone();
  };
  return { busy, act };
}

/* L4: the guest's own yes to the programme's own words, separate from offers. */
function JoinDialog({ hotelId, stay, words, onClose }: {
  hotelId: string; stay: LoyaltyStay; words: string | null; onClose: () => void;
}) {
  const [agreed, setAgreed] = useState(false);
  const { busy, act } = useAct(onClose);
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent size="sm" title={`Join ${stay.name}`}
        description="Read this to the guest. Joining is not a yes to offers."
        footer={<>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={busy || !agreed || !words}
            onClick={() => void act(joinLoyalty(hotelId, stay.guestId), `${stay.name} joined`)}>Join</Button>
        </>}>
        <div className="space-y-3">
          <p className="text-ink-900">{words ?? "The programme has no name yet, so there is nothing to agree to. Set it below first."}</p>
          {!stay.hasPhone && <p className="text-sm text-grey-600">This guest has no mobile number on file; a member needs one.</p>}
          <Checkbox checked={agreed} onCheckedChange={setAgreed} label="The guest agrees" disabled={!words} />
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* L13: from 500, up to the balance and the room charges on the bill. */
function SpendDialog({ hotelId, stay, onClose }: { hotelId: string; stay: LoyaltyStay; onClose: () => void }) {
  const [points, setPoints] = useState("");
  /* One key per press of this dialog: a double tap takes the points once. */
  const [pressKey] = useState(() => crypto.randomUUID());
  const { busy, act } = useAct(onClose);
  const n = Number(points);
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent size="sm" title={`Use points for ${stay.name}`}
        description={`${number(stay.points ?? 0)} points. They come off the room charges as a discount line, from 500 at a time.`}
        footer={<>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={busy || !Number.isInteger(n) || n < 500}
            onClick={() => void act(spendPoints(hotelId, stay.id, n, pressKey), `${money(n)} off the room charges`)}>
            Use {Number.isInteger(n) && n > 0 ? money(n) : "points"}
          </Button>
        </>}>
        <Field label="Points" hint="1 point is ₹1 off. The guest signs the bill.">
          {({ id }) => <Input id={id} inputMode="numeric" value={points} autoFocus
            onChange={(e) => setPoints(e.target.value.replace(/\D/g, ""))} />}
        </Field>
      </DialogContent>
    </Dialog>
  );
}

/* L5: as easy as joining; what is left lapses. */
function LeaveDialog({ hotelId, stay, onClose }: { hotelId: string; stay: LoyaltyStay; onClose: () => void }) {
  const { busy, act } = useAct(onClose);
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent size="sm" title={`${stay.name} leaves loyalty?`}
        description={`Their ${number(stay.points ?? 0)} points lapse. Their history stays with the bills.`}
        footer={<>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button variant="danger" disabled={busy}
            onClick={() => void act(leaveLoyalty(hotelId, stay.guestId), `${stay.name} left`)}>Leave</Button>
        </>}>
        <p className="text-sm text-grey-600">They can join again later, with no points.</p>
      </DialogContent>
    </Dialog>
  );
}

/* L1, L8: group settings with no default. Empty rate: nothing earns. */
function RulesCard({ hotelId, screen: s }: { hotelId: string; screen: LoyaltyScreen }) {
  const [name, setName] = useState(s.name ?? "");
  const [rate, setRate] = useState(s.pointsPer100 === null ? "" : String(s.pointsPer100));
  const { busy, act } = useAct(() => undefined);
  return (
    <Card>
      <CardHeader title="The rules" description="For every hotel of the group." />
      <CardBody className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Programme name" hint="The words a guest agrees to use it.">
            {({ id }) => <Input id={id} value={name} maxLength={40} onChange={(e) => setName(e.target.value)} />}
          </Field>
          <Field label="Points per ₹100" hint="Before GST. Empty: stays earn nothing.">
            {({ id }) => <Input id={id} inputMode="decimal" value={rate}
              onChange={(e) => setRate(e.target.value.replace(/[^\d.]/g, ""))} />}
          </Field>
        </div>
        <Button disabled={busy}
          onClick={() => void act(saveRules(hotelId, name, rate === "" ? null : Number(rate)), "Rules saved")}>
          Save the rules
        </Button>
      </CardBody>
    </Card>
  );
}

/* L18: in rupees, so the owner can settle between hotels. */
function ByHotelCard({ hotelId }: { hotelId: string }) {
  const [month, setMonth] = useState(() => isoDate(new Date()).slice(0, 7));
  const rows = useQuery({ queryKey: ["loyalty", "by-hotel", hotelId, month],
    queryFn: () => getByHotel(hotelId, month), enabled: /^\d{4}-\d{2}$/.test(month) });
  type Row = NonNullable<typeof rows.data>[number];
  const columns: Column<Row>[] = [
    { key: "hotel", header: "Hotel", cell: (r) => r.hotelName },
    { key: "earned", header: "Points earned", numeric: true, cell: (r) => <span className="tabular">{money(r.earned)}</span> },
    { key: "used", header: "Points used", numeric: true, cell: (r) => <span className="tabular">{money(r.used)}</span> },
  ];
  return (
    <Card>
      <CardHeader title="Points by hotel" description="Earned and used in the month, 1 point = ₹1."
        actions={<Input type="month" aria-label="Month" value={month} onChange={(e) => setMonth(e.target.value)} className="w-40" />} />
      <DataTable<Row> rows={rows.data ?? []} columns={columns} rowKey={(r) => r.hotelCode}
        loading={rows.isLoading} error={rows.error} onRetry={() => void rows.refetch()}
        className="border-0 rounded-t-none"
        empty={<EmptyState compact title="No points that month"
          description="Points earned or used at any hotel appear here." />} />
    </Card>
  );
}
