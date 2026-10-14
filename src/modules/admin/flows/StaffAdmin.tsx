import { useState } from "react";
import { UserPlus, Building2, KeyRound } from "lucide-react";
import { cn } from "@/lib/cn";
import { Card, CardBody, Button, StatusPill, IconChip, Input, NativeSelect, toast } from "@/components/ui";
import { ASSIGNABLE_ROLES, ROLE_LABELS } from "@/lib/permissions";
import { createStaff, grantAccess, revokeAccess, deactivateStaff, createProperty, type AdminStaff, minPasswordFor as minFor } from "@/modules/admin/data/admin";

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

   The panels live here. `NewProperty` ships, on Properties; `NewPerson`
   and `People` are the development Console's only - People
   (`pages/People.tsx`) is where a person is added in a real build.

   ⚠ THE GROUP-ADMIN OPTION DOES NOT SHIP (corrected 12 October, D27-308
   (4)). It is on `NewPerson`, so only in a development build; no screen
   in a real build makes a group administrator, and the owner keeps it a
   server job. Either way the refusal is not this checkbox:
   `POST /admin/staff` calls `app.require_provisioning_key()` and refuses
   the act itself. The 31 August commit said as much — *"the two guards
   that matter are not here anyway. They are in Postgres."*
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
    /* The kit's field look (label 14/500 over the box, the hint 12 under
       it); the markup stays this one, a label around its box. */
    <label className="block">
      <span className="block text-sm font-medium text-grey-700 mb-1.5">
        {label}
      </span>
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        numeric={mono}
      />
      {hint && (
        <span className="block text-xs text-grey-500 mt-1.5 leading-relaxed">
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
  const [password, setPassword] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  /* D27-243 (5.3): a group administrator's is 10 characters. */
  const min = minFor([], isAdmin);

  const submit = async () => {
    setBusy(true);
    /* ⚠ THIS FORM SENT NO PASSWORD AND WOULD HAVE BEEN REFUSED. The
       server started requiring one on 9 September, and this is the
       third screen that creates a person — found by the audit rather
       than by remembering it existed. A form that posts a body the
       server rejects is worse than a missing form: it looks like the
       feature is broken rather than absent. */
    const res = await createStaff(
      { email, name, password, isGroupAdmin: isAdmin },
      isAdmin ? key : undefined,
    );
    setBusy(false);

    if (!res.ok) return toast.error("Not created", res.reason);

    /* ⚠ THIS USED TO WARN THAT TWO THINGS REMAINED, and one of them has
       gone. A row in `staff` was not an account: until a Firebase user
       existed and `staff.firebase_uid` named it, a correct password
       reached a correct token that resolved to NOBODY. Creating the
       account is part of the same call now.

       What is still true is the OTHER half — somebody with no property
       signs in to an empty application, which reads as a fault rather
       than a setting. That is the sentence that stays. */
    toast.success(
      res.existed ? `${name} updated` : `${name} added`,
      isAdmin
        ? "They can sign in now, and they reach every property."
        : "They can sign in now. Give them a property below - until then "
          + "the app opens empty for them.",
    );
    setEmail(""); setName(""); setIsAdmin(false); setKey("");
    onDone();
  };

  const ready = email.trim() && name.trim()
    && password.length >= min
    && (!isAdmin || key.trim());

  return (
    <Card>
      <div className="px-4 pt-3.5 flex items-center gap-2.5">
        <IconChip><UserPlus /></IconChip>
        <p className="text-md font-semibold text-ink-900">
          Add a person
        </p>
      </div>
      <CardBody>
        <div className="space-y-3">
          <Field label="Email" value={email} onChange={setEmail}
            placeholder="clerk@fidato.in"
            hint="How they sign in. It cannot be changed here afterwards." />
          <Field label="Name" value={name} onChange={setName}
            placeholder="Nashik Clerk" />
          {/* Not masked: you are setting it FOR somebody else and have
              to read it back to them. */}
          <Field label="Password" value={password} onChange={setPassword}
            placeholder="something they will remember"
            hint={`At least ${min} characters. Tell it to them - nothing is emailed.`} />

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
              <span className="block text-xs text-grey-600 leading-relaxed">
                Reaches every property, present and future, and can create more
                people. Takes the provisioning key.
              </span>
            </span>
          </label>

          {isAdmin && (
            <Input
              type="password"
              autoComplete="new-password"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder="provisioning key"
            />
          )}

          <Button variant="primary" size="lg" className="w-full" loading={busy}
            disabled={!ready} onClick={() => void submit()}>
            <UserPlus className="size-4" />
            Add them
          </Button>

          {/* ⚠ THE THIRD COPY OF A CLAIM THAT STOPPED BEING TRUE. The
              add dialog on /people said it, the People screen's footnote
              said it, and this said it — "adding somebody here does not
              create their sign-in". All three were correct until
              9 September and all three had to be found separately,
              because I corrected the sentence I was editing rather than
              searching for what else asserted the same fact.

              A toast is gone in four seconds, so the standing text stays
              — but it now says the thing that is still true. */}
          <p className="text-xs text-grey-600 leading-relaxed">
            This creates their sign-in account too. Give them a property
            below, or they sign in to an empty application with no error - 
            which reads as a fault rather than as a setting.
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
    <Card className="mt-5">
      <div className="px-4 pt-3.5 pb-1">
        <p className="text-md font-semibold text-ink-900">
          People, and the properties they reach
        </p>
      </div>
      <ul className="divide-y divide-grey-100">
        {staff.map((person) => (
          <Person key={person.id} person={person} codes={codes}
            onDone={onDone} />
        ))}
        {staff.length === 0 && (
          <li className="px-4 py-5 text-sm text-grey-500 text-center">
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
    if (res.warning) toast.error(`${person.name} is deactivated`, res.warning);
    else toast.success(`${person.name} deactivated`,
      "Their account is closed. Their name stays on everything they did.");
    onDone();
  };

  const free = codes.filter((c) => !person.access.some((a) => a.code === c));

  return (
    <li className="px-4 py-3 min-h-14">
      <div className="flex flex-wrap items-center gap-2 mb-2">
        <span className={cn(
          "text-base font-medium",
          person.isActive ? "text-ink-900" : "text-grey-500 line-through",
        )}>
          {person.name}
        </span>
        <span className="text-xs text-grey-500">{person.email}</span>
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
              /* A control, so a capsule (the Tappable Rule). */
              className="press inline-flex items-center gap-1.5 h-8 px-3 rounded-full border border-grey-300 bg-white text-xs hover:border-brand-red-700 hover:text-brand-red-700 pointer-coarse:min-h-11"
            >
              <span className="tabular font-medium">{a.code}</span>
              <span className="text-grey-500">
                {ROLE_LABELS[a.role as keyof typeof ROLE_LABELS] ?? a.role}
              </span>
              <span aria-hidden>×</span>
            </button>
          ))}
          {person.access.length === 0 && (
            <span className="text-xs text-grey-500">No property yet.</span>
          )}
        </div>
      )}

      {person.isActive && !person.isGroupAdmin && free.length > 0 && (
        <div className="flex flex-wrap gap-2">
          <NativeSelect value={code} onChange={(e) => setCode(e.target.value)}
            className="w-auto">
            <option value="">Property…</option>
            {free.map((c) => <option key={c} value={c}>{c}</option>)}
          </NativeSelect>
          <NativeSelect value={role} onChange={(e) => setRole(e.target.value)}
            className="w-auto">
            {ASSIGNABLE_ROLES.map((r) => (
              <option key={r} value={r}>{ROLE_LABELS[r]}</option>
            ))}
          </NativeSelect>
          <Button variant="secondary" loading={busy}
            disabled={!code} onClick={() => void grant()}>
            Give access
          </Button>
          {person.isActive && (
            <Button variant="ghost" onClick={() => void deactivate()}>
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
      res.next,
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
      <div className="px-4 pt-3.5 flex items-center gap-2.5">
        <IconChip><Building2 /></IconChip>
        <p className="text-md font-semibold text-ink-900">
          Add a property
        </p>
      </div>
      <CardBody>
        <div className="space-y-3">
          <Field label="Code" value={code} onChange={setCode}
            placeholder="NSK" mono
            hint="2–8 letters or digits. It appears in every URL and every invoice number, and it cannot be changed later." />
          <Field label="Name" value={name} onChange={setName}
            placeholder="The property's name" />
          <Field label="City" value={city} onChange={setCity}
            placeholder="Nashik" />
          <div className="grid grid-cols-2 gap-3">
            <Field label="State" value={state} onChange={setState}
              placeholder="MH" />
            <Field label="GSTIN" value={gstin} onChange={setGstin}
              placeholder="27AAAAA0000A1Z5" mono />
          </div>

          {/* A tinted tile, not a card in the card. */}
          <div className="rounded-lg bg-brand-yellow-50 ring-1 ring-inset ring-brand-yellow-100 px-3.5 py-3">
            <div className="flex items-start gap-2.5">
              <KeyRound className="size-4 text-brand-yellow-800 shrink-0 mt-0.5" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-ink-900">
                  Provisioning key
                </p>
                <p className="text-xs text-grey-600 mt-0.5 leading-relaxed mb-2">
                  Creating a property makes the hotel and its invoice series;
                  its room types and rooms are added in Set up this hotel.
                  Being signed in as an administrator is not enough on its own.
                </p>
                <Input
                  type="password"
                  autoComplete="new-password"
                  value={key}
                  onChange={(e) => setKey(e.target.value)}
                  placeholder="the provisioning key"
                />
              </div>
            </div>
          </div>

          <Button variant="primary" size="lg" className="w-full" loading={busy}
            disabled={!ready} onClick={() => void submit()}>
            <Building2 className="size-4" />
            Create the property
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}
