import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Button, Checkbox, Dialog, DialogContent, Field, Input, NativeSelect, StatusPill, Textarea, fieldProps, toast,
} from "@/components/ui";
import { can } from "@/lib/permissions";
import { useRole } from "@/lib/session";
import { getPreferences, listPreferences, savePreferences, type Preferences } from "@/modules/guests/data/preferences";
import { TEXTS } from "../../../../api/src/modules/guests/preferenceRules.ts";

/* ══════════════════════════════════════════════════════════════════
   A GUEST'S PREFERENCES (D27-383 item 10; built under D27-396)

   On the guest's own record, so they are the same at every hotel the
   record already is. Typed here by whoever may edit the guest (customer
   edit, the server's GUEST rule), or by the guest on their own page
   (online check-in's section, which draws `PreferenceFields` too).

   Shown where they help, each from this file through the front door:
     PreferenceMark      a small mark on the stay lists (StayTable) and
                         Assign room - "Allergy" in red, else "Preferences"
     GuestPreferences    the details, on the stay panel and Guest 360
     RoomPreferences     one line: the arriving guest's on the housekeeping
                         board, an in-house guest's food and allergy on the
                         restaurant's order

   ⚠ AN ALLERGY IS RED WHEREVER IT IS SHOWN, AND NO SETTING HIDES IT -
   the smoking choice is the only thing a hotel's set-up changes (offered
   only where it has a smoking room).
   ══════════════════════════════════════════════════════════════════ */

const FLOOR = { low: "A low floor", high: "A high floor" } as const;
const BED = { double: "A double bed", twin: "Twin beds" } as const;
const FOOD = { veg: "Vegetarian", jain: "Jain" } as const;

type Part = "room" | "food" | "all";

/** The preferences in words, the allergy left out (it is drawn red, apart). */
export function preferenceWords(p: Preferences, smokingOffered: boolean, part: Part = "all"): string[] {
  const room = part !== "food";
  const food = part !== "room";
  return [
    room && p.floor && FLOOR[p.floor],
    room && p.bed && BED[p.bed],
    room && p.quiet && "A quiet room",
    room && smokingOffered && p.smoking && "A smoking room",
    food && p.food && FOOD[p.food],
    room && p.pillow && `Pillow: ${p.pillow}`,
    room && p.newspaper && `Newspaper: ${p.newspaper}`,
    part === "all" && p.notes,
  ].filter((w): w is string => typeof w === "string" && w.length > 0);
}

/** The property's live stays with a preference, one request for every mark
    on a screen (shared by its query key). */
function useStayPreferences(hotelId: string) {
  return useQuery({
    queryKey: ["guest-preferences", hotelId],
    queryFn: () => listPreferences(hotelId),
    staleTime: 60_000,
    retry: false,
    enabled: Boolean(hotelId),
  });
}

/** The small mark: red "Allergy", else "Preferences" with the words as its
    title. Nothing when the guest has none. */
export function PreferenceMark({ hotelId, guestId }: { hotelId: string; guestId?: string | undefined }) {
  const list = useStayPreferences(hotelId);
  const found = guestId ? list.data?.stays.find((s) => s.guestId === guestId) : undefined;
  if (!found) return null;
  const p = found.preferences;
  const words = preferenceWords(p, list.data!.smokingOffered);
  if (!p.allergies && words.length === 0) return null;
  const title = [p.allergies && `Allergy: ${p.allergies}`, ...words].filter(Boolean).join(" · ");
  return (
    <span title={title} data-preference-mark className="inline-flex">
      <StatusPill tone={p.allergies ? "danger" : "neutral"}>
        {p.allergies ? "Allergy" : "Preferences"}
      </StatusPill>
    </span>
  );
}

/** One line for a room: the guest arriving in it today (housekeeping), or
    the one in it now (the till, food and allergy only). */
export function RoomPreferences({ hotelId, room, who }: {
  hotelId: string; room: string | null | undefined; who: "arriving" | "in-house";
}) {
  const list = useStayPreferences(hotelId);
  const key = room?.trim().toUpperCase();
  const found = key ? list.data?.stays.find((s) =>
    s.room?.toUpperCase() === key && (who === "arriving" ? s.arriving : s.inHouse)) : undefined;
  if (!found) return null;
  const p = found.preferences;
  const words = preferenceWords(p, list.data!.smokingOffered, who === "arriving" ? "room" : "food");
  if (!p.allergies && words.length === 0) return null;
  return (
    <p className="text-sm text-grey-600 mt-1" data-room-preferences={key}>
      <span className="text-grey-500">{who === "arriving" ? "Arriving guest: " : "Guest in this room: "}</span>
      {p.allergies && (
        <span className="font-semibold text-brand-red-700">Allergy: {p.allergies}{words.length ? " · " : ""}</span>
      )}
      {words.join(" · ")}
    </p>
  );
}

/** The details on the stay panel and Guest 360, with Edit preferences for
    whoever may edit the guest. */
