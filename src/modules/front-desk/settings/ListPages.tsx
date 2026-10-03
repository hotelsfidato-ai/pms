import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import {
  Button, Card, Input, Page, PageHeader, Skeleton, Tabs, TabsContent, TabsList, TabsTrigger, toast,
} from "@/components/ui";
import { useUi } from "@/lib/ui";
import { useSession } from "@/lib/session";
import {
  listOf, addToList, changeListItem, removeListItem, vipLevels, addVipLevel, changeVipLevel,
  removeVipLevel, addHoliday, removeHoliday, holidaysOf, saveDeskSettings, type ListKind,
} from "@/modules/front-desk/data/lists";
import { ListEditor, Explain, refreshHotels, type ListCalls } from "./ListEditor";

/* ══════════════════════════════════════════════════════════════════
   SETTINGS › LISTS (phase 5 of the settings plan, the owner's D27-260)
   Each page is the list pattern; the hotel is the top bar's.
   ══════════════════════════════════════════════════════════════════ */

const useHotel = () => useUi((s) => s.hotelId) ?? "";
const hotelListCalls = (hotelId: string, kind: ListKind): ListCalls => ({
  key: ["lists", hotelId, kind],
  read: () => listOf(hotelId, kind),
  add: (item) => addToList(hotelId, kind, item),
  change: (id, change) => changeListItem(hotelId, kind, id, change),
  remove: (id) => removeListItem(hotelId, kind, id),
});

export function MarketSegmentsPage() {
  const hotelId = useHotel();
  return (
    <Page>
      <PageHeader title="Market segments" />
      <Explain>
        Who the guest is, for the reports: offered on New booking. A booking keeps its segment's
        words even if the segment is renamed or switched Off later; one a booking uses cannot be
        deleted, only switched Off.
      </Explain>
      <ListEditor calls={hotelListCalls(hotelId, "market_segment")} noun="segment" />
    </Page>
  );
}

const REASON_TABS: Array<[ListKind, string, string]> = [
  ["reason_block", "Block", "Taking a room out of service: offered under its note."],
  ["reason_cancel", "Cancel", "Cancelling a booking: offered under \"Why\"."],
  ["reason_void", "Void", "Voiding a booking entered by mistake."],
  ["reason_correction", "Bill correction", "Changing or reversing a line on a bill."],
];

export function ReasonsPage() {
  const hotelId = useHotel();
  return (
    <Page>
      <PageHeader title="Ready reasons" />
      <Explain>
        Reasons the desk taps instead of typing. One tapped fills the reason box; typing your own
        still works, and the reason is kept exactly as it was written.
      </Explain>
      <Tabs defaultValue="reason_block">
        <TabsList>
          {REASON_TABS.map(([k, l]) => <TabsTrigger key={k} value={k}>{l}</TabsTrigger>)}
        </TabsList>
        {REASON_TABS.map(([k, , why]) => (
          <TabsContent key={k} value={k} className="pt-3">
            <Explain>{why}</Explain>
            <ListEditor calls={hotelListCalls(hotelId, k)} noun="reason" />
          </TabsContent>
        ))}
      </Tabs>
    </Page>
  );
}

export function VipLevelsPage() {
  const hotelId = useHotel();
  const calls: ListCalls = {
    key: ["vip-levels", hotelId],
    read: () => vipLevels(hotelId),
    add: (item) => addVipLevel(hotelId, item),
    change: (id, change) => changeVipLevel(hotelId, id, change),
    remove: (id) => removeVipLevel(hotelId, id),
  };
  return (
    <Page>
      <PageHeader title="VIP levels" />
      <Explain>
        One list for the whole group, because a guest is one record at every hotel: marking a
        guest VIP asks which level, and the level travels with them. Only the owner or an
        administrator changes it.
      </Explain>
      <ListEditor calls={calls} noun="level" withColour />
    </Page>
  );
}

