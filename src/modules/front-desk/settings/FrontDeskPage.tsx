import { Card, NativeSelect, Page, PageHeader, Segmented, Switch, toast } from "@/components/ui";
import { useUi } from "@/lib/ui";
import { useSession } from "@/lib/session";
import { saveDeskSettings } from "@/modules/front-desk/data/lists";
import { FrontDeskRulesCard } from "@/modules/front-desk/components/FrontDeskRules";
import { Explain, refreshHotels } from "./ListEditor";

/* ══════════════════════════════════════════════════════════════════
   SETTINGS › FRONT DESK (the owner's D27-243 and D27-260)

   Phase 3's rules card, then phase 5's: how a booking starts, what it must
   carry, the housekeeping switches, the restaurant's round-off, and how
   the figures count - each a plain sentence and its switch. Each starts on
   what the PMS did before.
   ══════════════════════════════════════════════════════════════════ */

const FIELDS: Array<[string, string]> = [
  ["phone", "Phone"], ["email", "Email"], ["nationality", "Nationality"], ["address", "Address"],
  ["expectedArrival", "Expected arrival time"], ["marketSegment", "Market segment"],
  ["businessSource", "Business source"], ["salesPerson", "Sales person"],
];

function Section({ title, why, children }: { title: string; why: string; children: React.ReactNode }) {
  return (
    <Card className="p-4 space-y-3">
      <div>
        <h2 className="text-md font-semibold text-ink-900">{title}</h2>
        <p className="text-sm text-grey-600 mt-0.5">{why}</p>
      </div>
      {children}
    </Card>
  );
}

export default function FrontDeskPage() {
  const hotelId = useUi((s) => s.hotelId) ?? "";
  const r = useSession((s) => s.hotels.find((h) => h.code === hotelId || h.id === hotelId))?.deskRules;
  const save = async (change: object) => {
    const res = await saveDeskSettings(hotelId, change);
    if (!res.ok) return toast.error("Not saved", res.reason);
    await refreshHotels();
  };
  if (!r) return <Page><PageHeader title="Front desk rules" /></Page>;

  return (
    <Page>
      <PageHeader title="Front desk rules" />
      <Explain>What the desk's screens start on and what they allow, at this hotel.</Explain>
      <div className="space-y-3" data-desk-settings>
        <FrontDeskRulesCard hotelId={hotelId} />

        <Section title="A new booking starts as"
          why="New booking opens on these; the desk can still change them on each booking.">
          <div className="flex flex-wrap gap-4">
            <Segmented value={r.defaultGuarantee} onChange={(v) => void save({ defaultGuarantee: v })}
              options={[{ value: "confirmed", label: "Confirmed" }, { value: "tentative", label: "Tentative" }]} />
            <Segmented value={r.defaultBillTo} onChange={(v) => void save({ defaultBillTo: v })}
              options={[{ value: "guest", label: "Billed to the guest" }, { value: "company", label: "Billed to a company" }]} />
          </div>
        </Section>

        <Section title="A booking must carry"
          why="New booking will not save without these; a booking from a booking site is never held for them.">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {FIELDS.map(([k, l]) => (
              <label key={k} className="flex items-center gap-2 text-base text-ink-900 cursor-pointer">
                <input type="checkbox" className="size-4 accent-brand-orange"
                  checked={r.requiredBookingFields.includes(k)}
                  onChange={(e) => void save({ requiredBookingFields: e.target.checked
                    ? [...r.requiredBookingFields, k] : r.requiredBookingFields.filter((x) => x !== k) })} />
                {l}
              </label>
            ))}
          </div>
        </Section>

        <Section title="Housekeeping"
          why="A room a guest leaves at check-out is always sent for cleaning. These decide the rest.">
          <Switch checked={r.hkDirtyAfterMove} onCheckedChange={(v) => void save({ hkDirtyAfterMove: v })}
            label="A room a guest moved out of is sent for cleaning" />
          <Switch checked={r.hkDirtyAfterUnblock} onCheckedChange={(v) => void save({ hkDirtyAfterUnblock: v })}
            label="A room back from a block is sent for cleaning"
            description="Off: it comes back as it was before the block." />
          <Switch checked={r.hkStayoverDirtyAtAudit} onCheckedChange={(v) => void save({ hkStayoverDirtyAtAudit: v })}
            label="The night audit sends every room with a guest staying on for its daily clean" />
        </Section>

        {/* D27-344: the tax invoice at check-out, and its copies. */}
        <Section title="The tax invoice at check-out"
          why="What Check out does with the guest's tax invoice. Two copies print as ORIGINAL FOR RECIPIENT and DUPLICATE FOR SUPPLIER, as GST asks for a service's invoice.">
          <div className="flex flex-wrap gap-4" data-invoice-at-checkout>
            <NativeSelect value={r.invoiceAtCheckout ?? "print"} aria-label="The tax invoice at check-out"
              className="max-w-sm" onChange={(e) => void save({ invoiceAtCheckout: e.target.value })}>
              <option value="print">Issue it and print it, by itself</option>
              <option value="offer">Offer an Issue tax invoice button</option>
              <option value="invoices">Nothing at check-out: issue it on Invoices</option>
            </NativeSelect>
            <Segmented value={String(r.invoiceCopies ?? 2)} onChange={(v) => void save({ invoiceCopies: Number(v) })}
              options={[{ value: "2", label: "2 copies" }, { value: "1", label: "1 copy" }]} />
          </div>
        </Section>

        <Section title="The restaurant's round-off"
          why="A restaurant bill paid in cash is always taken to the rupee, as the drawer counts rupees. Room bills and invoices are never rounded.">
          <NativeSelect value={r.posRoundOff} aria-label="The restaurant's round-off" className="max-w-xs"
            onChange={(e) => void save({ posRoundOff: e.target.value })}>
            <option value="manual">Manual: the Round off button</option>
            <option value="automatic">Automatic: every bill paid there, to ₹1</option>
            <option value="off">Off: no Round off button</option>
          </NativeSelect>
        </Section>

        <Section title="How the figures count"
          why="Occupancy = rooms sold ÷ rooms available. ADR (average daily rate) = room revenue ÷ rooms sold. RevPAR = room revenue ÷ rooms available. Rooms available leave out rooms blocked that night.">
          <p className="text-sm text-grey-600">
            For example, 40 rooms available, 30 sold and ₹90,000 room revenue: occupancy 75%,
            ADR ₹3,000, RevPAR ₹2,250.
          </p>
          <Switch checked={r.kpiCompAsSold} onCheckedChange={(v) => void save({ kpiCompAsSold: v })}
            label="A complimentary room counts as sold"
            description="On, as the owner's eZee reports count it." />
          <Switch checked={r.kpiDayUseHalf} onCheckedChange={(v) => void save({ kpiDayUseHalf: v })}
            label="A day use counts as half a room sold"
            description="Off: a day use is not a room sold; it has its own line." />
        </Section>
      </div>
    </Page>
  );
}
