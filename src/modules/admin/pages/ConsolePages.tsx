import { useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useUi } from "@/lib/ui";
import { useRole, useSession } from "@/lib/session";
import { useDocumentIdentity } from "@/lib/documentIdentity";
import {
  Page, PageHeader, Card, CardBody, CardHeader, Button, Skeleton,
} from "@/components/ui";
import { getPropertyDetail, PROPERTY_TYPES } from "@/modules/admin/data/admin";
import { switchesModules } from "@/modules/admin/moduleSwitchRoles";
import { GroupCard, HotelLogoCard } from "@/modules/admin/components/GroupCard";
import { HotelGalleryCard } from "@/modules/admin/components/HotelGalleryCard";
import { SigningIn } from "@/modules/admin/components/SigningIn";
import { BankDetailsCard, HousePoliciesCard } from "@/modules/admin/components/VoucherSettings";
import { ModulesCard, BOOKING_SECTION, SettingRow, SettingValues } from "@/modules/admin/pages/Admin";
import { CommissioningCard } from "@/modules/admin/flows/CommissioningCard";
import { EditPropertyDialog } from "@/modules/admin/pages/Properties";
import { FssaiCard } from "@/modules/admin/pages/Property";
import { FrontDeskCard } from "@/modules/inventory";
import { FrontDeskRulesCard } from "@/modules/front-desk";
import { TaxRulesCard } from "@/modules/finance";

/* ══════════════════════════════════════════════════════════════════
   THE CONSOLE'S STAND-IN PAGES (D27-249): Settings' five tabs of
   D27-220, a page per subject, the same cards. Registered in
   console.settings.ts; a phase's own page at the same address replaces one.
   The hotel is the top bar's.
   ══════════════════════════════════════════════════════════════════ */

function ConsolePage({ title, children }: { title: string; children: ReactNode }) {
  const { property } = useDocumentIdentity();
  return (
    <Page className="max-w-6xl">
      <PageHeader title={title} {...(property ? { description: property } : {})} />
      <div className="flex flex-col gap-3">{children}</div>
    </Page>
  );
}

const useHotel = () => useUi((s) => s.hotelId);

function useProperty(hotelId: string) {
  return useQuery({
    queryKey: ["property-detail", hotelId],
    queryFn: () => getPropertyDetail(hotelId),
    enabled: Boolean(hotelId),
  });
}

/* The hotel's own details, grouped the way the edit form asks: who, where,
   how to reach, the tax numbers. A long value takes two cells. */
export function ProfileSettings() {
  const hotelId = useHotel();
  const qc = useQueryClient();
  const groupAdmin = useSession((s) => s.scope?.isGroupAdmin === true);
  const [editing, setEditing] = useState(false);
  const q = useProperty(hotelId);
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["property-detail", hotelId] });
    void qc.invalidateQueries({ queryKey: ["commissioning", hotelId] });
  };
  const p = q.data?.property;
  const type = PROPERTY_TYPES.find(([word]) => word === p?.propertyType)?.[1];

  return (
    <ConsolePage title="Profile">
      {/* What the property still needs, drawn only while something is: on
          the console's first page, as it was above Settings' tabs. */}
      <CommissioningCard hotelId={hotelId} />
      {q.isLoading && <Skeleton className="h-64 w-full" />}
      {p && (
        <>
          <Card>
            <CardHeader title="Profile" description="The name, address, GSTIN, phone and email print on this property's invoices."
              actions={<Button variant="secondary" onClick={() => setEditing(true)}>Edit</Button>} />
            <CardBody>
              <SettingValues>
                <SettingRow wide label="Name" value={p.name} />
                <SettingRow label="Property type" value={type ?? "-"} />
                <SettingRow label="Stars" value={p.starRating?.toString() ?? "-"} />
                <SettingRow wide label="Address" value={p.addressLine ?? "-"} />
                <SettingRow wide label="Address line 2" value={p.addressLine2 ?? "-"} />
                <SettingRow label="City" value={p.city ?? "-"} />
                <SettingRow label="State" value={p.state ?? "-"} />
                <SettingRow label="PIN code" value={p.pin ?? "-"} />
                <SettingRow label="Map point"
                  value={p.latitude && p.longitude ? `${p.latitude}, ${p.longitude}` : "-"} />
                <SettingRow label="Phone" value={p.phone ?? "-"} />
                <SettingRow label="Reservations phone" value={p.reservationsPhone ?? "-"} />
                <SettingRow wide label="Reservations contact" value={p.reservationsContact ?? "-"} />
                <SettingRow wide label="Email" value={p.email ?? "-"} />
                <SettingRow wide label="Website" value={p.website ?? "-"} />
                <SettingRow label="GSTIN" value={p.gstin ?? "-"} />
                <SettingRow label="PAN" value={p.pan ?? "-"} />
              </SettingValues>
            </CardBody>
          </Card>
          <FssaiCard code={p.code} value={p.fssaiNumber} onSaved={refresh} />
          {editing && (
            <EditPropertyDialog hotel={p} nameLocked={!groupAdmin}
              onClose={() => setEditing(false)} onSaved={refresh} />
          )}
        </>
      )}
    </ConsolePage>
  );
}

export function PhotosSettings() {
  const hotelId = useHotel();
  return (
    <ConsolePage title="Logo and photos">
      <HotelLogoCard hotelCode={hotelId} />
      <HotelGalleryCard hotelCode={hotelId} />
    </ConsolePage>
  );
}

/* The house policies (D27-215), read with the profile. */
export function PoliciesSettings() {
  const hotelId = useHotel();
  const qc = useQueryClient();
  const q = useProperty(hotelId);
  const p = q.data?.property;
  return (
    <ConsolePage title="Policies">
      {q.isLoading && <Skeleton className="h-40 w-full" />}
      {p && (
        <HousePoliciesCard hotelCode={p.code} policies={p.housePolicies ?? []}
          onSaved={() => void qc.invalidateQueries({ queryKey: ["property-detail", hotelId] })} />
      )}
    </ConsolePage>
  );
}

export function GroupSettings() {
  return <ConsolePage title="Group"><GroupCard hotelCode={useHotel()} /></ConsolePage>;
}

export function TaxesSettings() {
  return <ConsolePage title="Taxes"><TaxRulesCard hotelId={useHotel()} /></ConsolePage>;
}

export function BankSettings() {
  return <ConsolePage title="Bank details"><BankDetailsCard hotelCode={useHotel()} /></ConsolePage>;
}

export function FrontDeskSettings() {
  const hotelId = useHotel();
  return (
    <ConsolePage title="Times and rules">
      <FrontDeskCard hotelId={hotelId} />
      <FrontDeskRulesCard hotelId={hotelId} />
    </ConsolePage>
  );
}

export function SigningInSettings() {
  return <ConsolePage title="Signing in"><SigningIn /></ConsolePage>;
}

/* D17-36: the switches stay with the owner and an Admin; the page is not
   offered to anybody else (console.settings.ts), and asks again here. */
export function ModulesSettings() {
  const hotelId = useHotel();
  if (!switchesModules(useRole())) return null;
  return (
    <ConsolePage title="Modules">
      <ModulesCard hotelId={hotelId} title="Modules"
        description="What this property runs."
        info="Off means the screens go and the API refuses them."
        only={(m) => !BOOKING_SECTION(m)} />
      <ModulesCard hotelId={hotelId} title="New booking"
        description="The sections that fold open on New booking."
        info="Off hides one at this property; nothing already booked changes."
        only={BOOKING_SECTION} />
    </ConsolePage>
  );
}
