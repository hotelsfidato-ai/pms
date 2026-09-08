import { useState } from "react";
import { UserPlus, Building2, KeyRound } from "lucide-react";
import { cn } from "@/lib/cn";
import { Card, CardBody, Button, StatusPill, toast } from "@/components/ui";
import { ASSIGNABLE_ROLES, ROLE_LABELS } from "@/lib/permissions";
import {
  createStaff, grantAccess, revokeAccess, deactivateStaff, createProperty,
  type AdminStaff,
} from "@/data/repositories";

/* ══════════════════════════════════════════════════════════════════
   ADDING A PERSON, AND SAYING WHAT THEY CAN REACH

   ⚠ THIS LIVED ON A SCREEN THAT DOES NOT EXIST IN PRODUCTION.

   `/admin/console` is wrapped in `{IS_DEV && …}` and tree-shaken out of
   a real build. The decision on 31 August was right about its target:
   *"hiding a link has never been access control, and this screen
   manufactures tenants."* Creating a PROPERTY is a structural act and
   belongs behind that gate.

   Creating a PERSON sat on the same screen, so gating the screen removed
   both. For eight days nobody could add a user to the live system
   without SQL on the server, and it went unnoticed because the property
   has one staff member. The owner found it trying to set up testers.

   The panels live here now and both screens import them: the console
   keeps them for development, and `/admin/users` ships them.

   ⚠ THE GROUP-ADMIN OPTION SHIPS TOO, deliberately. Without it a
   production deployment could never mint a second group admin — a trap
   that surfaces the day the first one leaves. It is safe because the
   refusal is not this checkbox: `POST /admin/staff` calls
   `app.require_provisioning_key()` and refuses the act itself. The
   31 August commit said as much — *"the two guards that matter are not
   here anyway. They are in Postgres."*
   ══════════════════════════════════════════════════════════════════ */

/* Travelled with the panels rather than being duplicated. The shared
   `Field` in `components/ui` takes a different shape. */
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

/* ── Creating a person ────────────────────────────────────────────── */

export function NewPerson({ onDone }: { onDone: () => void }) {
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

    /* ⚠ TWO THINGS REMAIN AFTER THIS, and neither is obvious.
       A row in `staff` is not an account. Until a Firebase user exists
       and `staff.firebase_uid` names it, a correct password reaches a
       correct token that resolves to NOBODY — and every screen renders
       empty with no error, which reads as "the database is broken".
       `link-staff.ts` opens with that exact warning.
       It also fails the deploy: the preflight refuses on
       `firebase_uid is null and is_active`. Somebody adding testers
       here and stopping would find that out at the next upgrade. */
    toast.success(
      res.existed ? `${name} updated` : `${name} added`,
      isAdmin
        ? "They can reach every property — once their sign-in is linked."
        : "Two things left: give them a property below, and link their "
          + "Firebase account. Until then they sign in to an empty app.",
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

          {/* A toast is gone in four seconds and this is the step people
              miss. Standing text, where somebody looks when they wonder
              why the person they just added cannot sign in. */}
          <p className="text-2xs text-grey-600 leading-relaxed pt-1">
            Adding somebody here does not create their sign-in. A Firebase
            account has to exist and be linked, or they sign in to an empty
            application with no error — and the deploy preflight refuses
            while anybody is unlinked.
          </p>
        </div>
      </CardBody>
    </Card>
  );
}

/* ── Who can reach what ───────────────────────────────────────────── */

export function People({ staff, codes, onDone }: {
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

/* ══════════════════════════════════════════════════════════════════
   CREATING A PROPERTY

   ⚠ THE PROVISIONING KEY STAYS, and that is the whole difference
   between this and the person form above.

   The 31 August gate said *"this screen manufactures tenants"* and it
   was right: creating a property mints rooms, an invoice series and a
   folio namespace, and the code appears in every URL and every invoice
   number a guest ever sees. It cannot be changed afterwards.

   So this ships, but the refusal does not move to the browser. The
   server calls `app.require_provisioning_key()` and refuses the act
   itself; the field below only carries the key to it. A deployment with
   no key configured provisions nothing, for anybody, which is asserted
   in `db/tests/suite.sql`.

   It ships because `deploy/README.md` step 8 has been telling people to
   add their properties through Admin → Properties since the day the
   console stopped shipping — an instruction that could not be followed.
   ══════════════════════════════════════════════════════════════════ */

/* ── Creating a property ──────────────────────────────────────────── */

export function NewProperty({ onDone }: { onDone: () => void }) {
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
