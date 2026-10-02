import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, Navigate, useNavigate, useParams } from "react-router";
import { ChevronRight } from "lucide-react";
import { useUi } from "@/lib/ui";
import { useRole, useSession } from "@/lib/session";
import { useDocumentIdentity } from "@/lib/documentIdentity";
import { flatNavigationFor, type NavItem } from "@/components/app/navigation";
import { getModules } from "@/data/repositories";
import {
  Page, PageHeader, Card, CardBody, CardHeader, Button, Skeleton, IconChip,
  Tabs, TabsList, TabsTrigger, TabsContent,
} from "@/components/ui";
import { getPropertyDetail, PROPERTY_TYPES } from "@/modules/admin/data/admin";
import { switchesModules } from "@/modules/admin/moduleSwitchRoles";
import { GroupCard, HotelLogoCard } from "@/modules/admin/components/GroupCard";
import { HotelGalleryCard } from "@/modules/admin/components/HotelGalleryCard";
import { SigningIn } from "@/modules/admin/components/SigningIn";
import { BankDetailsCard, HousePoliciesCard } from "@/modules/admin/components/VoucherSettings";
import { CommissioningCard } from "@/modules/admin/flows/CommissioningCard";
import { ModulesCard, BOOKING_SECTION, SettingRow, SettingValues } from "@/modules/admin/pages/Admin";
import { EditPropertyDialog } from "@/modules/admin/pages/Properties";
import { FssaiCard } from "@/modules/admin/pages/Property";
import { FrontDeskCard } from "@/modules/inventory";
import { FrontDeskRulesCard } from "@/modules/front-desk";
import { TaxRulesCard } from "@/modules/finance";

/* ══════════════════════════════════════════════════════════════════
   SETTINGS — one place (D27-213, D27-214), and only what can be
   changed (the owner's D27-220, 1 October)

   Five tabs. Each MOUNTS the cards where something is changed; nothing
   is rewritten, and each department's setup stays in its own section of
   the menu. Rows nobody can change are not drawn (the code, currency,
   time zone, the financial year, the GST repeated): they are on
   Properties, in every address and invoice number, or on the GST card
   itself. A tab links only the few screens that are where its subject
   is set; the department screens are in their own sections.

   What the property still needs is a checklist ABOVE the tabs, drawn
   only while something is missing (CommissioningCard hides itself).

   WHO: whoever holds `setting` - the owner, an Admin, the GM. A link a
   person cannot open is not drawn (the menu's own answer,
   flatNavigationFor), a switch they cannot use is not drawn, and a tab
   left with nothing is not shown.

   The hotel is the one chosen in the top bar, or the one in the address
   (/h/:code/settings/:tab, the owner's bell). The tab is in the address.
   ══════════════════════════════════════════════════════════════════ */

export const SETTINGS_TABS = [
  { key: "property", label: "Property" },
  { key: "rates-and-taxes", label: "Rates and taxes" },
  { key: "operations", label: "Operations" },
  { key: "people", label: "People" },
  { key: "connections", label: "Connections" },
] as const;
type TabKey = (typeof SETTINGS_TABS)[number]["key"];

/* The eight tabs of 30 September, and where their things are now. Links
   already out there - a checklist row, the till's setup, the bell's
   notice, a bookmark - keep opening the right tab. */
const MOVED: Record<string, TabKey> = {
  "rooms-and-rates": "rates-and-taxes",
  "taxes-and-billing": "rates-and-taxes",
  "reservations-and-front-desk": "operations",
  "departments": "operations",
  "people-and-access": "people",
  "modules-and-connections": "operations",
  "getting-started": "property",
};

/* The screens a tab links to: the menu's own address, and one line saying
   what is set there. The NAME is the menu's, so a thing has one name. */
