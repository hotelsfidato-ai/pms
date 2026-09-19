import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Sparkles, UserRound } from "lucide-react";
import { money } from "@/lib/format";
import {
  Page, PageHeader, Card, CardBody, Button, Skeleton, EmptyState, StatusPill,
  Dialog, DialogContent, Field, fieldProps, Input, toast,
  ReadFailed, readError,
} from "@/components/ui";
import { useParams } from "react-router";
import { useUi } from "@/lib/ui";
import {
  getTreatments, getTherapists, addTreatment, changeTreatment,
  addTherapist, changeTherapist, type SpaTreatment, type SpaTherapist,
} from "@/modules/spa/data/spa";

/* ══════════════════════════════════════════════════════════════════
   TREATMENTS AND THERAPISTS

   What this property sells, and who gives it. Set by the owner, an
   administrator or the general manager (D18-8); reception books from
   it and does not change it.

   NO TREATMENT IS SHIPPED and NO PRICE IS INVENTED. A property with a
   spa has somebody enter its list, exactly as rooms are entered, and
   the price box may be left EMPTY — which is not zero. An unpriced
   treatment reads "-", it may still be booked (the guest asked for it),
   and it cannot be closed for money until somebody types a figure.

   A THERAPIST IS A NAME, NOT AN ACCOUNT (D18-8). Nobody here signs in.
   The list exists because the guard is "this person is already busy",
   and that question cannot be asked of a string somebody typed twice.

   NOTHING IS DELETED. A treatment or a therapist leaves by being taken
   off the list, so a booking that already happened still names what it
   was and who gave it.
   ══════════════════════════════════════════════════════════════════ */

function useHotel(): string {
  const params = useParams();
  const fallback = useUi((s) => s.hotelId);
  return params["code"] ?? fallback;
}

