import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, Navigate, useNavigate, useParams } from "react-router";
import { ChevronRight } from "lucide-react";
import { useUi } from "@/lib/ui";
import { useRole, useSession } from "@/lib/session";
import { flatNavigationFor } from "@/components/app/navigation";
import { getModules } from "@/data/repositories";
import {
  Page, PageHeader, Card, CardBody, CardHeader, Button, Skeleton,
  Tabs, TabsList, TabsTrigger, TabsContent,
} from "@/components/ui";
import { getSettings, type SettingGroup } from "@/modules/admin/data/adminLists";
import { getPropertyDetail } from "@/modules/admin/data/admin";
import { getCommissioning } from "@/modules/admin/data/commissioning";
import { switchesModules } from "@/modules/admin/moduleSwitchRoles";
import { TaxInUseRows } from "@/modules/admin/components/TaxInUse";
import { GroupCard } from "@/modules/admin/components/GroupCard";
import { CommissioningCard } from "@/modules/admin/flows/CommissioningCard";
import { ModulesCard, BOOKING_SECTION, SettingRow } from "@/modules/admin/pages/Admin";
import { EditPropertyDialog } from "@/modules/admin/pages/Properties";
import { FssaiCard } from "@/modules/admin/pages/Property";
import { FrontDeskCard } from "@/modules/inventory";
import { TaxRulesCard } from "@/modules/finance";

/* ══════════════════════════════════════════════════════════════════
   SETTINGS — one place (the owner's D27-213 and D27-214)

   Settings were on about two dozen screens; the two named for it held
   a small part. This is the one place that lists them all, in the
   owner's eight tabs. It MOUNTS the cards that exist as components and
   LINKS to every setup screen that is its own page - nothing is
   rewritten, and each department's screen stays in its own section for
   the people who use it (the kitchen manager still edits the menu from
   Point of sale).

   WHO: whoever holds `setting` - the owner, an Admin, the GM. A row a
   person cannot open is not shown (the menu's own answer,
   flatNavigationFor), a switch they cannot use is not drawn, and a tab
   left with nothing is not shown. The accountant keeps the GST card on
   Invoices.

   The hotel is the one chosen in the top bar; the tab is in the address
   (/settings/taxes-and-billing), so a checklist row or a refusal
   sentence can point straight at it.
   ══════════════════════════════════════════════════════════════════ */

export const SETTINGS_TABS = [
  { key: "property", label: "Property" },
  { key: "rooms-and-rates", label: "Rooms and rates" },
  { key: "taxes-and-billing", label: "Taxes and billing" },
  { key: "reservations-and-front-desk", label: "Reservations and front desk" },
  { key: "departments", label: "Departments" },
  { key: "people-and-access", label: "People and access" },
  { key: "modules-and-connections", label: "Modules and connections" },
  { key: "getting-started", label: "Getting started" },
] as const;
type TabKey = (typeof SETTINGS_TABS)[number]["key"];

/* The screens a tab links to: the menu's own address, and one line saying
   what is set there. The NAME is the menu's, so a thing has one name. */
const LINKS: Partial<Record<TabKey, { to: string; note: string }[]>> = {
  "property": [
    { to: "/properties", note: "Every property of the group: add one, close or reopen one." },
  ],
  "rooms-and-rates": [
    { to: "/h/:code/room-types", note: "The room types and the rooms that are of them." },
    { to: "/h/:code/rates", note: "How rates are built, the add-ons, each day's base, stop sell and minimum nights." },
    { to: "/h/:code/cancellation-terms", note: "What a cancellation or a no-show costs." },
    { to: "/h/:code/booking-sources", note: "Where bookings come from, and each source's commission." },
    { to: "/h/:code/book", note: "Sales people and Room promotions are set from their buttons on this screen." },
  ],
  "departments": [
    { to: "/h/:code/till/setup", note: "The restaurant's name, its sections and tables." },
    { to: "/h/:code/menu", note: "Dishes, sizes, add-ons and prices." },
    { to: "/h/:code/kitchen", note: "The KOT printer is switched on from this screen." },
    { to: "/h/:code/banquet/setup", note: "Halls, packages and their prices." },
    { to: "/h/:code/laundry/price-list", note: "What each laundry item costs." },
    { to: "/h/:code/spa/setup", note: "Treatments, therapists and their prices." },
    { to: "/h/:code/places", note: "The stores' places and the suppliers." },
    { to: "/h/:code/purchasing/who-may-ask", note: "Which departments may ask to buy." },
  ],
  "people-and-access": [
    { to: "/people", note: "Everybody who works here: add, change, set a password, switch off." },
    { to: "/admin/users", note: "Who can sign in, their role and when they were last seen." },
    { to: "/admin/roles", note: "What each role may see and do." },
    { to: "/admin/audit-log", note: "Who changed what, and when." },
  ],
  "modules-and-connections": [
    { to: "/admin/integrations", note: "What this system is connected to, and whether each is answering." },
    { to: "/h/:code/channels", note: "The booking sites: rooms, prices and availability sent out." },
    { to: "/h/:code/crs-bookings", note: "The CRS connection, and the bookings it sends." },
    { to: "/h/:code/guest-messages", note: "The messages guests are sent, and whether sending is on." },
    { to: "/h/:code/leads", note: "Leads and WhatsApp conversations, read from the leads app." },
    { to: "/h/:code/reviews", note: "The review link guests are sent." },
    { to: "/h/:code/online-checkin", note: "Online check-in, its room cards and ID photos." },
    { to: "/admin/system-health", note: "What the server is doing: uptime, errors, backups." },
  ],
};

