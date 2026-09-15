import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { UserPlus, X, ShieldCheck, Building2, Info } from "lucide-react";
import { cn } from "@/lib/cn";
import {
  ASSIGNABLE_ROLES, ROLE_LABELS, type Role,
} from "@/lib/permissions";
import {
  Page, PageHeader, Card, CardBody, Button, Skeleton, EmptyState,
  Dialog, DialogContent, Field, fieldProps, Input, NativeSelect,
  StatusPill, toast,
} from "@/components/ui";
import {
  listAdminStaff, createStaff, grantAccess, revokeAccess, deactivateStaff,
  amendStaff, reactivateStaff, setStaffPassword, setHomeScreen, MIN_PASSWORD,
  listProperties, type AdminStaff, type HomeScreen,
} from "@/data/repositories";
import { HOME_SCREENS } from "@/lib/homeScreen";

/* ══════════════════════════════════════════════════════════════════
   THE PEOPLE WHO WORK HERE

   The endpoints behind this screen have existed since the admin work
   and were reachable only from a development-only console — so the
   owner, who has to put their own staff into the system, could not.
   That is the same hole room types had, and the front desk's hours:
   a feature is not built until the people it is for can reach it.

   HOW SOMEBODY ACTUALLY SIGNS IN. Adding a person here does not create
   a password. It records that this email address is a member of staff;
   `auth.ts` links the Firebase account to the row on the first
   sign-in, by matching the address. So the address has to be the one
   they will sign in with, and getting it wrong is the whole failure
   mode — hence it is the first thing the form asks for and the thing
   the hint talks about.

   ACCESS IS PER PROPERTY, NEVER GLOBAL. A clerk at Akkalkot has a row
   for Akkalkot; that is what RLS reads, and it is why they cannot see
   another hotel's guests. A GROUP ADMIN skips all of it and can reach
   everything, which is why minting one takes the provisioning key and
   this screen cannot do it on its own.

   NOBODY IS DELETED. The audit log names people, and a deleted row
   turns every entry it appears in into an orphan. Deactivating stops
   the sign-in and keeps the history readable.
   ══════════════════════════════════════════════════════════════════ */

/* ⚠ THIS WAS A THIRD LIST OF ROLES, WITH ITS OWN LABELS.
   `permissions.ts` had one, `staff_hotels_role_valid` had another, and
   this picker had a third — eight roles, its own words ("Restaurant",
   "Accounts", "Read only"), and no `admin`, `hotel_manager`,
   `kitchen_manager` or `chef` at all. So four of the twelve roles the
   database accepts could not be chosen from the screen that exists to
   choose them.

   Same fault, one level down, and found the same way: by opening the
   picker and reading what was in it.

   ONE LIST NOW. `ASSIGNABLE_ROLES` and `ROLE_LABELS` come from
   permissions.ts, which `api/test/roles.test.ts` holds equal to
   `app.assignable_roles()`. A role added anywhere appears here without
   anybody remembering to add it.

   The sentence under each one stays here, because it describes the job
   to somebody choosing it rather than defining the role — and a role
   with no sentence yet says so plainly instead of showing a blank. */
const ROLE_WHAT: Partial<Record<Role, string>> = {
  owner:           "Every property, and the settings that govern them",
  admin:           "Runs the system day to day, including accounts",
  gm:              "Everything at this property, and the night audit",
  hotel_manager:   "The property day to day, without the money decisions",
  front_desk:      "Bookings, check-in, bills, the cash drawer",
  housekeeping:    "Room status and work orders",
  kitchen_manager: "The pass and the menu",
  chef:            "The pass — moves dishes along, touches no money",
  pos:             "The till, orders and the day end",
  stores:          "Stock, receiving and issues. Raises purchases",
  finance:         "Invoices, the city ledger and the reports",
  read_only:       "Can look, cannot change anything",
};

const ROLES: { value: Role; label: string; what: string }[] =
  ASSIGNABLE_ROLES.map((value) => ({
    value,
    label: ROLE_LABELS[value],
    what: ROLE_WHAT[value] ?? "No description written for this role yet.",
  }));