export default function SpaSetupPage() {
  const code = useHotel();
  const [addingTreatment, setAddingTreatment] = useState(false);
  const [editing, setEditing] = useState<SpaTreatment | null>(null);
  const [addingTherapist, setAddingTherapist] = useState(false);

  const treatments = useQuery({
    queryKey: ["spa", "treatments", code],
    queryFn: () => getTreatments(code),
    enabled: !!code,
  });
  const therapists = useQuery({
    queryKey: ["spa", "therapists", code],
    queryFn: () => getTherapists(code),
    enabled: !!code,
  });

  return (
    <Page>
      <PageHeader
        title="Treatments and therapists"
        description={
          "What this property's spa sells, how long each takes and what it "
          + "costs — and who gives them."
        }
      />

      <Card className="mb-4">
        <CardBody className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-base font-medium">Treatments</p>
            <Button variant="primary" className="h-11"
                    onClick={() => setAddingTreatment(true)}>
              <Plus className="size-4" /> Add a treatment
            </Button>
          </div>

          {/* A read that failed says so. It never draws "nothing on the
              list yet", which at a property with thirty treatments is a
              lie somebody would act on. */}
          {treatments.isLoading ? <Skeleton className="h-24" />
            : !treatments.data ? (
              <ReadFailed error={readError(treatments)} what="the treatments"
                          onRetry={() => void treatments.refetch()} />
            ) : treatments.data.length === 0 ? (
              <EmptyState
                compact icon={<Sparkles />}
                title="Nothing on the list yet"
                description={
                  "Nothing is created for you. Enter what this spa sells, how "
                  + "long each takes, and the price where one has been set."
                }
              />
            ) : (
              <ul className="space-y-2">
                {treatments.data.map((t) => (
                  <li key={t.id}
                      className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1
                                 rounded-lg border border-grey-200 px-3 py-2.5">
                    <span className="min-w-0">
                      <span className="font-medium">{t.name}</span>
                      <span className="text-sm text-grey-500"> · {t.minutes} min</span>
                      {!t.isActive && (
                        <StatusPill tone="neutral" className="ml-2">Off the list</StatusPill>
                      )}
                    </span>
                    <span className="flex items-center gap-3">
                      {/* THE DASH, and never ₹0. A treatment shown as free
                          is worse than one shown as unpriced. */}
                      <span className={t.price === null
                        ? "text-grey-500" : "tabular-nums font-medium"}>
                        {t.price === null ? "-" : money(t.price)}
                      </span>
                      <Button variant="secondary" size="sm"
                              onClick={() => setEditing(t)}>
                        Change
                      </Button>
                    </span>
                  </li>
                ))}
              </ul>
            )}

          <p className="text-sm text-grey-500">
            Leave the price empty where none has been set. It reads "-", never
            ₹0, and the treatment cannot be closed for money until it has one.
          </p>
        </CardBody>
      </Card>

      <Card>
        <CardBody className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-base font-medium">Therapists</p>
            <Button variant="secondary" className="h-11"
                    onClick={() => setAddingTherapist(true)}>
              <Plus className="size-4" /> Add a therapist
            </Button>
          </div>

          {therapists.isLoading ? <Skeleton className="h-24" />
            : !therapists.data ? (
              <ReadFailed error={readError(therapists)} what="the therapists"
                          onRetry={() => void therapists.refetch()} />
            ) : therapists.data.length === 0 ? (
              <EmptyState
                compact icon={<UserRound />}
                title="Nobody on the list yet"
                description={
                  "A name, not an account — nobody here signs in. The diary "
                  + "books against these names, which is how it can refuse to "
                  + "put one person in two places at once."
                }
              />
            ) : (
              <ul className="space-y-2">
                {therapists.data.map((t) => (
                  <li key={t.id}
                      className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1
                                 rounded-lg border border-grey-200 px-3 py-2.5">
                    <span>
                      <span className="font-medium">{t.name}</span>
                      {!t.isActive && (
                        <StatusPill tone="neutral" className="ml-2">
                          Not taking appointments
                        </StatusPill>
                      )}
                    </span>
                    <TherapistToggle code={code} therapist={t} />
                  </li>
                ))}
              </ul>
            )}
        </CardBody>
      </Card>

      {addingTreatment && (
        <TreatmentDialog code={code} onClose={() => setAddingTreatment(false)} />
      )}
      {editing && (
        <TreatmentDialog code={code} treatment={editing}
                         onClose={() => setEditing(null)} />
      )}
      {addingTherapist && (
        <TherapistDialog code={code} onClose={() => setAddingTherapist(false)} />
      )}
    </Page>
  );
}

/** Somebody leaves, or comes back. Their past appointments stay exactly
    as they were — nothing is deleted here. */
function TherapistToggle({ code, therapist }: { code: string; therapist: SpaTherapist }) {
  const qc = useQueryClient();
  const [saving, setSaving] = useState(false);

  const flip = async () => {
    setSaving(true);
    const out = await changeTherapist(code, therapist.id, { isActive: !therapist.isActive });
    setSaving(false);
    if (!out.ok) { toast.error(out.reason); return; }
    void qc.invalidateQueries({ queryKey: ["spa", "therapists", code] });
  };

  return (
    <Button variant="secondary" size="sm" loading={saving} onClick={() => void flip()}>
      {therapist.isActive ? "Take off the list" : "Put back on the list"}
    </Button>
  );
}

/* ── One dialog, adding and changing ──────────────────────────────
   The fields are the same three, so two dialogs would be two places to
   forget that an empty price means unpriced. ═══════════════════════ */