export function HolidaysPage() {
  const hotelId = useHotel();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["holidays", hotelId], queryFn: () => holidaysOf(hotelId) });
  const [day, setDay] = useState("");
  const [name, setName] = useState("");
  const [colour, setColour] = useState("#FFF4DC");
  const after = async (r: { ok: boolean; reason?: string }, what: string) => {
    if (!r.ok) return toast.error(`Not ${what}`, r.reason), false;
    void qc.invalidateQueries({ queryKey: ["holidays", hotelId] });
    await refreshHotels();
    return true;
  };
  return (
    <Page>
      <PageHeader title="Holidays" />
      <Explain>
        Days the Calendar and Rates shade like a weekend, with the holiday's name on the Calendar.
        No price reads them.
      </Explain>
      <Card className="p-0 overflow-hidden" data-holidays>
        <form className="flex flex-wrap items-center gap-2 p-3 border-b border-grey-200"
          onSubmit={async (e) => {
            e.preventDefault();
            if (await after(await addHoliday(hotelId, { day, name: name.trim(), colour }), "added")) {
              setDay(""); setName("");
            }
          }}>
          <Input type="date" value={day} onChange={(e) => setDay(e.target.value)} aria-label="Day" className="w-40" />
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Diwali"
            aria-label="Name" className="flex-1 min-w-32" />
          <input type="color" value={colour} onChange={(e) => setColour(e.target.value.toUpperCase())}
            aria-label="Colour" className="size-9 rounded border border-grey-200 bg-white p-0.5" />
          <Button type="submit" variant="primary" disabled={!day || !name.trim()}>Add</Button>
        </form>
        {q.isLoading ? <Skeleton className="h-16 m-3" /> : (q.data ?? []).length === 0 ? (
          <p className="p-4 text-sm text-grey-500">No holidays yet.</p>
        ) : (
          <ul>
            {(q.data ?? []).map((h) => (
              <li key={h.id} className="flex items-center gap-3 px-3 py-2 border-b border-grey-100 last:border-b-0">
                <span className="size-4 rounded" style={{ backgroundColor: h.colour ?? "#E2E5E8" }} />
                <span className="w-28 tabular text-sm text-grey-600">{h.day}</span>
                <span className="flex-1 min-w-0 truncate text-base text-ink-900">{h.name}</span>
                <button type="button" aria-label={`Delete ${h.name}`}
                  onClick={async () => after(await removeHoliday(hotelId, h.id), "deleted")}
                  className="p-1.5 rounded text-grey-400 hover:text-brand-red-700">
                  <Trash2 className="size-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </Page>
  );
}

const ID_TYPES: Array<[string, string]> = [
  ["aadhaar", "Aadhaar"], ["passport", "Passport"], ["driving_licence", "Driving licence"],
  ["voter", "Voter ID"], ["other", "Other"],
];

export function IdTypesPage() {
  const hotelId = useHotel();
  const hotel = useSession((s) => s.hotels.find((h) => h.code === hotelId || h.id === hotelId));
  const off = hotel?.deskRules?.idTypesOff ?? [];
  const set = async (type: string, on: boolean) => {
    const next = on ? off.filter((t) => t !== type) : [...off, type];
    const r = await saveDeskSettings(hotelId, { idTypesOff: next });
    if (!r.ok) return toast.error("Not changed", r.reason);
    await refreshHotels();
  };
  return (
    <Page>
      <PageHeader title="ID types" />
      <Explain>
        The documents this hotel takes. One switched Off leaves the check-in, New booking and the
        guest's online form; a document already recorded stays as it was.
      </Explain>
      <Card className="p-0 overflow-hidden" data-id-types>
        <ul>
          {ID_TYPES.map(([v, l]) => (
            <li key={v} className="flex items-center gap-3 px-3 py-2.5 border-b border-grey-100 last:border-b-0">
              <span className="flex-1 text-base text-ink-900">{l}</span>
              <input type="checkbox" role="switch" aria-label={`${l} on`} checked={!off.includes(v)}
                onChange={(e) => void set(v, e.target.checked)} className="size-4 accent-brand-orange cursor-pointer" />
            </li>
          ))}
        </ul>
      </Card>
    </Page>
  );
}

/* Today's booking states, as the Calendar draws them (D27-260 Q6: colours only). */
const STATES: Array<[string, string, string]> = [
  ["confirmed", "Confirmed", "#E6F0FA"], ["waiting", "Tentative (waiting for the hotel)", "#EEF0F2"],
  ["in-house", "In house", "#1F6FB2"], ["due-out", "Due out", "#F6C445"],
  ["departed", "Checked out", "#EEF0F2"], ["no-show", "No-show", "#9F2F4F"],
];

export function ReservationTypesPage() {
  const hotelId = useHotel();
  const hotel = useSession((s) => s.hotels.find((h) => h.code === hotelId || h.id === hotelId));
  const colours = hotel?.deskRules?.statusColours ?? {};
  const save = async (next: Record<string, string> | null) => {
    const r = await saveDeskSettings(hotelId, { statusColours: next });
    if (!r.ok) return toast.error("Not changed", r.reason);
    await refreshHotels();
  };
  return (
    <Page>
      <PageHeader title="Reservation types"
        actions={<Button variant="secondary" onClick={() => void save(null)}>Back to the built-in colours</Button>} />
      <Explain>
        The colour of each kind of booking on the Calendar. These are the states a booking can be
        in today; more kinds of hold would change how bookings work, and are for later.
      </Explain>
      <Card className="p-0 overflow-hidden" data-reservation-types>
        <ul>
          {STATES.map(([k, l, built]) => (
            <li key={k} className="flex items-center gap-3 px-3 py-2.5 border-b border-grey-100 last:border-b-0">
              <input type="color" aria-label={`Colour of ${l}`} value={colours[k] ?? built}
                onChange={(e) => void save({ ...colours, [k]: e.target.value.toUpperCase() })}
                className="size-8 rounded border border-grey-200 bg-white p-0.5 cursor-pointer" />
              <span className="flex-1 text-base text-ink-900">{l}</span>
              <span className="text-sm text-grey-500">{colours[k] ? "Chosen" : "Built in"}</span>
            </li>
          ))}
        </ul>
      </Card>
    </Page>
  );
}