function useHotel() {
  const params = useParams();
  const fallback = useUi((s) => s.hotelId);
  return params["code"] ?? fallback;
}

export default function SettingsPage() {
  const hotelId = useHotel();
  const role = useRole();
  const navigate = useNavigate();
  const { tab } = useParams<{ tab?: string }>();

  const modules = useQuery({
    queryKey: ["modules", hotelId],
    queryFn: () => getModules(hotelId),
    enabled: Boolean(hotelId),
    staleTime: 5 * 60_000,
  });
  const settings = useQuery({
    queryKey: ["settings", hotelId],
    queryFn: () => getSettings(hotelId),
  });
  const checklist = useQuery({
    queryKey: ["commissioning", hotelId],
    queryFn: () => getCommissioning(hotelId),
    enabled: Boolean(hotelId),
  });

  /* What this person may open, from the menu's own rule - role and modules. */
  const reachable = new Map(
    flatNavigationFor(role, hotelId, modules.data).map((item) => [item.to, item]));
  const rows = (key: TabKey) => (LINKS[key] ?? [])
    .map((l) => ({ ...l, item: reachable.get(l.to.replace(":code", hotelId)) }))
    .filter((l) => l.item);

  const group = (title: string) => (settings.data ?? []).find((g) => g.title === title);
  const switches = switchesModules(role);
  const outstanding = checklist.data?.checks.filter((c) => !c.done).length ?? 0;

  /* A tab of links alone is not shown to somebody who can open none of them. */
  const shown = SETTINGS_TABS.filter((t) =>
    t.key !== "departments" || rows("departments").length > 0);
  if (!shown.some((t) => t.key === tab)) {
    return <Navigate to={`/settings/${shown[0]!.key}`} replace />;
  }

  return (
    <Page className="max-w-6xl">
      <PageHeader
        title="Settings"
        description="Everything this property is set up with, in one place."
      />
      <Tabs value={tab!} onValueChange={(next) => navigate(`/settings/${next}`)}>
        <TabsList>
          {shown.map((t) => (
            <TabsTrigger key={t.key} value={t.key}
              {...(t.key === "getting-started" && outstanding > 0 ? { count: outstanding } : {})}>
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="property" className="flex flex-col gap-5">
          <ProfileCard hotelId={hotelId} facts={group("Property")} />
          <LinkRows rows={[
            ...(reachable.has("/properties")
              ? [{ to: `/properties/${hotelId}`, label: "Who works here", note: "The people at this property and the role each holds." }]
              : []),
            ...rows("property").map((l) => ({ to: l.item!.to, label: l.item!.label, note: l.note })),
          ]} />
        </TabsContent>

        <TabsContent value="rooms-and-rates" className="flex flex-col gap-5">
          <LinkRows rows={rows("rooms-and-rates").map((l) => ({ to: l.item!.to, label: l.item!.label, note: l.note }))} />
          <GroupCardOf group={group("Operations")} hotelId={hotelId} loading={settings.isLoading} />
        </TabsContent>

        <TabsContent value="taxes-and-billing" className="flex flex-col gap-5">
          <TaxRulesCard hotelId={hotelId} />
          <GroupCardOf group={group("Tax and billing")} hotelId={hotelId} loading={settings.isLoading} />
          <GroupCard hotelCode={hotelId} />
        </TabsContent>

        <TabsContent value="reservations-and-front-desk" className="flex flex-col gap-5">
          <FrontDeskCard hotelId={hotelId} />
          {/* D17-36: the switches stay with the owner and an administrator;
              hidden from the GM, whom the server would refuse. */}
          {switches && (
            <ModulesCard hotelId={hotelId} title="New booking"
              description="The sections that fold open on New booking. Off hides one at this property; nothing already booked changes."
              only={BOOKING_SECTION} />
          )}
        </TabsContent>

        <TabsContent value="departments" className="flex flex-col gap-5">
          <LinkRows rows={rows("departments").map((l) => ({ to: l.item!.to, label: l.item!.label, note: l.note }))} />
        </TabsContent>

        <TabsContent value="people-and-access" className="flex flex-col gap-5">
          <LinkRows rows={rows("people-and-access").map((l) => ({ to: l.item!.to, label: l.item!.label, note: l.note }))} />
        </TabsContent>

        <TabsContent value="modules-and-connections" className="flex flex-col gap-5">
          {switches && (
            <ModulesCard hotelId={hotelId} title="Modules"
              description="What this property runs. Off means the screens go and the API refuses them."
              only={(m) => !BOOKING_SECTION(m)} />
          )}
          <LinkRows rows={rows("modules-and-connections").map((l) => ({ to: l.item!.to, label: l.item!.label, note: l.note }))} />
        </TabsContent>

        <TabsContent value="getting-started" className="flex flex-col gap-5">
          <CommissioningCard hotelId={hotelId} />
          {checklist.data && outstanding === 0 && (
            <Card><CardBody>
              <p className="text-base text-ink-900">Everything this property needs is settled.</p>
              <p className="text-sm text-grey-600 mt-0.5">
                This list comes back by itself the moment something it checks stops being true.
              </p>
            </CardBody></Card>
          )}
        </TabsContent>
      </Tabs>
    </Page>
  );
}

/* ── The hotel's own details ──────────────────────────────────────── */

function ProfileCard({ hotelId, facts }: { hotelId: string; facts: SettingGroup | undefined }) {
  const qc = useQueryClient();
  const groupAdmin = useSession((s) => s.scope?.isGroupAdmin === true);
  const [editing, setEditing] = useState(false);
  const q = useQuery({
    queryKey: ["property-detail", hotelId],
    queryFn: () => getPropertyDetail(hotelId),
    enabled: Boolean(hotelId),
  });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["property-detail", hotelId] });
    void qc.invalidateQueries({ queryKey: ["settings", hotelId] });
    void qc.invalidateQueries({ queryKey: ["commissioning", hotelId] });
  };

  if (q.isLoading) return <Skeleton className="h-64 w-full" />;
  const p = q.data?.property;
  if (!p) return null;
  /* Set once for the property; no screen changes them. */
  const fact = (label: string) => facts?.rows.find((r) => r.label === label)?.value ?? "-";

  return (
    <>
      <Card>
        <CardHeader title="Profile" description="These print on this property's invoices."
          actions={<Button variant="secondary" onClick={() => setEditing(true)}>Edit</Button>} />
        <CardBody className="pt-0">
          <dl className="divide-y divide-grey-100">
            <SettingRow label="Name" value={p.name} />
            <SettingRow label="Code" value={p.code} />
            <SettingRow label="Address" value={p.addressLine ?? "-"} />
            <SettingRow label="City" value={p.city ?? "-"} />
            <SettingRow label="State" value={p.state ?? "-"} />
            <SettingRow label="GSTIN" value={p.gstin ?? "-"} />
            <SettingRow label="Phone" value={p.phone ?? "-"} />
            <SettingRow label="Email" value={p.email ?? "-"} />
            <SettingRow label="Currency" value={fact("Currency")} />
            <SettingRow label="Time zone" value={fact("Time zone")} />
          </dl>
        </CardBody>
      </Card>
      <FssaiCard code={p.code} value={p.fssaiNumber} onSaved={refresh} />
      {editing && (
        <EditPropertyDialog hotel={p} nameLocked={!groupAdmin}
          onClose={() => setEditing(false)} onSaved={refresh} />
      )}
    </>
  );
}