function TreatmentDialog({
  code, treatment, onClose,
}: {
  code: string; treatment?: SpaTreatment; onClose: () => void;
}) {
  const qc = useQueryClient();
  const [name, setName] = useState(treatment?.name ?? "");
  const [minutes, setMinutes] = useState(treatment ? String(treatment.minutes) : "");
  /* EMPTY IS UNPRICED, both ways: an unpriced treatment opens with an
     empty box, and emptying a priced one's box takes it back to
     unpriced rather than to zero. */
  const [price, setPrice] = useState(
    treatment?.price === null || treatment?.price === undefined ? "" : String(treatment.price));
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const submit = async () => {
    setProblem(null);
    if (!name.trim()) { setProblem("A treatment needs a name."); return; }
    if (!minutes.trim() || Number(minutes) <= 0) {
      setProblem("How long does it take? The diary places a booking by its length.");
      return;
    }
    if (price.trim() !== "" && !(Number(price) >= 0)) {
      setProblem("A price is a figure, and it cannot be less than nothing.");
      return;
    }

    setSaving(true);
    const asked = {
      name: name.trim(),
      minutes: Number(minutes),
      price: price.trim() === "" ? null : Number(price),
    };
    const out = treatment
      ? await changeTreatment(code, treatment.id, asked)
      : await addTreatment(code, asked);
    setSaving(false);
    if (!out.ok) { setProblem(out.reason); return; }

    void qc.invalidateQueries({ queryKey: ["spa", "treatments", code] });
    onClose();
    toast.success(treatment ? `${asked.name} is changed.` : `${asked.name} is on the list.`);
  };

  const retire = async () => {
    if (!treatment) return;
    setSaving(true);
    const out = await changeTreatment(code, treatment.id, { isActive: !treatment.isActive });
    setSaving(false);
    if (!out.ok) { setProblem(out.reason); return; }
    void qc.invalidateQueries({ queryKey: ["spa", "treatments", code] });
    onClose();
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent title={treatment ? "Change a treatment" : "Add a treatment"}
                     className="max-w-md">
        <div className="space-y-4">
          <Field label="Name">
            {(p) => (
              <Input {...fieldProps(p)} value={name}
                     onChange={(e) => setName(e.target.value)}
                     placeholder="Aromatherapy massage" />
            )}
          </Field>

          <Field label="How long, in minutes"
                 hint="The diary places a booking by its length, so a treatment with no length cannot be put in a day.">
            {(p) => (
              <Input {...fieldProps(p)} inputMode="numeric" value={minutes}
                     onChange={(e) => setMinutes(e.target.value)}
                     placeholder="60" />
            )}
          </Field>

          <Field label="Price"
                 hint="Leave it empty where none has been set. Empty reads as a dash, never as ₹0.">
            {(p) => (
              <Input {...fieldProps(p)} inputMode="decimal" value={price}
                     onChange={(e) => setPrice(e.target.value)}
                     placeholder="Not priced yet" />
            )}
          </Field>

          {problem && (
            <p role="alert" className="text-sm text-brand-red">{problem}</p>
          )}

          <div className="flex flex-wrap justify-end gap-2">
            {treatment && (
              <Button variant="ghost" className="mr-auto" onClick={() => void retire()}>
                {treatment.isActive ? "Take off the list" : "Put back on the list"}
              </Button>
            )}
            <Button variant="secondary" onClick={onClose}>Cancel</Button>
            <Button variant="primary" loading={saving} onClick={() => void submit()}>
              {treatment ? "Save" : "Add it"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function TherapistDialog({ code, onClose }: { code: string; onClose: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const submit = async () => {
    setProblem(null);
    if (!name.trim()) { setProblem("A therapist needs a name."); return; }
    setSaving(true);
    const out = await addTherapist(code, name.trim());
    setSaving(false);
    if (!out.ok) { setProblem(out.reason); return; }
    void qc.invalidateQueries({ queryKey: ["spa", "therapists", code] });
    onClose();
    toast.success(`${name.trim()} is on the list.`);
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent title="Add a therapist" className="max-w-md">
        <div className="space-y-4">
          <Field label="Name"
                 hint="A name the diary books against — not an account. Nobody here signs in.">
            {(p) => (
              <Input {...fieldProps(p)} value={name}
                     onChange={(e) => setName(e.target.value)}
                     placeholder="Priya" />
            )}
          </Field>

          {problem && (
            <p role="alert" className="text-sm text-brand-red">{problem}</p>
          )}

          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={onClose}>Cancel</Button>
            <Button variant="primary" loading={saving} onClick={() => void submit()}>
              Add them
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
