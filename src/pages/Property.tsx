import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams, Link } from "react-router";
import { ArrowLeft, UserPlus, KeyRound, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/cn";
import { money } from "@/lib/format";
import { ROLE_LABELS, type Role } from "@/lib/permissions";
import {
  Page, PageHeader, Card, CardBody, Button, Skeleton, EmptyState, toast,
  Dialog, DialogContent, Field, fieldProps, Input, NativeSelect, StatusPill,
} from "@/components/ui";
import {
  getPropertyDetail, getTodaySnapshot, getPeriodStatistics,
  createStaff, revokeAccess, setStaffPassword, setHomeScreen, MIN_PASSWORD,
  type PropertyTeamMember, type HomeScreen,
} from "@/data/repositories";
import { HOME_SCREENS, homeScreenLabel } from "@/lib/homeScreen";

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
          action={<Link to="/properties"><Button>Back to properties</Button></Link>}
        />
      </Page>
    );
  }

  const { property, staff, grantableRoles } = detail.data;
  const team = staff.filter((p) => p.isActive);

  return (
    <Page className="max-w-5xl">
      <Link to="/properties"
            className="inline-flex items-center gap-1.5 text-sm text-grey-600
                       hover:text-ink-900 mb-2">
        <ArrowLeft className="size-3.5" /> Properties
      </Link>

      <PageHeader
        title={property.name}
        description={
          [property.addressLine, property.city, property.state]
            .filter(Boolean).join(", ") || property.code
        }
        badge={
          property.isActive
            ? <StatusPill tone="neutral">{property.code}</StatusPill>
            : <StatusPill tone="danger">Closed</StatusPill>
        }
        actions={
          grantableRoles.length > 0 && (
            <Button variant="primary" className="h-11" onClick={() => setAdding(true)}>
              <UserPlus className="size-4" /> Add somebody here
            </Button>
          )
        }
      />

      {/* ── Today ─────────────────────────────────────────────── */}
      <Card className="mb-5">
        <CardBody className="grid gap-x-8 gap-y-4 grid-cols-2 @md:grid-cols-4">
          <Figure label="Rooms sold today"
                  value={today.data ? String(today.data.sold) : null} />
          <Figure label="Occupancy"
                  value={today.data ? `${today.data.occupancyPct}%` : null} />
          <Figure label="Vacant"
                  value={today.data ? String(today.data.vacant) : null} />
          <Figure label="In house now"
                  value={String(property.checkedIn)} />
        </CardBody>
      </Card>

      <Card className="mb-5">
        <CardBody className="grid gap-x-8 gap-y-4 grid-cols-2 @md:grid-cols-4">
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

      {/* ── The team ──────────────────────────────────────────── */}
      <section>
        <h2 className="text-md font-semibold text-ink-900 mb-2.5">
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
            <CardBody>
              <ul className="divide-y divide-grey-100">
                {team.map((p) => (
                  <li key={p.id} className="flex items-center gap-3 py-3 first:pt-0">
                    <div className="min-w-0 flex-1">
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
                      <div className="flex gap-1.5 shrink-0">
                        <Button variant="ghost" className="h-11"
                                onClick={() => setPassword(p)}>
                          <KeyRound className="size-4" />
                          <span className="sr-only">
                            Set a password for {p.name}
                          </span>
                        </Button>
                        <Button variant="ghost" className="h-11"
                                onClick={() => void remove(p, code, refresh)}>
                          Remove
                        </Button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </CardBody>
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
function Figure({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <p className="text-sm text-grey-500">{label}</p>
      <p className={cn("text-lg font-semibold tabular",
                       value === null ? "text-grey-400" : "text-ink-900")}>
        {value ?? "—"}
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
            hint={`At least ${MIN_PASSWORD} characters. Tell it to them — nothing is emailed.`}
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