const roleLabel = (r: string) =>
  ROLES.find((x) => x.value === r)?.label ?? r;

export default function PeoplePage() {
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [granting, setGranting] = useState<AdminStaff | null>(null);

  const staff = useQuery({
    queryKey: ["people"],
    queryFn: () => listAdminStaff(),
  });

  const refresh = () => { void qc.invalidateQueries({ queryKey: ["people"] }); };

  const rows = staff.data ?? [];
  const active = rows.filter((s) => s.isActive);

  /* Signed in and able to reach nothing. A real state and an easy one
     to create — add somebody, get called away before granting them a
     property — and it looks to them like the software is broken. */
  const stranded = active.filter(
    (s) => !s.isGroupAdmin && s.access.length === 0);

  return (
    <Page>
      <PageHeader
        title="People"
        description={
          rows.length === 0
            ? "Nobody yet."
            : `${active.length} active · `
              + `${active.filter((s) => s.isGroupAdmin).length} can reach every property`
        }
        actions={
          <Button className="h-11" onClick={() => setAdding(true)}>
            <UserPlus className="size-4" /> Add somebody
          </Button>
        }
      />

      {stranded.length > 0 && (
        <Card className="border-amber-300 bg-amber-50">
          <CardBody>
            <p className="text-sm text-ink-900 leading-relaxed">
              <span className="font-medium">
                {stranded.length === 1 ? "One person can" : `${stranded.length} people can`} sign in and see nothing
              </span>
              {" — "}
              {stranded.map((s) => s.name).join(", ")}
              {". "}
              Give them a property below. Until then the app opens empty
              for them, which reads as a fault rather than a setting.
            </p>
          </CardBody>
        </Card>
      )}

      {staff.isLoading ? (
        <Skeleton className="h-64" />
      ) : rows.length === 0 ? (
        <EmptyState
          title="Nobody has been added"
          description={
            "Add the people who work here with the email address they will "
            + "sign in with. Access is given per property, so somebody at one "
            + "hotel never sees another's guests."
          }
          action={<Button onClick={() => setAdding(true)}>Add the first</Button>}
        />
      ) : (
        <ul className="space-y-2">
          {rows.map((s) => (
            <PersonCard key={s.id} person={s}
                        onGrant={() => setGranting(s)}
                        onChanged={refresh} />
          ))}
        </ul>
      )}

      <p className="flex items-start gap-2 text-sm text-grey-500 mt-4 leading-relaxed">
        <Info className="size-3.5 shrink-0 mt-0.5" />
        <span>
          {/* ⚠ THIS SAID "ADDING SOMEBODY HERE DOES NOT SET A PASSWORD"
              and was true until 9 September. The dialog carried the same
              claim in different words and I corrected that one; this
              copy survived, because I fixed the sentence I was editing
              rather than searching for what else asserted it. Found by
              opening the screen. Two places said one thing, which is
              this project's most expensive shape. */}
          Adding somebody creates their sign-in account and sets the password
          you give. Tell it to them — nothing is emailed. The address has to be
          the one they actually use: it is what they sign in with, and a typo
          means a person who cannot get in.
        </span>
      </p>

      {adding && (
        <AddPersonDialog open onOpenChange={(o) => { if (!o) setAdding(false); }}
                         onAdded={() => { setAdding(false); refresh(); }} />
      )}
      {granting && (
        <GrantDialog person={granting} open
                     onOpenChange={(o) => { if (!o) setGranting(null); }}
                     onGranted={() => { setGranting(null); refresh(); }} />
      )}
    </Page>
  );
}

/* ── One person, and what they can reach ──────────────────────────── */

