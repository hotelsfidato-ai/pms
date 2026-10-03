import { useState } from "react";
import { Link } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronRight } from "lucide-react";
import { Button, Card, CardBody, Field, fieldProps, Input, Page, PageHeader, Skeleton, toast } from "@/components/ui";
import { can } from "@/lib/permissions";
import { useRole } from "@/lib/session";
import { useUi } from "@/lib/ui";
import { getPropertyDetail } from "@/modules/admin/data/admin";
import { POLICY_TEXTS, PROFILE_KEY, getProfile, saveChildAges } from "@/modules/admin/data/property";
import { HousePoliciesCard } from "@/modules/admin/components/VoucherSettings";
import { SettingHeader } from "@/modules/admin/pages/Admin";
import { TextEditor } from "./TextEditor";

/* ══════════════════════════════════════════════════════════════════
   POLICIES (the owner's D27-257): ONE page for the house policies, the
   three policy texts, the child ages and the way to the cancellation terms.
   The child ages are WORDS ONLY: shown to the desk and the guests, read by
   no price - the desk counts children as it does today.
   ══════════════════════════════════════════════════════════════════ */

export default function Policies() {
  const code = useUi((s) => s.hotelId);
  const qc = useQueryClient();
  const profile = useQuery({ queryKey: PROFILE_KEY(code), queryFn: () => getProfile(code), enabled: Boolean(code) });
  const detail = useQuery({ queryKey: ["property-detail", code], queryFn: () => getPropertyDetail(code), enabled: Boolean(code) });
  const property = detail.data?.property;

  return (
    <Page>
      <PageHeader title="Policies" description="What the hotel asks of its guests, in the words they read." />
      <div className="flex flex-col gap-3">
        {property ? (
          <HousePoliciesCard hotelCode={code} policies={property.housePolicies ?? []}
            onSaved={() => void qc.invalidateQueries({ queryKey: ["property-detail", code] })} />
        ) : <Skeleton className="h-32 w-full" />}

        <Card>
          <SettingHeader title="Policy texts" line="Parking, families and the terms of a reservation, as the hotel puts them." />
          <CardBody className="flex flex-col gap-6">
            {profile.isLoading ? <Skeleton className="h-48 w-full" /> : POLICY_TEXTS.map(([kind, label]) => (
              <TextEditor key={kind} code={code} kind={kind} label={label} value={profile.data?.texts[kind] ?? ""} />
            ))}
          </CardBody>
        </Card>

        {profile.data && (
          <ChildAges code={code} free={profile.data.childFreeAge} max={profile.data.childMaxAge} />
        )}

        <Card>
          <CardBody>
            <Link to={`/h/${encodeURIComponent(code)}/cancellation-terms`}
              className="flex items-center justify-between gap-3 text-base text-ink-900 hover:text-brand-orange">
              <span>Cancellation terms<span className="block text-sm text-grey-500">What a guest pays when they cancel - set with the rates.</span></span>
              <ChevronRight className="size-4 shrink-0" />
            </Link>
          </CardBody>
        </Card>
      </div>
    </Page>
  );
}

/** "Children up to 5 stay free; 6 to 12 are children; 13 and over are adults." */
export function childAgeWords(free: number | null, max: number | null): string | null {
  if (free === null && max === null) return null;
  const parts = [
    free !== null ? `Children up to ${free} stay free` : null,
    max !== null ? `${free !== null ? free + 1 : "up"} to ${max} are children` : null,
    max !== null ? `${max + 1} and over are adults` : null,
  ].filter(Boolean);
  return `${parts.join("; ")}.`;
}

function ChildAges({ code, free, max }: { code: string; free: number | null; max: number | null }) {
  const qc = useQueryClient();
  const mayEdit = can(useRole(), "edit", "room_config");
  const [typedFree, setFree] = useState(free === null ? "" : String(free));
  const [typedMax, setMax] = useState(max === null ? "" : String(max));
  const [busy, setBusy] = useState(false);
  const asAge = (t: string) => (t.trim() === "" ? null : Number(t));
  const words = childAgeWords(asAge(typedFree), asAge(typedMax));

  const save = async () => {
    setBusy(true);
    const res = await saveChildAges(code, asAge(typedFree), asAge(typedMax));
    setBusy(false);
    if (!res.ok) return void toast.error("Not saved", res.reason);
    toast.success("Child ages saved", words ?? "Not set.");
    void qc.invalidateQueries({ queryKey: PROFILE_KEY(code) });
  };

  return (
    <Card>
      <SettingHeader title="Child ages" line="Up to what age a child stays free, and up to what age a guest is a child." />
      <CardBody>
        <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div className="grid grid-cols-2 gap-3 content-start">
            <Field label="Free up to age">
              {(p) => <Input {...fieldProps(p)} type="number" min={0} max={17} inputMode="numeric"
                value={typedFree} readOnly={!mayEdit} onChange={(e) => setFree(e.target.value)} />}
            </Field>
            <Field label="A child up to age">
              {(p) => <Input {...fieldProps(p)} type="number" min={1} max={17} inputMode="numeric"
                value={typedMax} readOnly={!mayEdit} onChange={(e) => setMax(e.target.value)} />}
            </Field>
          </div>
          <div className="rounded-md bg-grey-50 p-3 text-sm text-grey-600">
            <p className="text-ink-900">{words ?? "Not set: the desk decides, as today."}</p>
            <p className="mt-2">Prices do not change with these ages. The desk types the number of children as today, and a child costs the room type's extra-child rate once the room's own places are taken.</p>
          </div>
        </div>
        {mayEdit && (
          <div className="mt-3 flex justify-end">
            <Button variant="secondary" loading={busy} aria-label="Save the child ages" onClick={() => void save()}>Save</Button>
          </div>
        )}
      </CardBody>
    </Card>
  );
}
