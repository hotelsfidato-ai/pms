import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Building2, UserPlus, KeyRound, ScrollText, Activity, ShieldAlert,
} from "lucide-react";
import { cn } from "@/lib/cn";
import {
  Page, PageHeader, Card, CardBody, Button, StatusPill, toast,
} from "@/components/ui";
import { ASSIGNABLE_ROLES, ROLE_LABELS } from "@/lib/permissions";
import { useSession } from "@/lib/session";
import {
  getAdminOverview, listAdminStaff,
  createProperty, createStaff, grantAccess, revokeAccess, deactivateStaff,
  type AdminStaff, type AdminOverview,
} from "@/data/repositories";

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
          {value === undefined ? "—" : value}
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
function Field({ label, value, onChange, placeholder, hint, mono }: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  hint?: string;
  mono?: boolean;
}) {
  return (
    <label className="block">
      <span className="block text-2xs uppercase tracking-wide text-grey-500 mb-1">
        {label}
      </span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={cn(
          "w-full h-11 px-3 rounded-md border border-grey-300 text-base",
          mono && "tabular",
        )}
      />
      {hint && (
        <span className="block text-2xs text-grey-500 mt-1 leading-relaxed">
          {hint}
        </span>
      )}
    </label>
  );
}

/* ── Creating a property ──────────────────────────────────────────── */

function NewProperty({ onDone }: { onDone: () => void }) {
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [gstin, setGstin] = useState("");
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    const res = await createProperty(
      { code, name, city, state: state || undefined, gstin: gstin || undefined },
      key,
    );
    setBusy(false);

    if (!res.ok) return toast.error("Not created", res.reason);

    toast.success(
      `${res.code} created`,
      `${res.roomTypes} room types from the template. ${res.next}`,
    );
    setCode(""); setName(""); setCity(""); setState(""); setGstin("");
    /* The key is cleared too. It is not a form field somebody should
       leave sitting in a browser between properties. */
    setKey("");
    onDone();
  };

  const ready = code.trim() && name.trim() && city.trim() && key.trim();

  return (
    <Card>
      <div className="px-4 pt-3.5 pb-1 flex items-center gap-2">
        <Building2 className="size-3.5 text-grey-400" />
        <p className="text-2xs uppercase tracking-wide text-grey-500">
          Add a property
        </p>
      </div>
      <CardBody>
        <div className="space-y-2.5">
          <Field label="Code" value={code} onChange={setCode}
            placeholder="NSK" mono
            hint="2–8 letters or digits. It appears in every URL and every invoice number, and it cannot be changed later." />
          <Field label="Name" value={name} onChange={setName}
            placeholder="Fidato Nashik" />
          <Field label="City" value={city} onChange={setCity}
            placeholder="Nashik" />
          <div className="grid grid-cols-2 gap-2.5">
            <Field label="State" value={state} onChange={setState}
              placeholder="MH" />
            <Field label="GSTIN" value={gstin} onChange={setGstin}
              placeholder="27AAAAA0000A1Z5" mono />
          </div>

          <div className="rounded-md border border-brand-yellow-100 bg-brand-yellow-50 p-3">
            <div className="flex items-start gap-2.5">
              <KeyRound className="size-4 text-brand-yellow shrink-0 mt-0.5" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-ink-900">
                  Provisioning key
                </p>
                <p className="text-2xs text-grey-600 mt-0.5 leading-relaxed mb-2">
                  Creating a property manufactures a whole tenant — rooms, an
                  invoice series, a folio namespace. Being signed in as an
                  administrator is not enough on its own.
                </p>
                <input
                  type="password"
                  value={key}
                  onChange={(e) => setKey(e.target.value)}
                  placeholder="the key for this deployment"
                  className="w-full h-11 px-3 rounded-md border border-grey-300 text-base"
                />
              </div>
            </div>
          </div>

          <Button size="lg" className="w-full" loading={busy}
            disabled={!ready} onClick={() => void submit()}>
            <Building2 className="size-4" />
            Create the property
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}

/* ── Creating a person ────────────────────────────────────────────── */

function NewPerson({ onDone }: { onDone: () => void }) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    const res = await createStaff(
      { email, name, isGroupAdmin: isAdmin },
      isAdmin ? key : undefined,
    );
    setBusy(false);

    if (!res.ok) return toast.error("Not created", res.reason);

    toast.success(
      res.existed ? `${name} updated` : `${name} added`,
      /* Said plainly, because it is the next thing somebody has to do
         and forgetting it leaves a person who can sign in and see
         nothing at all. */
      isAdmin
        ? "They can reach every property."
        : "They can reach nothing yet — give them a property below.",
    );
    setEmail(""); setName(""); setIsAdmin(false); setKey("");
    onDone();
  };

  const ready = email.trim() && name.trim() && (!isAdmin || key.trim());

  return (
    <Card>
      <div className="px-4 pt-3.5 pb-1 flex items-center gap-2">
        <UserPlus className="size-3.5 text-grey-400" />
        <p className="text-2xs uppercase tracking-wide text-grey-500">
          Add a person
        </p>
      </div>
      <CardBody>
        <div className="space-y-2.5">
          <Field label="Email" value={email} onChange={setEmail}
            placeholder="clerk@fidato.in"
            hint="How they sign in. It cannot be changed here afterwards." />
          <Field label="Name" value={name} onChange={setName}
            placeholder="Nashik Clerk" />

          <label className="flex items-start gap-2.5 py-1 cursor-pointer">
            <input
              type="checkbox"
              checked={isAdmin}
              onChange={(e) => setIsAdmin(e.target.checked)}
              className="size-5 mt-0.5 shrink-0"
            />
            <span className="min-w-0">
              <span className="block text-base text-ink-900">
                Group administrator
              </span>
              <span className="block text-2xs text-grey-600 leading-relaxed">
                Reaches every property, present and future, and can create more
                people. Takes the provisioning key.
              </span>
            </span>
          </label>

          {isAdmin && (
            <input
              type="password"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder="provisioning key"
              className="w-full h-11 px-3 rounded-md border border-grey-300 text-base"
            />
          )}

          <Button size="lg" className="w-full" loading={busy}
            disabled={!ready} onClick={() => void submit()}>
            <UserPlus className="size-4" />
            Add them
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}