/* ── One of today's read-only groups, as Settings drew it ─────────── */

function GroupCardOf({ group, hotelId, loading }: {
  group: SettingGroup | undefined; hotelId: string; loading: boolean;
}) {
  if (loading) return <Skeleton className="h-40 w-full" />;
  if (!group) return null;
  return (
    <Card>
      <CardHeader title={group.title} description={group.note} />
      <CardBody className="pt-0">
        <dl className="divide-y divide-grey-100">
          {group.taxInUse && (
            <TaxInUseRows hotelCode={hotelId} row={(label, value, key) => (
              <SettingRow key={key} label={label} value={value} />
            )} />
          )}
          {group.rows.map((row) => (
            <SettingRow key={row.label} label={row.label} value={row.value} />
          ))}
        </dl>
      </CardBody>
    </Card>
  );
}

/* ── A list of screens: the name, what is set there, an arrow ─────── */

function LinkRows({ rows }: { rows: { to: string; label: string; note: string }[] }) {
  if (rows.length === 0) return null;
  return (
    <Card>
      <ul className="divide-y divide-grey-100">
        {rows.map((r) => (
          <li key={r.to}>
            <Link to={r.to}
              className="flex items-center gap-3 px-4 py-3 hover:bg-grey-50 transition-colors duration-150 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-orange">
              <span className="min-w-0 flex-1">
                <span className="block text-base font-medium text-ink-900">{r.label}</span>
                <span className="block text-sm text-grey-600 mt-0.5">{r.note}</span>
              </span>
              <ChevronRight className="size-4 text-grey-400 shrink-0" aria-hidden />
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}
