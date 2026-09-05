import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { UserPlus, X, ShieldCheck, Building2, Info } from "lucide-react";
import { cn } from "@/lib/cn";
import {
  Page, PageHeader, Card, CardBody, Button, Skeleton, EmptyState,
  Dialog, DialogContent, Field, fieldProps, Input, NativeSelect,
  StatusPill, toast,
} from "@/components/ui";
import {
  listAdminStaff, createStaff, grantAccess, revokeAccess, deactivateStaff,
  listProperties, type AdminStaff,
} from "@/data/repositories";

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

const ROLES: { value: string; label: string; what: string }[] = [
  { value: "front_desk",   label: "Front desk",   what: "Bookings, check-in, folios, the cash drawer" },
  { value: "housekeeping", label: "Housekeeping", what: "Room status and work orders" },
  { value: "pos",          label: "Restaurant",   what: "The till, orders and the day end" },
  { value: "gm",           label: "Manager",      what: "Everything at this property, and the night audit" },
  { value: "owner",        label: "Owner",        what: "As the manager, plus the property's own settings" },
  { value: "finance",      label: "Accounts",     what: "Invoices, the city ledger and the reports" },
  { value: "stores",       label: "Stores",       what: "Inventory and purchasing" },
  { value: "read_only",    label: "Read only",    what: "Can look, cannot change anything" },
];

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
          Adding somebody here does not set a password. It records that this
          address belongs to a member of staff; the account is linked the first
          time they sign in with it. So the address has to be the one they
          actually use.
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
                  <StatusPill tone="neutral">Cannot sign in</StatusPill>
                )}
              </div>
              <p className="text-sm text-grey-500 truncate">{person.email}</p>
            </div>

            {person.isActive && (
              <div className="flex gap-2">
                <Button variant="secondary" className="h-11" onClick={onGrant}>
                  <Building2 className="size-4" /> Give a property
                </Button>
                <Button variant="secondary" className="h-11" disabled={busy}
                        onClick={() => void deactivate()}>
                  {busy ? "…" : "Deactivate"}
                </Button>
              </div>
            )}
          </div>

          {person.isGroupAdmin ? (
            <p className="text-sm text-grey-600 leading-relaxed">
              A group administrator reaches every property, including ones
              added later. Property grants do not apply to them.
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
    </li>
  );
}

/* ── Adding somebody ──────────────────────────────────────────────── */

function AddPersonDialog({ open, onOpenChange, onAdded }: {
  open: boolean; onOpenChange: (o: boolean) => void; onAdded: () => void;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    const res = await createStaff({
      email: email.trim().toLowerCase(), name: name.trim(),
    });
    setBusy(false);
    if (!res.ok) return toast.error("Not added", res.reason);
    toast.success(
      res.existed ? `${name.trim()} was already here` : `${name.trim()} added`,
      "Give them a property next — until then they sign in to an empty app.");
    setName(""); setEmail("");
    onAdded();
  };

  const ready = name.trim() && email.trim().includes("@");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Add somebody"
        description="They can sign in as soon as this is saved. What they can see comes next."
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
            hint="This is the link between the person and the account. A typo here means they cannot sign in at all — there is no password to fall back on."
          >
            {(f) => (
              <Input {...fieldProps(f)} type="email" value={email}
                     placeholder="sunita@fidatohotels.com"
                     onChange={(e) => setEmail(e.target.value)} />
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
