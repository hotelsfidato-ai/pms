import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams, Link } from "react-router";
import { ArrowLeft, UserPlus, KeyRound, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/cn";
import { money } from "@/lib/format";
import { ROLE_LABELS, can, type Role } from "@/lib/permissions";
import { useRole } from "@/lib/session";
import {
  Page, PageHeader, Card, CardBody, Button, Skeleton, EmptyState, toast,
  Dialog, DialogContent, Field, fieldProps, Input, NativeSelect, StatusPill,
} from "@/components/ui";
import { getPropertyDetail, createStaff, revokeAccess, setStaffPassword, setHomeScreen, setFssai, MIN_PASSWORD, type PropertyTeamMember, type HomeScreen } from "@/modules/admin/data/admin";
import { getTodaySnapshot, getPeriodStatistics } from "@/modules/reports";
import { getHouseNow } from "@/modules/front-desk";
import { HOME_SCREENS, homeScreenLabel } from "@/lib/homeScreen";
import { ConfirmRemoveAccess } from "@/modules/admin/flows/ConfirmRemoveAccess";
import { placeLine } from "@/modules/finance";

/* The GM setting where somebody starts after sign-in (087). */
async function startOn(
  person: PropertyTeamMember, next: HomeScreen, refresh: () => void,
) {
  if (next === person.homeScreen) return;
  const result = await setHomeScreen(person.id, next);
  if (!result.ok) return toast.error("Not changed", result.reason);
  toast.success(`${person.name} starts on ${homeScreenLabel(next)}`,
    "From their next sign-in. They can change it themselves.");
  refresh();
}

/* ══════════════════════════════════════════════════════════════════
   ONE PROPERTY

   The owner's instruction on 9 September: the property view shows the
   property's own numbers and the people who work there, and the
   manager of that hotel manages that team.

   ⚠ WHO SEES THIS IS THE HOTEL'S QUESTION, NOT THE CALLER'S RANK. The
   group list carries the GSTIN and contact details of every property —
   which migration 031 exists to stop leaking to a clerk at one hotel.
   A general manager needs exactly this detail for THEIR hotel and must
   not get it for anybody else's, so the endpoint behind this screen is
   scoped by hotel and answers 404 for one you do not run.

   THE PICKER OFFERS WHAT THE SERVER WILL ACCEPT. `grantableRoles`
   comes back with the property: an owner sees every role, a general
   manager sees everything but `owner` — because a manager who could
   appoint an owner could appoint themselves one. Offering a role and
   then refusing it is how 078 happened.

   NO NUMBER IS INVENTED. An unpriced or unmeasured figure renders as a
   dash. The statistics come from the endpoints that already answer
   them rather than from a second implementation here.
   ══════════════════════════════════════════════════════════════════ */

export default function PropertyPage() {
  const params = useParams();
  const code = (params["code"] ?? "").toUpperCase();
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [password, setPassword] = useState<PropertyTeamMember | null>(null);
  /* D27-117: Remove asks first. */
  const [taking, setTaking] = useState<PropertyTeamMember | null>(null);

  const detail = useQuery({
    queryKey: ["property-detail", code],
    queryFn: () => getPropertyDetail(code),
  });

  /* The property's OWN business date — two hotels are routinely on
     different days, one having run its night audit and the other not.
     The endpoint defaults to that property's, which is why no date is
     passed here. */
  const today = useQuery({
    queryKey: ["property-today", code],
    queryFn: () => getTodaySnapshot(code),
  });
  /* In house and Empty are the one rule the Dashboard and Rooms read
     (D21-36, D21-37). This page printed its own: every checked-in booking,
     and "not sold tonight" - 11 and 9 where the Dashboard said 10 and 7. */
  const house = useQuery({
    queryKey: ["house-now", code],
    queryFn: () => getHouseNow(code),
  });
  const period = useQuery({
    queryKey: ["property-period", code],
    queryFn: () => getPeriodStatistics(code),
  });

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["property-detail", code] });
    void qc.invalidateQueries({ queryKey: ["people"] });
  };

  if (detail.isLoading) {
    return (
      <Page className="max-w-5xl">
        <PageHeader title={code} description="Loading…" />
        <Skeleton className="h-64" />
      </Page>
    );
  }

  if (!detail.data) {
    return (
      <Page className="max-w-5xl">
        <PageHeader title={code} />
        <EmptyState
          title="This property is not yours to manage"
          description={
            "You can see a property here if you are its manager, or a group "
            + "administrator. Nothing was changed."
          }
          /* One element: a link drawn as the button it is. */
          action={<Button asChild><Link to="/properties">Back to properties</Link></Button>}
        />
      </Page>
    );
  }

  const { property, staff, grantableRoles } = detail.data;
  const team = staff.filter((p) => p.isActive);

  return (
    <Page className="max-w-5xl">
      {/* A text link is orange (the Tappable Rule), as Invoice's is. */}
      <Link to="/properties"
            className="inline-flex items-center gap-1.5 min-h-9 pointer-coarse:min-h-11 mb-1
                       text-sm font-medium text-brand-orange-700 hover:underline underline-offset-4">
        <ArrowLeft className="size-4" /> Properties
      </Link>

      <PageHeader
        title={property.name}
        description={
          placeLine(property.addressLine, property.city, property.state) || property.code
        }
        badge={
          property.isActive
            ? <StatusPill tone="neutral">{property.code}</StatusPill>
            : <StatusPill tone="danger">Closed</StatusPill>
        }
        actions={
          grantableRoles.length > 0 && (
            <Button variant="primary" onClick={() => setAdding(true)}>
              <UserPlus className="size-4" /> Add somebody here
            </Button>
          )
        }
      />

      {/* ── Today ─────────────────────────────────────────────── */}
      {/* The figures level across each card (the Level Rule): every one
          spans two rows of the card's grid, so a label on two lines never
          pushes its figure below its neighbours'. Cards 12px apart. */}
      <Card className="mb-3">
        <CardBody className={FIGURES}>
          <Figure label="Rooms sold today"
                  value={today.data ? String(today.data.sold) : null} />
          <Figure label="Occupancy"
                  value={today.data ? `${today.data.occupancyPct}%` : null} />
          <Figure label="Empty"
                  value={house.data ? String(house.data.empty) : null} />
          <Figure label="In house now"
                  value={house.data ? String(house.data.inHouse) : null} />
        </CardBody>
      </Card>

      <Card className="mb-3">
        <CardBody className={FIGURES}>
          {/* Period to date, from the property's own audit. A dash when
              the period has no closed days yet — which is the ordinary
              state of a property in its first week, and reads better
              than a confident zero. */}
          <Figure label="Room revenue, month to date"
                  value={period.data ? money(period.data.roomRevenue) : null} />
          <Figure label="Average rate"
                  value={period.data ? money(period.data.adr) : null} />
          <Figure label="RevPAR"
                  value={period.data ? money(period.data.revpar) : null} />
          <Figure label="Rooms" value={
            property.rooms === 0 ? null : String(property.rooms)} />
        </CardBody>
      </Card>

      <FssaiCard code={property.code} value={property.fssaiNumber} onSaved={refresh} />

      {/* ── The team ──────────────────────────────────────────── */}
      <section>
        <h2 className="text-md font-semibold text-ink-900 mb-3">
          Who works here
        </h2>

        {team.length === 0 ? (
          <EmptyState
            title="Nobody is rostered here yet"
            description={
              "Somebody added here can sign in straight away and sees this "
              + "property only."
            }
            action={grantableRoles.length > 0
              ? <Button onClick={() => setAdding(true)}>Add the first</Button>
              : undefined}
          />
        ) : (
          <Card>
            {/* List rows. On a phone a row stacks: the person on its own
                line, their role and controls wrapping under it, so the
                page never scrolls sideways (it did at 390px). */}
            <ul className="divide-y divide-grey-100">
              {team.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 min-h-14">
                  <div className="min-w-0 basis-full sm:basis-0 sm:flex-1">
                    <div className="flex items-baseline gap-2 flex-wrap">
                      <p className="text-base font-medium text-ink-900">
                        {p.name}
                      </p>
                      {p.isGroupAdmin && (
                        <StatusPill tone="warning">
                          <ShieldCheck className="size-3" /> Every property
                        </StatusPill>
                      )}
                      {/* ⚠ THE STATE NOBODY COULD SEE. Rostered, with a
                          role, and no Firebase account — so they reach
                          a sign-in page that will never accept them.
                          Until the API created accounts this was every
                          person added through a screen. */}
                      {!p.canSignIn && (
                        <StatusPill tone="danger">No password yet</StatusPill>
                      )}
                    </div>
                    <p className="text-sm text-grey-500 truncate">
                      {p.email}
                    </p>
                  </div>

                  <span className="text-sm text-grey-600 shrink-0">
                    {label(p.role)}
                  </span>

                  {/* WHERE THEY START (087). The owner's decision of 14
                      September: the GM sets it per person, and the
                      person can change their own from their account
                      menu. Offered only where the server would accept
                      it — a manager here, never on a group admin. */}
                  {grantableRoles.length > 0 && !p.isGroupAdmin && (
                    <label className="flex items-center gap-1.5 shrink-0 text-sm text-grey-600">
                      <span className="hidden sm:inline">Starts on</span>
                      <NativeSelect
                        aria-label={`${p.name} starts on`}
                        value={p.homeScreen}
                        onChange={(e) => void startOn(
                          p, e.currentTarget.value as HomeScreen, refresh)}
                        className="w-auto"
                      >
                        {HOME_SCREENS.map((s) => (
                          <option key={s.value} value={s.value}>{s.label}</option>
                        ))}
                      </NativeSelect>
                    </label>
                  )}

                  {grantableRoles.length > 0 && !p.isGroupAdmin && (
                    <div className="flex gap-1.5 shrink-0 max-sm:ml-auto">
                      <Button variant="ghost" size="icon"
                              onClick={() => setPassword(p)}>
                        <KeyRound className="size-4" />
                        <span className="sr-only">
                          Set a password for {p.name}
                        </span>
                      </Button>
                      <Button variant="ghost"
                              onClick={() => setTaking(p)}>
                        Remove
                      </Button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </Card>
        )}
      </section>

      {adding && (
        <AddHereDialog code={code} roles={grantableRoles}
                       onClose={() => setAdding(false)} onSaved={refresh} />
      )}
      {password && (
        <SetPasswordDialog person={password}
                           onClose={() => setPassword(null)} onSaved={refresh} />
      )}
      {taking && (
        <ConfirmRemoveAccess name={taking.name} code={code}
                             onCancel={() => setTaking(null)}
                             onRemove={() => remove(taking, code, () => { setTaking(null); refresh(); })} />
      )}
    </Page>
  );
}

/* ⚠ ROLE_LABELS IS THE ONE LIST, from `src/lib/permissions.ts` — the
   same module 078 made agree with the database. Falling back to the
   raw code rather than to a guess: a role the interface has not heard
   of is a real possibility the day somebody adds one to the constraint
   first, and printing `night_auditor` is honest where printing
   "Unknown" is not. */
const label = (role: string) => ROLE_LABELS[role as Role] ?? role;

/** A number, or a dash. Never a zero standing in for "not measured". */
/* A16 (the owner, 26 September): printed on every restaurant bill and on a
   stay's tax invoice that carries food; a dash until typed. Offered to the
   owner, an administrator and the GM - who the server lets set it (the
   role gate's room-setup grant). */
function FssaiCard({ code, value, onSaved }: {
  code: string; value: string | null; onSaved: () => void;
}) {
  const mayEdit = can(useRole(), "edit", "room_config");
  const [typed, setTyped] = useState<string | null>(null);
  const save = async () => {
    const res = await setFssai(code, typed ?? "");
    if (!res.ok) return toast.error("Not saved", res.reason);
    toast.success("FSSAI licence number saved", "It prints on food bills from now on.");
    setTyped(null);
    onSaved();
  };
  return (
    <Card className="mb-5">
      <CardBody className="flex flex-wrap items-end gap-3">
        {typed === null ? (
          <>
            <Figure label="FSSAI licence number" value={value} />
            {mayEdit && (
              <Button variant="secondary" onClick={() => setTyped(value ?? "")}>Change</Button>
            )}
          </>
        ) : (
          <>
            <Field label="FSSAI licence number" hint="14 digits, from the licence. Blank for none.">
              {(f) => (
                <Input {...fieldProps(f)} value={typed} autoFocus inputMode="numeric"
                  maxLength={20} onChange={(e) => setTyped(e.target.value)} />
              )}
            </Field>
            <Button variant="primary" onClick={() => void save()}>Save</Button>
            <Button variant="ghost" onClick={() => setTyped(null)}>Cancel</Button>
          </>
        )}
      </CardBody>
    </Card>
  );
}

/* Four across on a desktop, two on a phone; each figure two rows of it. */
const FIGURES = "grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-4";

/* The Figure Rule: the label, then the figure on the ladder (24, 20 on a
   phone). The label and the figure stay siblings: the FSSAI test reads
   the one after the other. */
function Figure({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="row-span-2 grid grid-rows-subgrid gap-y-0.5 min-w-0">
      <p className="text-sm font-medium text-grey-600">{label}</p>
      <p className={cn("self-end text-xl sm:text-2xl font-semibold tabular tracking-[-0.022em]",
                       value === null ? "text-grey-500" : "text-ink-900")}>
        {value ?? "-"}
      </p>
    </div>
  );
}

async function remove(
  p: PropertyTeamMember, code: string, onDone: () => void,
) {
  const res = await revokeAccess(p.id, code);
  if (!res.ok) return toast.error("Not removed", res.reason);
  toast.success(
    `${p.name} no longer works here`,
    "Their account still exists and their name stays on everything they did.");
  onDone();
}

/* ── Adding somebody at this property ──────────────────────────────
   One act: the person, their password and their role here. Split into
   three screens it becomes three chances to stop halfway, and somebody
   stopped halfway is somebody who can sign in and see nothing.
   ═══════════════════════════════════════════════════════════════════ */
function AddHereDialog({ code, roles, onClose, onSaved }: {
  code: string; roles: string[]; onClose: () => void; onSaved: () => void;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState(roles[0] ?? "");
  const [busy, setBusy] = useState(false);

  const ready = name.trim() && email.includes("@")
    && password.length >= MIN_PASSWORD && role;

  const submit = async () => {
    setBusy(true);
    const res = await createStaff({
      email: email.trim().toLowerCase(), name: name.trim(),
      password, hotelCode: code, role,
    });
    setBusy(false);
    if (!res.ok) return toast.error("Not added", res.reason);
    toast.success(
      `${name.trim()} can sign in`,
      `Tell them the password and the address ${email.trim().toLowerCase()}.`);
    onSaved();
    onClose();
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        title={`Add somebody at ${code}`}
        description="They can sign in straight away, and they see this property only."
        footer={
          <>
            <Button variant="secondary" size="lg" onClick={onClose}>
              Cancel
            </Button>
            <Button variant="primary" size="lg" loading={busy} disabled={!ready}
                    onClick={() => void submit()}>
              Add
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="Their name" required>
            {(f) => (
              <Input {...fieldProps(f)} value={name} autoFocus
                     placeholder="Sunita Kulkarni"
                     onChange={(e) => setName(e.target.value)} />
            )}
          </Field>
          <Field label="The email they sign in with" required
                 hint="A typo here means they cannot sign in at all.">
            {(f) => (
              <Input {...fieldProps(f)} value={email} type="email"
                     placeholder="sunita@fidatohotels.com"
                     onChange={(e) => setEmail(e.target.value)} />
            )}
          </Field>
          <Field
            label="A password for them" required
            hint={`At least ${MIN_PASSWORD} characters. Tell it to them - nothing is emailed.`}
            error={password.length > 0 && password.length < MIN_PASSWORD
              ? `At least ${MIN_PASSWORD} characters.` : undefined}
          >
            {/* Not masked: you are setting it FOR them and have to read
                it back. A masked box gets written on a sticky note. */}
            {(f) => (
              <Input {...fieldProps(f)} value={password}
                     placeholder="something they will remember"
                     onChange={(e) => setPassword(e.target.value)} />
            )}
          </Field>
          <Field label="What they do here" required>
            {(f) => (
              <NativeSelect {...fieldProps(f)} value={role}
                            onChange={(e) => setRole(e.target.value)}>
                {roles.map((r) => (
                  <option key={r} value={r}>{label(r)}</option>
                ))}
              </NativeSelect>
            )}
          </Field>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function SetPasswordDialog({ person, onClose, onSaved }: {
  person: PropertyTeamMember; onClose: () => void; onSaved: () => void;
}) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    const res = await setStaffPassword(person.id, value);
    setBusy(false);
    if (!res.ok) return toast.error("Not set", res.reason);
    toast.success(`${person.name} can sign in`,
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
            <Button variant="primary" size="lg" loading={busy}
                    disabled={value.length < MIN_PASSWORD}
                    onClick={() => void submit()}>
              Set it
            </Button>
          </>
        }
      >
        <Field
          label="Password" required
          hint={`At least ${MIN_PASSWORD} characters.`}
        >
          {(f) => (
            <Input {...fieldProps(f)} value={value} autoFocus
                   placeholder="something they will remember"
                   onChange={(e) => setValue(e.target.value)} />
          )}
        </Field>
      </DialogContent>
    </Dialog>
  );
}