function PersonCard({ person, onGrant, onChanged }: {
  person: AdminStaff; onGrant: () => void; onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [password, setPassword] = useState(false);

  const bringBack = async () => {
    if (busy) return;
    setBusy(true);
    const res = await reactivateStaff(person.id);
    setBusy(false);
    if (!res.ok) return toast.error("Not reactivated", res.reason);
    /* ⚠ THE WARNING IS SHOWN, NOT SWALLOWED. Active with no sign-in
       account linked reaches a page that accepts nothing, and the
       server says so at the moment it becomes true. A toast that only
       said "done" would send somebody to a broken morning. */
    if (res.warning) toast.error(`${person.name} is active again`, res.warning);
    else toast.success(`${person.name} can sign in again`);
    onChanged();
  };

  const revoke = async (code: string) => {
    const res = await revokeAccess(person.id, code);
    if (!res.ok) return toast.error("Not removed", res.reason);
    onChanged();
  };

  const deactivate = async () => {
    if (busy) return;
    setBusy(true);
    const res = await deactivateStaff(person.id);
    setBusy(false);
    if (!res.ok) return toast.error("Not deactivated", res.reason);
    toast.success(
      `${person.name} can no longer sign in`,
      "Their name stays on everything they did — the audit log would be "
      + "unreadable without it.");
    onChanged();
  };

  return (
    <li>
      <Card className={cn(!person.isActive && "opacity-60")}>
        <CardBody className="space-y-2.5">
          <div className="flex items-start gap-2 flex-wrap">
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-2 flex-wrap">
                <p className="text-base font-medium text-ink-900">
                  {person.name}
                </p>
                {person.isGroupAdmin && (
                  <StatusPill tone="warning">
                    <ShieldCheck className="size-3" /> Every property
                  </StatusPill>
                )}
                {!person.isActive && (
                  <StatusPill tone="neutral">Switched off</StatusPill>
                )}
                {/* ⚠ TWO DIFFERENT THINGS WORE ONE LABEL. "Cannot sign
                    in" meant `is_active = false` — somebody deliberately
                    switched off. It said nothing about the person who is
                    active, rostered, and has no Firebase account at all,
                    which until today was EVERY person added through this
                    screen. They are the ones who walk to a terminal and
                    find out. */}
                {person.isActive && !person.canSignIn && (
                  <StatusPill tone="danger">No password yet</StatusPill>
                )}
              </div>
              <p className="text-sm text-grey-500 truncate">{person.email}</p>
            </div>

            {person.isActive ? (
              <div className="flex gap-2 flex-wrap">
                <Button variant="secondary" className="h-11" onClick={onGrant}>
                  <Building2 className="size-4" /> Give a property
                </Button>
                <Button variant="ghost" className="h-11"
                        onClick={() => setPassword(true)}>
                  {person.canSignIn ? "Password" : "Set a password"}
                </Button>
                <Button variant="ghost" className="h-11"
                        onClick={() => setEditing(true)}>
                  Edit
                </Button>
                <Button variant="secondary" className="h-11" disabled={busy}
                        onClick={() => void deactivate()}>
                  {busy ? "…" : "Deactivate"}
                </Button>
              </div>
            ) : (
              /* ⚠ THE ENDPOINT FOR THIS HAS EXISTED SINCE THE ADMIN
                 WORK AND HAD NO BUTTON. Its own comment in the route
                 file says reactivating was added because "a person
                 switched off by mistake needed somebody with database
                 access to undo it" — and then the fix was itself
                 unreachable, so they still did. */
              <Button variant="secondary" className="h-11" disabled={busy}
                      onClick={() => void bringBack()}>
                {busy ? "…" : "Bring them back"}
              </Button>
            )}
          </div>

          {person.isGroupAdmin ? (
            <p className="text-sm text-grey-600 leading-relaxed">
              A group administrator reaches every property, including ones
              added later. Property grants do not apply to them.
            </p>
          ) : person.isActive && !person.canSignIn ? (
            /* Said here rather than left to be discovered. The pill
               above is the flag; this is what to do about it. */
            <p className="text-sm text-brand-red leading-relaxed">
              No sign-in account yet — they cannot get in at all. Set a
              password and they can.
            </p>
          ) : person.access.length === 0 ? (
            /* A DASH, in the sense this project means it: no access is a
               fact worth stating, not an empty list to skip past. */
            <p className="text-sm text-grey-400">
              — no property yet, so this account opens empty
            </p>
          ) : (
            <ul className="flex flex-wrap gap-1.5">
              {person.access.map((a) => (
                <li key={a.code}
                    className="flex items-center gap-1.5 rounded-md border
                               border-grey-200 bg-grey-50 pl-2.5 pr-1 py-1">
                  <span className="text-sm text-ink-900">
                    <span className="tabular font-medium">{a.code}</span>
                    <span className="text-grey-500"> · {roleLabel(a.role)}</span>
                  </span>
                  <button
                    type="button"
                    aria-label={`Remove ${a.code} from ${person.name}`}
                    onClick={() => void revoke(a.code)}
                    className="size-7 grid place-items-center rounded
                               text-grey-400 hover:text-brand-red
                               hover:bg-red-50 cursor-pointer"
                  >
                    <X className="size-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      {editing && (
        <EditPersonDialog person={person} onClose={() => setEditing(false)}
                          onSaved={onChanged} />
      )}
      {password && (
        <PasswordDialog person={person} onClose={() => setPassword(false)}
                        onSaved={onChanged} />
      )}
    </li>
  );
}

/* ── Giving somebody a password ────────────────────────────────────
   ⚠ THIS IS THE HALF THE SYSTEM NEVER HAD. Adding somebody wrote a
   Postgres row and stopped, so they appeared on this screen with a role
   and a property and no Firebase account — no password existed anywhere
   that would let them in. The owner found it by adding a demo user and
   walking to the sign-in page.

   It is typed rather than emailed because half of a hotel's staff have
   no address they read. A system that can only invite by email cannot
   roster a housekeeper.
   ═══════════════════════════════════════════════════════════════════ */
function PasswordDialog({ person, onClose, onSaved }: {
  person: AdminStaff; onClose: () => void; onSaved: () => void;
}) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);

  const short = value.length > 0 && value.length < MIN_PASSWORD;

  const submit = async () => {
    setBusy(true);
    const res = await setStaffPassword(person.id, value);
    setBusy(false);
    /* The server's sentence. It is the one that knows whether this
       caller may touch this person — a manager may not aim at a group
       administrator, and the reason says so. */
    if (!res.ok) return toast.error("Not set", res.reason);
    toast.success(
      `${person.name} can sign in`,
      `Tell them the password and the address ${person.email}.`);
    onSaved();
    onClose();
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        title={person.canSignIn
          ? `New password for ${person.name}`
          : `Give ${person.name} a password`}
        description={person.canSignIn
          ? "Their old one stops working immediately."
          : "They have no way to sign in until this is set."}
        size="sm"
        footer={
          <>
            <Button variant="secondary" size="lg" onClick={onClose}>
              Cancel
            </Button>
            <Button size="lg" loading={busy}
                    disabled={value.length < MIN_PASSWORD}
                    onClick={() => void submit()}>
              Set it
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field
            label="Password"
            required
            hint={`At least ${MIN_PASSWORD} characters. They type it at a terminal in front of guests, so something they can remember.`}
            error={short ? `At least ${MIN_PASSWORD} characters.` : undefined}
          >
            {(f) => (
              /* ⚠ NOT type="password". The manager is setting it FOR
                 somebody else and has to read it back to them — a
                 masked box means it gets typed twice, or written on a
                 sticky note beside the terminal. */
              <Input {...fieldProps(f)} value={value} autoFocus
                     placeholder="something they will remember"
                     onChange={(e) => setValue(e.target.value)} />
            )}
          </Field>
          <p className="text-sm text-grey-600">
            They sign in with{" "}
            <span className="text-ink-900">{person.email}</span> and this
            password. Nothing is emailed — tell them yourself.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ── Correcting a name ────────────────────────────────────────────
   ⚠ THE EMAIL IS NOT HERE, and that is the route's decision as much as
   this screen's: it is how they sign in, and `PATCH /admin/staff/:id`
   accepts only the name and the phone. Offering a box that silently
   did nothing would be worse than not offering one.

   A misspelled name is not cosmetic. It is on every folio they opened,
   every discount they applied and every line of the audit trail, and
   until this dialog existed it needed a database session to fix.
   ═══════════════════════════════════════════════════════════════════ */
function EditPersonDialog({ person, onClose, onSaved }: {
  person: AdminStaff; onClose: () => void; onSaved: () => void;
}) {
  const [name, setName] = useState(person.name);
  const [phone, setPhone] = useState(person.phone ?? "");
  /* Where they start after sign-in (087). A group administrator's own is
     theirs to set from their account menu; the server refuses anyone
     else setting it, so the field is not offered for one. */
  const [home, setHome] = useState<HomeScreen>(person.homeScreen);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    const res = await amendStaff(person.id,
      { fullName: name.trim(), phone: phone.trim() });
    if (!res.ok) { setBusy(false); return toast.error("Not saved", res.reason); }
    if (!person.isGroupAdmin && home !== person.homeScreen) {
      const screen = await setHomeScreen(person.id, home);
      if (!screen.ok) { setBusy(false); return toast.error("Not saved", screen.reason); }
    }
    setBusy(false);
    toast.success(`${name.trim()} saved`);
    onSaved();
    onClose();
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        title={`Edit ${person.name}`}
        description="Their name is on everything they have done. The email is how they sign in and cannot be changed here."
        size="sm"
        footer={
          <>
            <Button variant="secondary" size="lg" onClick={onClose}>
              Cancel
            </Button>
            <Button size="lg" loading={busy} disabled={!name.trim()}
                    onClick={() => void submit()}>
              Save
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Name" required>
            {(f) => (
              <Input {...fieldProps(f)} value={name} autoFocus
                     onChange={(e) => setName(e.target.value)} />
            )}
          </Field>
          <Field label="Phone">
            {(f) => (
              <Input {...fieldProps(f)} value={phone} type="tel"
                     onChange={(e) => setPhone(e.target.value)} />
            )}
          </Field>
          {!person.isGroupAdmin && (
            <Field label="Starts on" hint="The first screen after they sign in. They can change it themselves.">
              {(f) => (
                <NativeSelect {...fieldProps(f)} value={home}
                              onChange={(e) => setHome(e.currentTarget.value as HomeScreen)}>
                  {HOME_SCREENS.map((s) => (
                    <option key={s.value} value={s.value}>{s.label}</option>
                  ))}
                </NativeSelect>
              )}
            </Field>
          )}
          <p className="text-sm text-grey-500">
            Signs in as <span className="text-ink-900">{person.email}</span>.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ── Adding somebody ──────────────────────────────────────────────── */

function AddPersonDialog({ open, onOpenChange, onAdded }: {
  open: boolean; onOpenChange: (o: boolean) => void; onAdded: () => void;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    const res = await createStaff({
      email: email.trim().toLowerCase(), name: name.trim(), password,
    });
    setBusy(false);
    if (!res.ok) return toast.error("Not added", res.reason);
    toast.success(
      res.existed ? `${name.trim()} was already here` : `${name.trim()} added`,
      "They can sign in now. Give them a property next — until then the "
      + "app opens empty for them.");
    setName(""); setEmail(""); setPassword("");
    onAdded();
  };

  const ready = name.trim() && email.trim().includes("@")
    && password.length >= MIN_PASSWORD;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Add somebody"
        /* ⚠ THIS SENTENCE USED TO BE A LIE, and it is the lie the owner
           walked into. "They can sign in as soon as this is saved" —
           and saving wrote a Postgres row and nothing else, so there
           was no account and no password anywhere in the world. It is
           true now because the password below is required. */
        description="Set them a password and they can sign in straight away. What they can SEE comes next."
        footer={
          <>
            <Button variant="secondary" className="h-11"
                    onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button className="h-11" disabled={!ready || busy}
                    onClick={() => void submit()}>
              {busy ? "Adding…" : "Add"}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="Their name" required>
            {(f) => (
              <Input {...fieldProps(f)} value={name} placeholder="Sunita Kulkarni"
                     onChange={(e) => setName(e.target.value)} />
            )}
          </Field>
          <Field
            label="The email they will sign in with" required
            hint="This is the link between the person and the account. A typo here means they cannot sign in at all."
          >
            {(f) => (
              <Input {...fieldProps(f)} type="email" value={email}
                     placeholder="sunita@fidatohotels.com"
                     onChange={(e) => setEmail(e.target.value)} />
            )}
          </Field>
          <Field
            label="A password for them" required
            hint={`At least ${MIN_PASSWORD} characters. Tell it to them — nothing is emailed.`}
            error={password.length > 0 && password.length < MIN_PASSWORD
              ? `At least ${MIN_PASSWORD} characters.` : undefined}
          >
            {/* ⚠ NOT type="password". You are setting it FOR somebody
                else and have to read it back to them. A masked box gets
                typed twice, or written on a note beside the terminal. */}
            {(f) => (
              <Input {...fieldProps(f)} value={password}
                     placeholder="something they will remember"
                     onChange={(e) => setPassword(e.target.value)} />
            )}
          </Field>
          <p className="text-sm text-grey-600 rounded-md border border-grey-200
                        bg-grey-50 p-3 leading-relaxed">
            This adds an ordinary member of staff. Somebody who should reach
            <em> every</em> property is a group administrator, and making one
            takes the provisioning key — a deliberate step, because it is the
            only role that steps outside per-property access.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ── Giving somebody a property ───────────────────────────────────── */

function GrantDialog({ person, open, onOpenChange, onGranted }: {
  person: AdminStaff; open: boolean;
  onOpenChange: (o: boolean) => void; onGranted: () => void;
}) {
  const [code, setCode] = useState("");
  const [role, setRole] = useState("front_desk");
  const [busy, setBusy] = useState(false);

  const props = useQuery({
    queryKey: ["properties-for-grant"],
    queryFn: () => listProperties(),
    enabled: open,
  });

  /* Only properties they do not already hold. Offering one they have
     invites a grant that silently replaces their role. */
  /* `Property.id` IS the three-letter code — every route in this app is
     /api/hotels/:code, and the repository carries it as `id`. Named
     `code` here because that is what a grant is against. */
  const available = (props.data ?? [])
    .map((p) => ({ code: p.id, name: p.name }))
    .filter((p) => !person.access.some((a) => a.code === p.code));

  const submit = async () => {
    if (busy || !code) return;
    setBusy(true);
    const res = await grantAccess(person.id, code, role);
    setBusy(false);
    if (!res.ok) return toast.error("Not given", res.reason);
    toast.success(`${person.name} can now work at ${code}`,
                  `As ${roleLabel(role).toLowerCase()}.`);
    setCode("");
    onGranted();
  };

  const chosen = ROLES.find((r) => r.value === role);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={`Give ${person.name} a property`}
        description="Access is per property. This is what stops one hotel seeing another's guests."
        footer={
          <>
            <Button variant="secondary" className="h-11"
                    onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button className="h-11" disabled={!code || busy}
                    onClick={() => void submit()}>
              {busy ? "Saving…" : "Give access"}
            </Button>
          </>
        }
      >
        {available.length === 0 ? (
          <EmptyState
            title="Nothing left to give"
            description={
              props.data && props.data.length > 0
                ? `${person.name} already works at every property that exists.`
                : "No properties have been set up yet."
            }
          />
        ) : (
          <div className="space-y-3">
            <Field label="Which property" required>
              {(f) => (
                <NativeSelect {...fieldProps(f)} value={code}
                              onChange={(e) => setCode(e.target.value)}>
                  <option value="">Choose…</option>
                  {available.map((p) => (
                    <option key={p.code} value={p.code}>
                      {p.code} · {p.name}
                    </option>
                  ))}
                </NativeSelect>
              )}
            </Field>
            <Field label="Doing what" required>
              {(f) => (
                <NativeSelect {...fieldProps(f)} value={role}
                              onChange={(e) => setRole(e.target.value)}>
                  {ROLES.map((r) => (
                    <option key={r.value} value={r.value}>{r.label}</option>
                  ))}
                </NativeSelect>
              )}
            </Field>
            {chosen && (
              <p className="text-sm text-grey-600 rounded-md border
                            border-grey-200 bg-grey-50 p-3 leading-relaxed">
                {chosen.what}.
              </p>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
