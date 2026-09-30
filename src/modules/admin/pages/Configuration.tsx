import { useParams } from "react-router";
import { useUi } from "@/lib/ui";
import { Page, PageHeader } from "@/components/ui";
import { CommissioningCard } from "@/modules/admin/flows/CommissioningCard";
import { FrontDeskCard } from "@/modules/inventory";
import { TaxRulesCard } from "@/modules/finance";

/* ══════════════════════════════════════════════════════════════════
   CONFIGURATION — the hotel-wide settings (D27-188, D27-194)

   System › Administration › Configuration, for the owner, an Admin and
   the GM. What the property still needs, first, because a property
   that cannot take a booking should say so before anything else; then
   the front desk's hours and charges (inventory's form); then GST and
   VAT (finance's card, which the till reads too). Room types was their
   home until 30 September and is now just the list of room types. The
   accountant keeps the tax card on Invoices.
   ══════════════════════════════════════════════════════════════════ */
export default function ConfigurationPage() {
  const params = useParams();
  const fallback = useUi((s) => s.hotelId);
  const hotelId = params["code"] ?? fallback;

  return (
    <Page className="max-w-6xl">
      <PageHeader
        title="Configuration"
        description="This property's hotel-wide settings: its hours, its charges and its taxes."
      />
      {/* The page's sections, 20px apart (the Rhythm Rule). The first
          card removes itself once everything is settled. */}
      <div className="flex flex-col gap-5">
        <CommissioningCard hotelId={hotelId} />
        <FrontDeskCard hotelId={hotelId} />
        <TaxRulesCard hotelId={hotelId} />
      </div>
    </Page>
  );
}
