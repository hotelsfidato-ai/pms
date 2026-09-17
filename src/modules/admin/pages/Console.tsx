import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ScrollText, Activity, ShieldAlert,
} from "lucide-react";
import { cn } from "@/lib/cn";
import {
  Page, PageHeader, Card, CardBody, StatusPill,
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
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 mb-6">
        <Stat label="Properties" value={o?.properties.total} />
        <Stat label="Rooms" value={o?.properties.rooms} />
        <Stat label="Active people" value={o?.staff.active}
          hint={o ? `${o.staff.admins} administrator${o.staff.admins === 1 ? "" : "s"}` : undefined} />
        <Stat
          label="Reach nothing"
          value={o?.staff.unassigned}
          /* Somebody who can sign in and see no property at all. A real
             state, and one nobody notices without being told. */
          tone={o && o.staff.unassigned > 0 ? "warning" : undefined}
          hint="signed in, no property"
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
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

function Stat({ label, value, hint, tone }: {
  label: string; value?: number; hint?: string; tone?: "warning";
}) {
  return (
    <Card>
      <CardBody>
        <p className="text-2xs uppercase tracking-wide text-grey-500">{label}</p>
        <p className={cn(
          "text-xl font-semibold tabular mt-0.5",
          tone === "warning" ? "text-brand-yellow" : "text-ink-900",
        )}>
          {/* A dash, never a zero, while it is still loading. A zero is a
              claim about the database. */}
          {value === undefined ? "-" : value}
        </p>
        {hint && <p className="text-2xs text-grey-500 mt-0.5">{hint}</p>}
      </CardBody>
    </Card>
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
    <div className="grid gap-6 lg:grid-cols-2 mt-6">
      <Card>
        <div className="px-4 pt-3.5 pb-1 flex items-center gap-2">
          <Activity className="size-3.5 text-grey-400" />
          <p className="text-2xs uppercase tracking-wide text-grey-500">
            Fourteen days
          </p>
        </div>
        <CardBody>
          {overview.activity.length === 0 ? (
            <p className="text-sm text-grey-500 py-4 text-center">
              Nothing has been changed in the last fortnight.
            </p>
          ) : (
            <ul className="space-y-1.5">
              {overview.activity.map((day) => (
                <li key={day.day} className="flex items-center gap-2.5">
                  <span className="text-2xs text-grey-500 tabular w-20 shrink-0">
                    {day.day.slice(5)}
                  </span>
                  <span className="flex-1 h-2 rounded-full bg-grey-100 overflow-hidden">
                    <span
                      className="block h-full bg-brand-orange rounded-full"
                      style={{ width: `${(day.actions / peak) * 100}%` }}
                    />
                  </span>
                  <span className="text-2xs tabular text-ink-900 w-10 text-right">
                    {day.actions}
                  </span>
                  <span className="text-2xs text-grey-500 w-14 text-right">
                    {day.people} {day.people === 1 ? "person" : "people"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      <Card>
        <div className="px-4 pt-3.5 pb-1 flex items-center gap-2">
          <ScrollText className="size-3.5 text-grey-400" />
          <p className="text-2xs uppercase tracking-wide text-grey-500">
            Most recent changes
          </p>
        </div>
        <ul className="divide-y divide-grey-100 max-h-96 overflow-y-auto">
          {overview.recent.map((r, i) => (
            <li key={i} className="px-4 py-2 flex items-center gap-2.5">
              <span className="text-2xs text-grey-500 tabular w-20 shrink-0">
                {r.at}
              </span>
              <span className="flex-1 min-w-0">
                <span className="block text-sm text-ink-900 truncate">
                  {r.action.toLowerCase()} {r.table.replace(/_/g, " ")}
                </span>
                <span className="block text-2xs text-grey-500">
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
            <li className="px-4 py-6 text-sm text-grey-500 text-center">
              <ShieldAlert className="size-5 text-grey-300 mx-auto mb-2" />
              Nothing has been recorded yet.
            </li>
          )}
        </ul>
      </Card>
    </div>
  );
}