const LINKS: Partial<Record<TabKey, { to: string; note: string }[]>> = {
  "rates-and-taxes": [
    { to: "/h/:code/rates", note: "How rates are built, the add-ons, each day's base, stop sell and minimum nights." },
    { to: "/h/:code/room-types", note: "The room types and the rooms that are of them." },
    { to: "/h/:code/cancellation-terms", note: "What a cancellation or a no-show costs." },
    { to: "/h/:code/booking-sources", note: "Where bookings come from, and each source's commission." },
  ],
  "people": [
    { to: "/people", note: "Everybody who works here: add, change, set a password, switch off." },
    { to: "/admin/roles", note: "What each role may see and do." },
    { to: "/admin/audit-log", note: "Charges, payments and reversals, and who made them." },
    { to: "/admin/activity", note: "Every change: who, when, which record and what changed." },
    { to: "/admin/sign-ins", note: "When each person signed in, and on what device. Kept 90 days." },
  ],
  "connections": [
    { to: "/h/:code/channels", note: "The booking sites: rooms, prices and availability sent out." },
    { to: "/h/:code/crs-bookings", note: "The CRS connection, and the bookings it sends." },
    { to: "/h/:code/guest-messages", note: "The messages guests are sent, and whether sending is on." },
    { to: "/h/:code/reviews", note: "The review link guests are sent." },
    { to: "/h/:code/online-checkin", note: "Online check-in, its room cards and ID photos." },
  ],
};

/* Tabs that hold links alone: shown only to somebody who may open one. */
const LINKS_ONLY: readonly TabKey[] = ["people", "connections"];

type LinkRow = { item: NavItem; note: string };

export default function SettingsPage() {
  const params = useParams<{ code?: string; tab?: string }>();
  const fallback = useUi((s) => s.hotelId);
  const hotelId = params.code ?? fallback;
  const base = params.code ? `/h/${params.code}/settings` : "/settings";
  const tab = params.tab;
  const role = useRole();
  const navigate = useNavigate();
  const { property } = useDocumentIdentity();

  const modules = useQuery({
    queryKey: ["modules", hotelId],
    queryFn: () => getModules(hotelId),
    enabled: Boolean(hotelId),
    staleTime: 5 * 60_000,
  });

  /* What this person may open, from the menu's own rule - role and modules. */
  const reachable = new Map(
    flatNavigationFor(role, hotelId, modules.data).map((item) => [item.to, item]));
  const rows = (key: TabKey): LinkRow[] => (LINKS[key] ?? []).flatMap((l) => {
    const item = reachable.get(l.to.replace(":code", hotelId));
    return item ? [{ item, note: l.note }] : [];
  });
  const switches = switchesModules(role);

  /* Five tabs still scroll sideways on a phone: bring the open one in. */
  useEffect(() => {
    document.querySelector('[role="tab"][aria-selected="true"]')
      ?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }, [tab]);

  const shown = SETTINGS_TABS.filter((t) => !LINKS_ONLY.includes(t.key) || rows(t.key).length > 0);
  if (!shown.some((t) => t.key === tab)) {
    const moved = tab ? MOVED[tab] : undefined;
    return <Navigate to={`${base}/${moved ?? shown[0]!.key}`} replace />;
  }

  return (
    <Page className="max-w-6xl">
      <PageHeader title="Settings" {...(property ? { description: property } : {})} />
      <div className="flex flex-col gap-5">
        <CommissioningCard hotelId={hotelId} />
        <Tabs value={tab!} onValueChange={(next) => navigate(`${base}/${next}`)}>
          <TabsList>
            {shown.map((t) => <TabsTrigger key={t.key} value={t.key}>{t.label}</TabsTrigger>)}
          </TabsList>

          <TabsContent value="property" className="flex flex-col gap-3">
            <PropertyTab hotelId={hotelId} />
          </TabsContent>

          <TabsContent value="rates-and-taxes" className="flex flex-col gap-3">
            <TaxRulesCard hotelId={hotelId} />
            <BankDetailsCard hotelCode={hotelId} />
            <LinkRows title="Set on their own screens" rows={rows("rates-and-taxes")} />
          </TabsContent>

          <TabsContent value="operations" className="flex flex-col gap-3">
            <FrontDeskCard hotelId={hotelId} />
            <FrontDeskRulesCard hotelId={hotelId} />
            <HousePolicies hotelId={hotelId} />
            {/* D17-36: the switches stay with the owner and an administrator;
                hidden from the GM, whom the server would refuse. */}
            {switches && (
              <>
                <ModulesCard hotelId={hotelId} title="Modules"
                  description="What this property runs."
                  info="Off means the screens go and the API refuses them."
                  only={(m) => !BOOKING_SECTION(m)} />
                <ModulesCard hotelId={hotelId} title="New booking"
                  description="The sections that fold open on New booking."
                  info="Off hides one at this property; nothing already booked changes."
                  only={BOOKING_SECTION} />
              </>
            )}
          </TabsContent>

          <TabsContent value="people" className="flex flex-col gap-3">
            <LinkRows rows={rows("people")} />
            <SigningIn />
          </TabsContent>

          <TabsContent value="connections">
            <LinkRows rows={rows("connections")} />
          </TabsContent>
        </Tabs>
      </div>
    </Page>
  );
}

