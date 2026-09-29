import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "react-router";
import { BedDouble, Check, Plus, UtensilsCrossed, Wrench } from "lucide-react";
import { useUi } from "@/lib/ui";
import {
  Page, PageHeader, Card, CardBody, Button, Skeleton, EmptyState, ErrorState, toast,
  Dialog, DialogContent, DialogClose, Field, fieldProps, Textarea, Input, NativeSelect,
  StatusPill, Segmented, IconChip,
} from "@/components/ui";
import {
  listRequests, raiseRequest, actOnRequest, type GuestRequest, type Team, type InHouse,
} from "@/modules/guest-services/data/requests";

/* ══════════════════════════════════════════════════════════════════
   GUEST REQUESTS (D27-178, the owner's D27-181)

   Towels, a broken tap, a pot of tea: raised by the desk or by the guest
   from their own page, done by the team it is for. Each is a work order
   that carries the stay, so "something broken" is also on Work orders.

   The desk sees every team's; a team sees its own (the server decides,
   and sends only those). Take it, then Done - or Done straight away.
   Closing something broken asks what was done; the other two close with
   one tap. No time targets (D27-181): how long each has waited, and how
   long each took.
   ══════════════════════════════════════════════════════════════════ */

export const TEAM_LABEL: Record<Team, string> = {
  housekeeping: "Housekeeping", maintenance: "Something broken", fnb: "Food and drink",
};
const TEAM_ICON = { housekeeping: BedDouble, maintenance: Wrench, fnb: UtensilsCrossed };

/** 12 min · 1 h 5 min · 2 d 3 h */
export const minutes = (m: number) =>
  m < 60 ? `${m} min`
    : m < 1440 ? `${Math.floor(m / 60)} h ${m % 60} min`
    : `${Math.floor(m / 1440)} d ${Math.floor((m % 1440) / 60)} h`;

type View = "open" | "done";

export default function RequestsPage() {
  const params = useParams();
  const fallback = useUi((s) => s.hotelId);
  const code = params["code"] ?? fallback;
  const qc = useQueryClient();
  const [view, setView] = useState<View>("open");
  const [team, setTeam] = useState<Team | "all">("all");
  const [raising, setRaising] = useState(false);
  const [closing, setClosing] = useState<{ r: GuestRequest; action: "done" | "cancel" } | null>(null);

  const list = useQuery({
    queryKey: ["guest-requests", code, view],
    queryFn: () => listRequests(code, view),
    /* The board's pace: a request is somebody waiting. */
    refetchInterval: 30_000,
  });
  const refresh = () => void qc.invalidateQueries({ queryKey: ["guest-requests", code] });

  const act = async (r: GuestRequest, action: "take" | "done") => {
    const res = await actOnRequest(code, r.id, action);
    if (!res.ok) return toast.error("Not changed", res.reason);
    refresh();
  };

  const teams = list.data?.teams ?? [];
  const shown = (list.data?.requests ?? []).filter((r) => team === "all" || r.team === team);

  return (
    <Page>
      <PageHeader
        title="Guest requests"
        description="What guests in house have asked for, and who is doing it."
        actions={
          <Button variant="primary" className="h-11" onClick={() => setRaising(true)}>
            <Plus className="size-4" /> New request
          </Button>
        }
      />

      <div className="mb-5 flex flex-wrap gap-3">
        <Segmented<View>
          value={view} onChange={setView}
          options={[{ value: "open", label: "Open" }, { value: "done", label: "Done, last 24 h" }]}
        />
        {teams.length > 1 && (
          /* On a phone the four do not fit: they scroll inside themselves,
             never the page (DESIGN.md, Breathing Room). */
          <div className="max-w-full overflow-x-auto">
            <Segmented<Team | "all">
              value={team} onChange={setTeam}
              options={[{ value: "all", label: "All" },
                ...teams.map((t) => ({ value: t, label: TEAM_LABEL[t] }))]}
            />
          </div>
        )}
      </div>

      {list.isLoading ? (
        <Skeleton className="h-64" />
      ) : list.error ? (
        <Card>
          <ErrorState title="Guest requests did not load" error={list.error}
                      onRetry={() => void list.refetch()} />
        </Card>
      ) : shown.length === 0 ? (
        <EmptyState
          title={view === "open" ? "Nothing waiting" : "Nothing done in the last 24 hours"}
          description={view === "open"
            ? "A request shows here when a guest asks on their own page, or when somebody raises one with New request."
            : "A request shows here once it is done or cancelled, with who did it and how long it took."}
        />
      ) : (
        <div className="space-y-3">
          {shown.map((r) => (
            <RequestCard key={r.id} r={r}
              onTake={() => void act(r, "take")}
              onDone={() => r.team === "maintenance"
                ? setClosing({ r, action: "done" }) : void act(r, "done")}
              onCancel={() => setClosing({ r, action: "cancel" })} />
          ))}
        </div>
      )}

      {raising && (
        <RaiseDialog code={code} rooms={list.data?.rooms ?? []}
                     onClose={() => setRaising(false)} onDone={refresh} />
      )}
      {closing && (
        <CloseDialog code={code} r={closing.r} action={closing.action}
                     onClose={() => setClosing(null)} onDone={refresh} />
      )}
    </Page>
  );
}

