import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { LogIn } from "lucide-react";
import { dateTime } from "@/lib/format";
import {
  Page, PageHeader, Card, DataTable, EmptyState, NativeSelect, Button, Dialog, DialogContent, toast,
  type Column,
} from "@/components/ui";
import { listPeople, listSignIns, signOutDevice, type SignIn } from "@/modules/admin/data/admin";

/* ══════════════════════════════════════════════════════════════════
   SIGN-INS AND DEVICES (D27-243 5.4, D27-255)

   Each sign-in is one device. For the owner (anybody) and an Admin (the
   people at a hotel where they hold Admin); the server decides and says
   so. Kept 90 days. "Sign out this device" makes the server refuse that
   sign-in from the next request; the password still works. The network
   address is kept for the record and never shown.
   ══════════════════════════════════════════════════════════════════ */

/** "Chrome on Windows", from the browser's own description; null when it says nothing we know. */
export function deviceInWords(description: string | null): string | null {
  if (!description) return null;
  const d = description;
  const browser = /Edg\//.test(d) ? "Edge" : /OPR\//.test(d) ? "Opera"
    : /(Chrome|CriOS)\//.test(d) ? "Chrome" : /(Firefox|FxiOS)\//.test(d) ? "Firefox"
    : /Safari\//.test(d) ? "Safari" : null;
  const system = /iPhone/.test(d) ? "iPhone" : /iPad/.test(d) ? "iPad" : /Android/.test(d) ? "Android"
    : /Windows/.test(d) ? "Windows" : /Mac OS X/.test(d) ? "Mac" : /Linux/.test(d) ? "Linux" : null;
  return browser && system ? `${browser} on ${system}` : browser ?? system;
}

export default function SignInsPage() {
  const qc = useQueryClient();
  const people = useQuery({ queryKey: ["people"], queryFn: () => listPeople() });
  const [who, setWho] = useState("");
  const [asking, setAsking] = useState<SignIn | null>(null);
  const [busy, setBusy] = useState(false);
  const history = useQuery({
    queryKey: ["sign-ins", who],
    queryFn: () => listSignIns(who),
    enabled: Boolean(who),
  });

  const signOut = async (row: SignIn) => {
    setBusy(true);
    const res = await signOutDevice(row.id);
    setBusy(false);
    setAsking(null);
    if (!res.ok) return toast.error("Not signed out", res.reason);
    toast.success("Signed out", "That device must sign in again. The password still works.");
    void qc.invalidateQueries({ queryKey: ["sign-ins", who] });
  };

  const columns: Column<SignIn>[] = [
    {
      key: "at", header: "Signed in", width: "w-[190px]",
      cell: (r) => <span className="tabular">{dateTime(r.at)}</span>,
    },
    {
      key: "device", header: "Device",
      cell: (r) => <span title={r.device ?? undefined}>{deviceInWords(r.device) ?? r.device ?? "-"}</span>,
    },
    {
      key: "status", header: "Now",
      cell: (r) => r.signedOutAt
        ? <span className="text-grey-600">Signed out {dateTime(r.signedOutAt)} by {r.signedOutBy ?? "-"}</span>
        : <span>Signed in</span>,
    },
    {
      key: "action", header: "", width: "w-[200px]",
      cell: (r) => !r.signedOutAt && (
        <Button variant="secondary" size="sm" onClick={() => setAsking(r)}>Sign out this device</Button>
      ),
    },
  ];

  return (
    <Page>
      <PageHeader title="Sign-ins and devices"
        description="When each person signed in, and on what device. Kept 90 days." />
      <label className="mb-4 text-sm text-grey-600 flex flex-col gap-1 max-w-xs">
        Whose
        <NativeSelect value={who} onChange={(e) => setWho(e.target.value)}>
          <option value="">Pick a person</option>
          {(people.data?.staff ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </NativeSelect>
      </label>
      {who && (
        <Card>
          <DataTable<SignIn>
            rows={history.data?.signIns ?? []}
            columns={columns}
            rowKey={(r) => r.id}
            loading={history.isLoading}
            error={history.error}
            onRetry={() => void history.refetch()}
            empty={<EmptyState compact icon={<LogIn />} title="No sign-ins"
                     description="None in the last 90 days, or none since this was first kept." />}
          />
        </Card>
      )}
      {asking && (
        <Dialog open onOpenChange={(o) => !o && !busy && setAsking(null)}>
          <DialogContent
            title={`Sign out ${deviceInWords(asking.device) ?? "this device"}?`}
            size="sm"
            footer={
              <>
                <Button variant="secondary" size="lg" disabled={busy} onClick={() => setAsking(null)}>
                  Cancel
                </Button>
                <Button variant="danger" size="lg" loading={busy} onClick={() => void signOut(asking)}>
                  Sign out
                </Button>
              </>
            }
          >
            <p className="text-base text-grey-600 leading-relaxed">
              The sign-in of {dateTime(asking.at)} stops working at once; that device must sign in
              again. Their password still works, and their other devices stay signed in.
            </p>
          </DialogContent>
        </Dialog>
      )}
    </Page>
  );
}