export function GuestPreferences({ hotelId, guestId, editable = true }: {
  hotelId: string; guestId?: string | undefined;
  /** False inside another window (Assign room): read only there. */
  editable?: boolean;
}) {
  const role = useRole();
  const [open, setOpen] = useState(false);
  const q = useQuery({
    queryKey: ["guest-preferences", hotelId, guestId],
    queryFn: () => getPreferences(hotelId, guestId!),
    enabled: Boolean(guestId),
    retry: false,
  });
  if (!guestId || q.isLoading) return null;
  const mayEdit = editable && can(role, "edit", "customer");
  const p = q.data?.preferences ?? {};
  const words = q.data ? preferenceWords(p, q.data.smokingOffered) : [];
  /* Nothing to show and nothing this person may add: no section at all. */
  if (q.data && !mayEdit && !p.allergies && words.length === 0) return null;

  return (
    <section className="space-y-1.5" data-guest-preferences>
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-medium text-ink-900">Preferences</h3>
        {mayEdit && q.data && (
          <Button size="sm" variant="secondary" className="ml-auto" onClick={() => setOpen(true)}>
            Edit preferences
          </Button>
        )}
      </div>
      {q.isError ? (
        <p className="text-sm text-brand-red-700">The guest's preferences could not be read.</p>
      ) : (
        <>
          {p.allergies && (
            <p className="text-base font-semibold text-brand-red-700" data-allergy>Allergy: {p.allergies}</p>
          )}
          {words.length > 0 ? (
            <p className="text-base text-ink-900">{words.join(" · ")}</p>
          ) : !p.allergies && (
            <p className="text-sm text-grey-600">None recorded. They are kept on the guest's record, for every stay.</p>
          )}
        </>
      )}
      {open && q.data && (
        <PreferencesDialog hotelId={hotelId} guestId={guestId} was={p}
          smokingOffered={q.data.smokingOffered} onClose={() => setOpen(false)} />
      )}
    </section>
  );
}

function PreferencesDialog({ hotelId, guestId, was, smokingOffered, onClose }: {
  hotelId: string; guestId: string; was: Preferences; smokingOffered: boolean; onClose: () => void;
}) {
  const qc = useQueryClient();
  const [value, setValue] = useState<Preferences>(was);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    const done = await savePreferences(hotelId, guestId, value);
    setBusy(false);
    if (!done.ok) return toast.error("Not saved", done.reason);
    void qc.invalidateQueries({ queryKey: ["guest-preferences", hotelId] });
    toast.success("Preferences saved", "On the guest's record, for every stay of theirs.");
    onClose();
  };
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent title="Preferences"
        description="What the guest likes. Kept on their record: the same on every booking of theirs."
        footer={
          <div className="flex gap-2 w-full justify-end">
            <Button variant="secondary" size="lg" onClick={onClose}>Cancel</Button>
            <Button variant="primary" size="lg" loading={busy} onClick={() => void save()}>Save</Button>
          </div>
        }>
        <PreferenceFields value={value} onChange={setValue} smokingOffered={smokingOffered} />
      </DialogContent>
    </Dialog>
  );
}

/** The form, for the desk's dialog and the guest's own page. */
export function PreferenceFields({ value, onChange, smokingOffered }: {
  value: Preferences; onChange: (p: Preferences) => void; smokingOffered: boolean;
}) {
  const set = <K extends keyof Preferences>(k: K, v: Preferences[K] | "" | false | undefined) => {
    const next = { ...value };
    if (v === "" || v === false || v === undefined) delete next[k]; else next[k] = v as Preferences[K];
    onChange(next);
  };
  const choice = <K extends "floor" | "bed" | "food">(k: K, label: string, words: Record<string, string>) => (
    <Field label={label}>
      {(f) => (
        <NativeSelect {...fieldProps(f)} value={value[k] ?? ""}
          onChange={(e) => set(k, e.target.value as Preferences[K] | "")}>
          <option value="">No preference</option>
          {Object.entries(words).map(([v, w]) => <option key={v} value={v}>{w}</option>)}
        </NativeSelect>
      )}
    </Field>
  );
  const text = (k: keyof typeof TEXTS, label: string, hint?: string) => (
    <Field label={label} {...(hint ? { hint } : {})}>
      {(f) => (
        <Input {...fieldProps(f)} value={value[k] ?? ""} maxLength={TEXTS[k]}
          onChange={(e) => set(k, e.target.value)} />
      )}
    </Field>
  );
  return (
    <div className="space-y-4" data-preference-fields>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {choice("floor", "Floor", FLOOR)}
        {choice("bed", "Bed", BED)}
      </div>
      <div className="flex flex-wrap gap-x-6 gap-y-2">
        <Checkbox checked={value.quiet === true} onCheckedChange={(v) => set("quiet", v || undefined)}
          label="A quiet room" />
        {/* Never offered where the hotel has no smoking room (D27-396). */}
        {smokingOffered && (
          <Checkbox checked={value.smoking === true} onCheckedChange={(v) => set("smoking", v || undefined)}
            label="A smoking room" />
        )}
      </div>
      {choice("food", "Food", FOOD)}
      {text("allergies", "Allergies", "Shown in red to the desk, housekeeping and the restaurant.")}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {text("pillow", "Pillow", "Soft, firm, an extra one.")}
        {text("newspaper", "Newspaper")}
      </div>
      <Field label="Other notes">
        {(f) => (
          <Textarea {...fieldProps(f)} rows={2} value={value.notes ?? ""} maxLength={TEXTS.notes}
            onChange={(e) => set("notes", e.target.value)} />
        )}
      </Field>
    </div>
  );
}