/* ── The hotel's own details ──────────────────────────────────────── */

function useProperty(hotelId: string) {
  return useQuery({
    queryKey: ["property-detail", hotelId],
    queryFn: () => getPropertyDetail(hotelId),
    enabled: Boolean(hotelId),
  });
}

function PropertyTab({ hotelId }: { hotelId: string }) {
  const qc = useQueryClient();
  const groupAdmin = useSession((s) => s.scope?.isGroupAdmin === true);
  const [editing, setEditing] = useState(false);
  const q = useProperty(hotelId);
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["property-detail", hotelId] });
    void qc.invalidateQueries({ queryKey: ["commissioning", hotelId] });
  };

  if (q.isLoading) return <Skeleton className="h-64 w-full" />;
  const p = q.data?.property;
  if (!p) return null;
  const type = PROPERTY_TYPES.find(([word]) => word === p.propertyType)?.[1];

  /* Grouped the way the edit form asks: who, where, how to reach, the tax
     numbers. A long value takes two cells so it is never broken mid-word. */
  return (
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
      <HotelLogoCard hotelCode={p.code} />
      <HotelGalleryCard hotelCode={p.code} />
      <FssaiCard code={p.code} value={p.fssaiNumber} onSaved={refresh} />
      <GroupCard hotelCode={p.code} />
      {editing && (
        <EditPropertyDialog hotel={p} nameLocked={!groupAdmin}
          onClose={() => setEditing(false)} onSaved={refresh} />
      )}
    </>
  );
}

/* ── The hotel's house policies (D27-215): read with the profile ──── */

function HousePolicies({ hotelId }: { hotelId: string }) {
  const qc = useQueryClient();
  const q = useProperty(hotelId);
  if (q.isLoading) return <Skeleton className="h-40 w-full" />;
  const p = q.data?.property;
  if (!p) return null;
  return (
    <HousePoliciesCard hotelCode={p.code} policies={p.housePolicies ?? []}
      onSaved={() => void qc.invalidateQueries({ queryKey: ["property-detail", hotelId] })} />
  );
}

/* ── A few screens: the menu's glyph and name, what is set there, an arrow ── */

function LinkRows({ title, rows }: { title?: string; rows: LinkRow[] }) {
  if (rows.length === 0) return null;
  return (
    <Card>
      {title && <CardHeader title={title} />}
      <ul className="divide-y divide-grey-100">
        {rows.map(({ item, note }) => (
          <li key={item.to}>
            <Link to={item.to}
              className="flex items-center gap-3.5 min-h-14 px-4 py-3 hover:bg-grey-50 transition-colors duration-150 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-orange">
              <IconChip><item.icon /></IconChip>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-ink-900">{item.label}</span>
                <span className="block text-xs font-medium text-grey-500 mt-0.5">{note}</span>
              </span>
              <ChevronRight className="size-4 text-grey-500 shrink-0" aria-hidden />
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}