/* ── Who can reach what ───────────────────────────────────────────── */

function People({ staff, codes, onDone }: {
  staff: AdminStaff[]; codes: string[]; onDone: () => void;
}) {
  return (
    <Card className="mt-6">
      <div className="px-4 pt-3.5 pb-1">
        <p className="text-2xs uppercase tracking-wide text-grey-500">
          People, and the properties they reach
        </p>
      </div>
      <ul className="divide-y divide-grey-100">
        {staff.map((person) => (
          <Person key={person.id} person={person} codes={codes}
            onDone={onDone} />
        ))}
        {staff.length === 0 && (
          <li className="px-4 py-6 text-sm text-grey-500 text-center">
            Nobody yet.
          </li>
        )}
      </ul>
    </Card>
  );
}

function Person({ person, codes, onDone }: {
  person: AdminStaff; codes: string[]; onDone: () => void;
}) {
  const [code, setCode] = useState("");
  const [role, setRole] = useState<string>(ASSIGNABLE_ROLES[0] ?? "front_desk");
  const [busy, setBusy] = useState(false);

  const grant = async () => {
    if (!code) return;
    setBusy(true);
    const res = await grantAccess(person.id, code, role);
    setBusy(false);
    if (!res.ok) return toast.error("Not granted", res.reason);
    setCode("");
    onDone();
  };

  const revoke = async (c: string) => {
    const res = await revokeAccess(person.id, c);
    if (!res.ok) return toast.error("Not revoked", res.reason);
    onDone();
  };

  const deactivate = async () => {
    const res = await deactivateStaff(person.id);
    if (!res.ok) return toast.error("Not deactivated", res.reason);
    toast.success(`${person.name} deactivated`,
      "Their account is closed. Their name stays on everything they did.");
    onDone();
  };

  const free = codes.filter((c) => !person.access.some((a) => a.code === c));

  return (
    <li className="px-4 py-3">
      <div className="flex flex-wrap items-center gap-2 mb-1.5">
        <span className={cn(
          "text-base font-medium",
          person.isActive ? "text-ink-900" : "text-grey-400 line-through",
        )}>
          {person.name}
        </span>
        <span className="text-2xs text-grey-500">{person.email}</span>
        {person.isGroupAdmin && (
          <StatusPill tone="info">every property</StatusPill>
        )}
        {!person.isActive && <StatusPill tone="neutral">inactive</StatusPill>}
        {person.isActive && !person.isGroupAdmin
          && person.access.length === 0 && (
          <StatusPill tone="warning">reaches nothing</StatusPill>
        )}
      </div>

      {!person.isGroupAdmin && (
        <div className="flex flex-wrap items-center gap-1.5 mb-2">
          {person.access.map((a) => (
            <button
              key={a.code}
              type="button"
              onClick={() => void revoke(a.code)}
              title={`Remove ${a.code}`}
              className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-md border border-grey-200 bg-white text-2xs hover:border-brand-red hover:text-brand-red pointer-coarse:min-h-11"
            >
              <span className="tabular font-medium">{a.code}</span>
              <span className="text-grey-500">
                {ROLE_LABELS[a.role as keyof typeof ROLE_LABELS] ?? a.role}
              </span>
              <span aria-hidden>×</span>
            </button>
          ))}
          {person.access.length === 0 && (
            <span className="text-2xs text-grey-500">No property yet.</span>
          )}
        </div>
      )}

      {person.isActive && !person.isGroupAdmin && free.length > 0 && (
        <div className="flex flex-wrap gap-2">
          <select value={code} onChange={(e) => setCode(e.target.value)}
            className="h-11 px-2 rounded-md border border-grey-300 text-base">
            <option value="">Property…</option>
            {free.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <select value={role} onChange={(e) => setRole(e.target.value)}
            className="h-11 px-2 rounded-md border border-grey-300 text-base">
            {ASSIGNABLE_ROLES.map((r) => (
              <option key={r} value={r}>{ROLE_LABELS[r]}</option>
            ))}
          </select>
          <Button variant="secondary" size="lg" loading={busy}
            disabled={!code} onClick={() => void grant()}>
            Give access
          </Button>
          {person.isActive && (
            <Button variant="ghost" size="lg" onClick={() => void deactivate()}>
              Deactivate
            </Button>
          )}
        </div>
      )}
    </li>
  );
}

/* ── What has been happening ──────────────────────────────────────── */

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
                  {r.actor ?? "—"}
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
