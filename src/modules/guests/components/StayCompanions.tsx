import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Dialog, DialogContent, Field, Input, StatusPill, fieldProps, toast } from "@/components/ui";
import { can } from "@/lib/permissions";
import { useCurrentHotel, useRole } from "@/lib/session";
import {
  addCompanion, getCompanions, removeCompanion, saveCompanion, type Companion,
} from "@/modules/guests/data/companions";
import { ID_TYPES, particularsPayload, sameVisit, type Particulars } from "./ForeignGuestFields";
import { GuestIdFields, deskGuestId, guestIdState, noGuestId, type GuestId } from "./GuestIdFields";

/* ══════════════════════════════════════════════════════════════════
   EVERY ADULT IN THE ROOM (the owner's D27-382, GUE-6)

   One block, on the check-in window, the stay panel and a walk-in's card.
   Each person is saved on their own, the moment Save is pressed: the
   check-in's own call knows nothing of them, so it can never be held up
   by one, and a missing person is a warning, here and on the register.

   Who: the people who record a guest's ID (customer:edit, D25-38). The
   block draws nothing for anybody else, and the server refuses them.
   ══════════════════════════════════════════════════════════════════ */

const idWord = new Map<string, string>(ID_TYPES);

export const peopleWords = (adults: number, recorded: number) =>
  `${adults} adult${adults === 1 ? "" : "s"}, ${recorded} recorded`;

export function StayCompanions({ hotelId, stayId, today, adults, leadAnswers }: {
  hotelId: string;
  stayId: string;
  /** The hotel's business date: a birth date cannot be after it. */
  today: string;
  /** The party as the check-in window has it, before it is saved. */
  adults?: number;
  /** The lead's answers as the check-in window has them, before they are saved. */
  leadAnswers?: Particulars;
}) {
  const may = can(useRole(), "edit", "customer");
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["companions", hotelId, stayId],
    queryFn: () => getCompanions(hotelId, stayId),
    enabled: may,
  });
  const [editing, setEditing] = useState<Companion | "new" | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  if (!may || !q.data?.companions) return null;

  const { recorded, lead, leadNationality, open, companions } = q.data;
  const expected = adults ?? q.data.adults;
  const remove = async (c: Companion) => {
    const r = await removeCompanion(hotelId, stayId, c.guestId);
    setRemoving(null);
    if (!r.ok) return toast.error("Not removed", r.reason);
    toast.success("Removed", `${c.name} is off this stay, with their ID.`);
    void qc.invalidateQueries();
  };

  return (
    <section className="space-y-2" data-stay-companions>
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-medium text-ink-900">Adults in the room</h3>
        <StatusPill tone={recorded < expected ? "warning" : "neutral"}>
          {peopleWords(expected, recorded)}
        </StatusPill>
        {open && (
          <Button size="sm" variant="secondary" className="ml-auto" onClick={() => setEditing("new")}>
            Add an adult
          </Button>
        )}
      </div>
      <ul className="divide-y divide-grey-100">
        <li className="py-2 text-base text-ink-900">
          {lead} <span className="text-sm text-grey-600">· the guest on the booking</span>
        </li>
        {companions.map((c) => (
          <li key={c.guestId} className="py-2 flex flex-wrap items-center gap-x-3 gap-y-1">
            <div className="min-w-0">
              <p className="text-base text-ink-900">{c.name}</p>
              <p className="text-sm text-grey-600 tabular">
                {c.nationality} ·{" "}
                {c.idNumber
                  ? `${idWord.get(c.idType ?? "") ?? "ID"} ${c.idNumber}`
                  : <span className="text-warning-dark">ID not recorded</span>}
              </p>
            </div>
            {c.filed ? (
              /* Rule 6: said, not hidden. */
              <p className="ml-auto text-sm text-grey-600">Form III filed: corrected on the register.</p>
            ) : removing === c.guestId ? (
              <div className="ml-auto flex items-center gap-1.5">
                <span className="text-sm text-grey-600">Remove them and their ID?</span>
                <Button size="sm" variant="secondary" onClick={() => setRemoving(null)}>Keep</Button>
                <Button size="sm" variant="danger" onClick={() => void remove(c)}>Remove</Button>
              </div>
            ) : open && (
              <div className="ml-auto flex items-center gap-1.5">
                <Button size="sm" variant="secondary" aria-label={`Edit ${c.name}`} onClick={() => setEditing(c)}>
                  Edit
                </Button>
                <Button size="sm" variant="ghost" aria-label={`Remove ${c.name}`} onClick={() => setRemoving(c.guestId)}>
                  Remove
                </Button>
              </div>
            )}
          </li>
        ))}
      </ul>
      {editing && (
        <CompanionDialog hotelId={hotelId} stayId={stayId} today={today}
          person={editing === "new" ? null : editing} nationality={leadNationality}
          leadVisit={leadAnswers ?? q.data.leadVisit ?? {}}
          onClose={() => setEditing(null)} />
      )}
    </section>
  );
}

