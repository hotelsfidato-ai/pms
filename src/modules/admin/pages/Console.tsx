import type { ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ScrollText, Activity, ShieldAlert, Building2, BedDouble, Users, UserX,
} from "lucide-react";
import {
  Page, PageHeader, Card, CardBody, StatusPill, FigureRow, FigureTile, IconChip,
} from "@/components/ui";
import {
  NewPerson, People, NewProperty,
} from "@/modules/admin/flows/StaffAdmin";
import { useSession } from "@/lib/session";
import { getAdminOverview, listAdminStaff, type AdminOverview } from "@/modules/admin/data/admin";

/* ══════════════════════════════════════════════════════════════════
   THE ADMIN CONSOLE

   Not the group dashboard. That one answers "how did the hotels
   trade" — occupancy, ADR, RevPAR. This answers "who is using this
   system and what did they change", which is a different question
   with a different audience.

   DEVELOPMENT ONLY, for now. `App.tsx` refuses the route outside a dev
   build and the navigation hides the link — both, because hiding a
   link is not access control and this screen creates tenants.

   The two guards that matter are not here anyway. They are in
   Postgres, and they run whether this screen exists or not:

     app.require_group_admin()       WHO is asking
     app.require_provisioning_key()  whether the deployment permits it
   ══════════════════════════════════════════════════════════════════ */

export default function AdminConsolePage() {
  const qc = useQueryClient();

  const overview = useQuery({
    queryKey: ["admin-overview"],
    queryFn: () => getAdminOverview(),
  });
  const staff = useQuery({
    queryKey: ["admin-staff"],
    queryFn: () => listAdminStaff(),
  });
  /* Codes, not the Property records — `Property` carries no code, and
     the session already holds the list the switcher is built from. It
     is also RLS-scoped, so an admin sees all and nobody else would. */
  const hotels = useSession((st) => st.hotels);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["admin-overview"] });
    void qc.invalidateQueries({ queryKey: ["admin-staff"] });
    void qc.invalidateQueries({ queryKey: ["properties"] });
    /* The property list drives the switcher and every scoped screen. */
    void qc.invalidateQueries({ queryKey: ["hotels"] });
  };

  const o = overview.data;

  return (
    <Page>
      <PageHeader
        title="Administration"
        description="Who uses this system, what they changed, and how new properties and people are created."
        badge={<StatusPill tone="warning">development only</StatusPill>}
      />

      {/* ── What the system is carrying ──────────────────────────── */}
      {/* Figure tiles, level across the row (the Figure and Level Rules). */}
      <FigureRow className="sm:grid-cols-2 lg:grid-cols-4 mb-5">
        <Stat icon={<Building2 />} label="Properties" value={o?.properties.total} />
        <Stat icon={<BedDouble />} label="Rooms" value={o?.properties.rooms} />
        <Stat icon={<Users />} label="Active people" value={o?.staff.active}
          hint={o ? `${o.staff.admins} administrator${o.staff.admins === 1 ? "" : "s"}` : undefined} />
        <Stat
          icon={<UserX />}
          label="Reach nothing"
          value={o?.staff.unassigned}
          /* Somebody who can sign in and see no property at all. A real
             state, and one nobody notices without being told. */
          tone={o && o.staff.unassigned > 0 ? "warning" : undefined}
          hint="signed in, no property"
        />
      </FigureRow>

      <div className="grid gap-3 lg:grid-cols-2">
        <NewProperty onDone={refresh} />
        <NewPerson onDone={refresh} />
      </div>

      <People
        staff={staff.data ?? []}
        codes={hotels.map((h) => h.code)}
        onDone={refresh}
      />

      <Activity14 overview={o} />
    </Page>
  );
}

function Stat({ icon, label, value, hint, tone }: {
  icon: ReactNode; label: string; value?: number; hint?: string; tone?: "warning";
}) {
  return (
    <FigureTile
      icon={icon}
      /* The warning keeps its yellow, on the readable step: the full
         yellow as text was 1.8:1 on white. */
      tone={tone === "warning" ? "yellow" : "neutral"}
      label={label}
      /* A dash, never a zero, while it is still loading. A zero is a
         claim about the database. */
      value={value === undefined ? "-"
        : <span className={tone === "warning" ? "text-brand-yellow-800" : undefined}>{value}</span>}
      missing={value === undefined}
      note={hint}
    />
  );
}


/* A labelled input. Not from the UI kit, because every field here needs a
   hint under it explaining a consequence that cannot be undone later — a
   property code appears in every invoice number, an email is how somebody
   signs in. */

function Activity14({ overview }: { overview: AdminOverview | null | undefined }) {
  if (!overview) return null;

  const peak = Math.max(1, ...overview.activity.map((a) => a.actions));

  return (
    <div className="grid gap-3 lg:grid-cols-2 mt-5">
      <Card>
        <div className="px-4 pt-3.5 flex items-center gap-2.5">
          <IconChip><Activity /></IconChip>
          <p className="text-md font-semibold text-ink-900">
            Fourteen days
          </p>
        </div>
        <CardBody>
          {overview.activity.length === 0 ? (
            <p className="text-sm text-grey-500 py-3 text-center">
              Nothing has been changed in the last fortnight.
            </p>
          ) : (
            <ul className="space-y-1.5">
              {overview.activity.map((day) => (
                <li key={day.day} className="flex items-center gap-2.5">
                  <span className="text-xs text-grey-500 tabular w-20 shrink-0">
                    {day.day.slice(5)}
                  </span>
                  {/* The capsule gauge: 4px on a grey-100 track. */}
                  <span className="flex-1 h-1 rounded-full bg-grey-100 overflow-hidden">
                    <span
                      className="block h-full bg-brand-orange rounded-full"
                      style={{ width: `${(day.actions / peak) * 100}%` }}
                    />
                  </span>
                  <span className="text-xs font-medium tabular text-ink-900 w-10 text-right">
                    {day.actions}
                  </span>
                  <span className="text-xs text-grey-500 w-16 text-right whitespace-nowrap">
                    {day.people} {day.people === 1 ? "person" : "people"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      <Card>
        <div className="px-4 pt-3.5 pb-1 flex items-center gap-2.5">
          <IconChip><ScrollText /></IconChip>
          <p className="text-md font-semibold text-ink-900">
            Most recent changes
          </p>
        </div>
        <ul className="divide-y divide-grey-100 max-h-96 overflow-y-auto">
          {overview.recent.map((r, i) => (
            <li key={i} className="px-4 py-3 flex items-center gap-3">
              <span className="text-xs text-grey-500 tabular w-20 shrink-0">
                {r.at}
              </span>
              <span className="flex-1 min-w-0">
                <span className="block text-sm text-ink-900 truncate">
                  {r.action.toLowerCase()} {r.table.replace(/_/g, " ")}
                </span>
                <span className="block text-xs text-grey-500">
                  {/* A dash, not "System". Null means a migration or the
                      loader acted, and naming a person who did not act is
                      worse than admitting nobody is recorded. */}
                  {r.actor ?? "-"}
                  {r.hotel && ` · ${r.hotel}`}
                </span>
              </span>
            </li>
          ))}
          {overview.recent.length === 0 && (
            <li className="px-4 py-5 text-sm text-grey-500 text-center">
              <ShieldAlert className="size-5 text-grey-400 mx-auto mb-2" />
              Nothing has been recorded yet.
            </li>
          )}
        </ul>
      </Card>
    </div>
  );
}
