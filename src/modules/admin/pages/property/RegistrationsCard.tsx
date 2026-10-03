import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, Plus, X } from "lucide-react";
import { Button, Card, CardBody, Input, Skeleton, toast } from "@/components/ui";
import { can } from "@/lib/permissions";
import { useRole } from "@/lib/session";
import { mapLink } from "@/modules/online-checkin";
import { PROFILE_KEY, getProfile, saveRegistrations, type Registration } from "@/modules/admin/data/property";
import { SettingHeader } from "@/modules/admin/pages/Admin";

/* Up to four more registration numbers, each with its own label (D27-257:
   in Settings only, never printed), and the map point as a plain Google
   Maps link. Under today's profile card on the Profile page. */
export function RegistrationsCard({ hotelCode }: { hotelCode: string }) {
  const qc = useQueryClient();
  const mayEdit = can(useRole(), "edit", "room_config");
  const q = useQuery({ queryKey: PROFILE_KEY(hotelCode), queryFn: () => getProfile(hotelCode), enabled: Boolean(hotelCode) });
  const [typed, setTyped] = useState<Registration[] | null>(null);
  const [busy, setBusy] = useState(false);
  const rows = typed ?? q.data?.registrations ?? [];
  const set = (i: number, patch: Partial<Registration>) =>
    setTyped(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  const save = async () => {
    setBusy(true);
    const res = await saveRegistrations(hotelCode, rows);
    setBusy(false);
    if (!res.ok) return void toast.error("Not saved", res.reason);
    toast.success("Registration numbers saved");
    setTyped(null);
    void qc.invalidateQueries({ queryKey: PROFILE_KEY(hotelCode) });
  };

  return (
    <Card>
      <SettingHeader title="More registration numbers" line="Up to four, each with its own name. Kept here; not printed on bills." />
      <CardBody className="flex flex-col gap-3">
        {q.isLoading ? <Skeleton className="h-24 w-full" /> : (
          <>
            {rows.length === 0 && <p className="text-base text-grey-500">None.</p>}
            {rows.map((r, i) => (
              <div key={i} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] gap-2">
                <Input aria-label={`Label ${i + 1}`} placeholder="Trade licence" maxLength={40} value={r.label}
                  readOnly={!mayEdit} onChange={(e) => set(i, { label: e.target.value })} />
                <Input aria-label={`Number ${i + 1}`} placeholder="Number" maxLength={40} value={r.number}
                  readOnly={!mayEdit} onChange={(e) => set(i, { number: e.target.value })} />
                {mayEdit && (
                  <Button variant="ghost" size="icon" aria-label={`Remove number ${i + 1}`}
                    onClick={() => setTyped(rows.filter((_, j) => j !== i))}><X className="size-4" /></Button>
                )}
              </div>
            ))}
            {mayEdit && (
              <div className="flex flex-wrap justify-between gap-2">
                <Button variant="ghost" disabled={rows.length >= 4} aria-label="Add a number"
                  onClick={() => setTyped([...rows, { label: "", number: "" }])}><Plus className="size-4" /> Add</Button>
                <Button variant="secondary" loading={busy} disabled={typed === null} aria-label="Save the numbers"
                  onClick={() => void save()}>Save</Button>
              </div>
            )}
          </>
        )}
        <div className="border-t border-grey-100 pt-3 text-sm">
          {q.data?.map ? (
            <a href={mapLink(q.data.map)} target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-ink-900 hover:text-brand-orange">
              Open on map <ExternalLink className="size-3.5" aria-hidden />
            </a>
          ) : (
            <span className="text-grey-500">No map point yet: it is set with the profile's latitude and longitude.</span>
          )}
        </div>
      </CardBody>
    </Card>
  );
}