const NOT_ANSWERS = new Set(["guestId", "name", "nationality", "idType", "idNumber", "filed"]);

function CompanionDialog({ hotelId, stayId, today, person, nationality, leadVisit, onClose }: {
  hotelId: string; stayId: string; today: string; person: Companion | null;
  /** The lead guest's: where a party usually comes from, and it can be changed. */
  nationality: string; leadVisit: Record<string, string | null | undefined>; onClose: () => void;
}) {
  const qc = useQueryClient();
  const rules = useCurrentHotel()?.deskRules;
  const [name, setName] = useState(person?.name ?? "");
  /* EDIT STARTS WITH THE DOCUMENT EMPTY: an Aadhaar comes back masked, and
     what is on record is said above. Typing one replaces it. */
  const [id, setId] = useState<GuestId>(() => (person ? {
    ...noGuestId(person.nationality),
    particulars: Object.fromEntries(Object.entries(person)
      .filter(([k, v]) => !NOT_ANSWERS.has(k) && typeof v === "string")) as Record<string, string>,
  } : deskGuestId(rules, nationality)));
  const [busy, setBusy] = useState(false);

  const s = guestIdState(id, today);
  const wrong = !name.trim() ? "A guest has a name." : s.wrong;

  const save = async () => {
    const p = particularsPayload(id.particulars);
    const input = {
      fullName: name.trim(), nationality: id.nationality,
      identity: { ...p.identity, ...(s.captured ? { idType: id.idType, idNumber: id.idNumber.trim() } : {}) },
      ...(s.foreign ? { visit: p.visit } : {}),
    };
    setBusy(true);
    const r = person
      ? await saveCompanion(hotelId, stayId, person.guestId, input)
      : await addCompanion(hotelId, stayId, input);
    setBusy(false);
    if (!r.ok) return toast.error("Not saved", r.reason);
    toast.success(person ? "Saved" : "Added", name.trim());
    void qc.invalidateQueries();
    onClose();
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent size="lg" title={person ? `Edit ${person.name}` : "Add an adult"}
        description="Their own name and ID, as on the document. Saved on the stay at once; nothing here holds up the check-in."
        footer={
          <div className="flex gap-2 w-full justify-end">
            <Button variant="secondary" size="lg" onClick={onClose}>Cancel</Button>
            <Button variant="primary" size="lg" loading={busy} disabled={wrong !== null} onClick={() => void save()}>
              Save
            </Button>
          </div>
        }>
        <div className="space-y-4">
          <Field label="Full name" required>
            {(f) => <Input {...fieldProps(f)} value={name} onChange={(e) => setName(e.target.value)} />}
          </Field>
          {person?.idNumber && (
            <p className="text-sm text-grey-600" data-companion-on-record>
              On record: {idWord.get(person.idType ?? "") ?? "ID"} {person.idNumber}. Fill in the document only to replace it.
            </p>
          )}
          <GuestIdFields value={id} onChange={setId} today={today} companion />
          {/* D27-386: a family's visit is one visit; the boxes stay theirs to change. */}
          {s.foreign && Object.keys(sameVisit({}, leadVisit)).length > 0 && (
            <Button variant="secondary" size="sm"
              onClick={() => setId({ ...id, particulars: sameVisit(id.particulars, leadVisit) })}>
              Same as the guest
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