function RequestCard({ r, onTake, onDone, onCancel }: {
  r: GuestRequest; onTake: () => void; onDone: () => void; onCancel: () => void;
}) {
  const Icon = TEAM_ICON[r.team];
  const closed = r.status === "done" || r.status === "cancelled";
  return (
    <Card data-request={r.id}>
      <CardBody className="flex flex-wrap items-start gap-x-3.5 gap-y-3">
        <IconChip className="mt-px"><Icon /></IconChip>
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-2">
            <span className="text-base font-medium break-words">{r.what}</span>
            <StatusPill tone="neutral">{TEAM_LABEL[r.team]}</StatusPill>
            {r.status === "in_progress" && <StatusPill tone="info">Being done</StatusPill>}
            {r.status === "done" && <StatusPill tone="success">Done</StatusPill>}
            {r.status === "cancelled" && <StatusPill tone="neutral">Cancelled</StatusPill>}
          </p>
          {r.when && <p className="mt-0.5 text-sm text-grey-600">When: {r.when}</p>}
          <p className="mt-1 text-sm text-grey-500">
            {r.room ? `Room ${r.room}` : "-"}
            {r.guest ? ` · ${r.guest}` : ""}
            {r.fromGuest ? " · from the guest's page" : r.raisedBy ? ` · raised by ${r.raisedBy}` : ""}
            {closed
              ? ` · took ${minutes(r.minutes)}${r.takenBy
                  ? ` · ${r.status === "done" ? "done" : "taken"} by ${r.takenBy}` : ""}`
              : ` · waiting ${minutes(r.minutes)}${r.takenBy ? ` · ${r.takenBy} has it` : " · nobody has taken it"}`}
          </p>
          {closed && r.resolution && r.resolution !== "Done" && (
            <p className="mt-0.5 text-sm text-grey-600">{r.resolution}</p>
          )}
        </div>
        {!closed && (
          <div className="flex flex-wrap gap-2 w-full pl-[42px] sm:w-auto sm:pl-0 sm:shrink-0">
            {r.status === "open" && (
              <Button variant="secondary" className="h-11" onClick={onTake}>Take it</Button>
            )}
            <Button variant="secondary" className="h-11" onClick={onDone}>
              <Check className="size-4" /> Done
            </Button>
            <Button variant="ghost" className="h-11" onClick={onCancel}>Cancel it</Button>
          </div>
        )}
      </CardBody>
    </Card>
  );
}

function RaiseDialog({ code, rooms, onClose, onDone }: {
  code: string; rooms: InHouse[]; onClose: () => void; onDone: () => void;
}) {
  const [reservationId, setReservationId] = useState(rooms[0]?.reservationId ?? "");
  const [team, setTeam] = useState<Team>("housekeeping");
  const [what, setWhat] = useState("");
  const [when, setWhen] = useState("");
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    const res = await raiseRequest(code, { reservationId, team, what, when });
    setBusy(false);
    if (!res.ok) return toast.error("Not raised", res.reason);
    toast.success("Raised", `${TEAM_LABEL[team]}: ${what.trim()}`);
    onClose();
    onDone();
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent title="New request" description="For a guest in house now.">
        {rooms.length === 0 ? (
          <p className="text-sm text-grey-600">Nobody is checked in, so there is nobody to raise a request for.</p>
        ) : (
          <div className="space-y-4">
            <Field label="Room" required>
              {(f) => (
                <NativeSelect {...fieldProps(f)} value={reservationId}
                  onChange={(e) => setReservationId(e.target.value)}>
                  {rooms.map((r) => (
                    <option key={r.reservationId} value={r.reservationId}>
                      {r.guest ? `${r.room} · ${r.guest}` : r.room}
                    </option>
                  ))}
                </NativeSelect>
              )}
            </Field>
            {/* One a line on a phone, where three do not fit; three across above. */}
            <Segmented<Team>
              className="grid w-full sm:grid-cols-3"
              value={team} onChange={setTeam}
              options={(["housekeeping", "maintenance", "fnb"] as const)
                .map((t) => ({ value: t, label: TEAM_LABEL[t] }))}
            />
            <Field label="What is wanted" required>
              {(f) => (
                <Textarea {...fieldProps(f)} rows={3} maxLength={500} value={what} autoFocus
                  onChange={(e) => setWhat(e.target.value)} />
              )}
            </Field>
            <Field label="When" hint="Only if the guest said.">
              {(f) => (
                <Input {...fieldProps(f)} maxLength={100} value={when}
                  onChange={(e) => setWhen(e.target.value)} />
              )}
            </Field>
            <div className="flex gap-2">
              <DialogClose asChild>
                <Button variant="secondary" className="h-12 flex-1">Cancel</Button>
              </DialogClose>
              <Button variant="primary" className="h-12 flex-1"
                      disabled={busy || !reservationId || !what.trim()}
                      onClick={() => void save()}>
                Raise it
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/* Done on something broken (what was done), or Cancel on any (why). */
function CloseDialog({ code, r, action, onClose, onDone }: {
  code: string; r: GuestRequest; action: "done" | "cancel"; onClose: () => void; onDone: () => void;
}) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const finish = async () => {
    setBusy(true);
    const res = await actOnRequest(code, r.id, action, note.trim());
    setBusy(false);
    if (!res.ok) return toast.error("Not changed", res.reason);
    onClose();
    onDone();
  };
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent title={r.what} description={r.room ? `Room ${r.room}` : undefined}>
        <div className="space-y-4">
          <Field label={action === "done" ? "What was done" : "Why it is cancelled"} required
                 hint={action === "done" ? "The line somebody reads the next time this breaks." : undefined}>
            {(f) => (
              <Textarea {...fieldProps(f)} rows={3} value={note} autoFocus
                onChange={(e) => setNote(e.target.value)} />
            )}
          </Field>
          <div className="flex gap-2">
            <DialogClose asChild>
              <Button variant="secondary" className="h-12 flex-1">Back</Button>
            </DialogClose>
            <Button variant={action === "done" ? "primary" : "danger"} className="h-12 flex-1"
                    disabled={busy || !note.trim()} onClick={() => void finish()}>
              {action === "done" ? "Done" : "Cancel the request"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
