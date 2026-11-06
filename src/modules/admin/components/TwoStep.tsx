import { useEffect, useRef, useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound, ShieldCheck } from "lucide-react";
import {
  Button, Card, CardBody, Dialog, DialogContent, Field, fieldProps, IconChip, Input,
  Skeleton, Switch, Textarea, toast,
} from "@/components/ui";
import { useRole, useSession } from "@/lib/session";
import { useDocumentTitle } from "@/lib/documentTitle";
import {
  getTwoStep, sendTwoStepCode, setTwoStepRequired, startTwoStep, switchTwoStepOff,
} from "@/modules/admin/data/admin";

/* ══════════════════════════════════════════════════════════════════
   TWO-STEP SIGN-IN (D27-384, D27-396)

   The password, and then a 6-digit code from an authenticator app on the
   person's phone (Google Authenticator, Microsoft Authenticator). The
   server decides everything (api/src/modules/admin/twoStep.ts); these are
   its screens:

     TwoStepGate        after a right password, when the sign-in owes a code
                        or (their role needs it) setting the app up
     TwoStepDialog      the account menu's "Two-step sign-in": set it up, or
                        see that it is on
     TwoStepRequiredCard  Settings, Signing in: the group's setting, the
                        owner's and an Admin's
     TwoStepOffDialog   People: switched off for somebody (a lost phone),
                        with a reason
   ══════════════════════════════════════════════════════════════════ */

/** The code box: six digits from the app, or (once it is on) a recovery code. */
function CodeForm({ recovery, onPassed }: {
  recovery: boolean;
  onPassed: (codes: string[] | undefined) => void;
}) {
  const [code, setCode] = useState("");
  const [useRecovery, setUseRecovery] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setProblem(null);
    const res = await sendTwoStepCode(code);
    setBusy(false);
    if (!res.ok) {
      setCode("");
      return setProblem(res.reason);
    }
    onPassed(res.recoveryCodes);
  };

  return (
    <form onSubmit={(e) => void submit(e)} className="space-y-3">
      <Field label={useRecovery ? "Recovery code" : "Code from the app"}
             {...(problem ? { error: problem } : {})}
             hint={useRecovery ? "One of the ten you kept. Each works once." : "Six digits. A new one every 30 seconds."}>
        {(f) => (
          <Input {...fieldProps(f)} value={code} autoFocus
                 className="h-12 text-lg tabular tracking-[0.2em]"
                 inputMode={useRecovery ? "text" : "numeric"}
                 autoComplete="one-time-code"
                 maxLength={useRecovery ? 16 : 6}
                 onChange={(e) => setCode(useRecovery ? e.target.value : e.target.value.replace(/\D/g, ""))} />
        )}
      </Field>
      <Button type="submit" variant="primary" size="lg" className="w-full" loading={busy}
              disabled={useRecovery ? code.trim().length < 10 : code.length !== 6}>
        Go on
      </Button>
      {recovery && (
        <button type="button" className="text-sm text-grey-600 underline underline-offset-2 hover:text-ink-900"
                onClick={() => { setUseRecovery((r) => !r); setCode(""); setProblem(null); }}>
          {useRecovery ? "Use the code from the app" : "Use a recovery code instead"}
        </button>
      )}
    </form>
  );
}

/** Setting the app up: a key as a QR code, one right code, then the ten
    recovery codes, shown this once. */
function SetUp({ onDone }: { onDone: () => void }) {
  const [key, setKey] = useState<{ key: string; uri: string } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);

  /* ONE key per set-up. Each start makes a new key on the server, and React's
     development double start made two: the screen showed one and the server
     kept the other, so the app's code was refused (the manual's run, 6 Nov). */
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void startTwoStep().then((res) => {
      if (res.ok) setKey({ key: res.key, uri: res.uri });
      else setProblem(res.reason);
    });
  }, []);

  const qr = useQuery({
    queryKey: ["two-step-qr", key?.uri],
    queryFn: async () => (await import("qrcode")).toString(key!.uri, { type: "svg", margin: 0 }),
    enabled: Boolean(key),
    staleTime: Infinity,
  });

  if (codes) {
    return (
      <div className="space-y-4" data-recovery-codes>
        <p className="text-base font-semibold text-ink-900">Two-step sign-in is on. Keep these recovery codes.</p>
        <p className="text-sm text-grey-600">
          If your phone is lost or not with you, each code lets you in once. Write them down or print them,
          and keep them away from the phone. They are not shown again.
        </p>
        <ol className="grid grid-cols-2 gap-x-6 gap-y-1.5 rounded-md bg-grey-50 border border-grey-200 p-4">
          {codes.map((c) => <li key={c} className="text-base tabular text-ink-900">{c}</li>)}
        </ol>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => void navigator.clipboard?.writeText(codes.join("\n"))
            .then(() => toast.success("Copied", "Paste them somewhere safe, away from the phone."),
                  () => toast.error("Not copied", "Write them down instead."))}>
            Copy them
          </Button>
          <Button variant="primary" onClick={onDone}>I have kept them</Button>
        </div>
      </div>
    );
  }

  if (problem) return <p className="text-sm text-brand-red-700">{problem}</p>;

  return (
    <ol className="space-y-5">
      <li className="space-y-1">
        <p className="text-base font-medium text-ink-900">1. Put an authenticator app on your phone</p>
        <p className="text-sm text-grey-600">Google Authenticator or Microsoft Authenticator, free from the phone's app store.</p>
      </li>
      <li className="space-y-2">
        <p className="text-base font-medium text-ink-900">2. In the app, add an account and scan this code</p>
        {qr.data ? (
          <img alt="QR code for the authenticator app" className="size-44 rounded-md border border-grey-200 p-2 bg-white"
               src={`data:image/svg+xml;utf8,${encodeURIComponent(qr.data)}`} />
        ) : qr.error ? (
          <p className="text-sm text-brand-red-700">The QR code could not be drawn. Type the key below instead.</p>
        ) : (
          <Skeleton className="size-44" />
        )}
        <p className="text-sm text-grey-600">
          Cannot scan? Choose "enter a setup key" in the app and type:{" "}
          <span className="tabular font-medium text-ink-900 break-all" data-two-step-key>{key?.key ?? "-"}</span>
        </p>
      </li>
      <li className="space-y-2">
        <p className="text-base font-medium text-ink-900">3. Type the 6-digit code the app shows</p>
        <CodeForm recovery={false} onPassed={(c) => (c ? setCodes(c) : onDone())} />
      </li>
    </ol>
  );
}

/** After a right password: the code, or setting the app up first. Nothing
    else of the system is reachable until this is done (the server refuses). */
export function TwoStepGate() {
  const owed = useSession((s) => s.twoStep);
  const refresh = useSession((s) => s.refresh);
  const signOut = useSession((s) => s.signOut);
  useDocumentTitle("Two-step sign-in");

  const goOn = () => void refresh().catch((error: unknown) =>
    toast.error("Could not open the system", error instanceof Error ? error.message : "Try again."));

  return (
    <main className="min-h-dvh grid place-items-center bg-grey-50 px-4 py-10">
      <Card className="w-full max-w-md">
        <CardBody className="space-y-5 p-6">
          <div className="flex items-center gap-3">
            <IconChip size={28}><ShieldCheck /></IconChip>
            <h1 className="page-title text-ink-900">Two-step sign-in</h1>
          </div>
          {owed === "setup" ? (
            <>
              <p className="text-base text-grey-600">
                Your role needs it: a code from an app on your phone, as well as your password.
                Set it up once, now. It takes two minutes.
              </p>
              <SetUp onDone={goOn} />
            </>
          ) : (
            <>
              <p className="text-base text-grey-600">
                Your password was right. Now type the 6-digit code your authenticator app shows for this account.
              </p>
              <CodeForm recovery onPassed={goOn} />
              <p className="text-sm text-grey-500">
                Lost your phone and your recovery codes? The owner or an Admin can switch two-step sign-in off for you.
              </p>
            </>
          )}
          <div className="border-t border-grey-200 pt-4">
            <Button variant="ghost" onClick={() => void signOut()}>Sign out</Button>
          </div>
        </CardBody>
      </Card>
    </main>
  );
}

/** The account menu's "Two-step sign-in": set it up, or see that it is on. */
export function TwoStepDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const qc = useQueryClient();
  const me = useQuery({ queryKey: ["two-step"], queryFn: getTwoStep, enabled: open });
  const [settingUp, setSettingUp] = useState(false);
  const close = (next: boolean) => { if (!next) setSettingUp(false); onOpenChange(next); };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent title="Two-step sign-in" size="sm"
        description="A code from an app on your phone, as well as your password, each time you sign in.">
        {me.isLoading ? <Skeleton className="h-24 w-full" />
          : me.error ? <p className="text-sm text-brand-red-700">Could not read it. {(me.error as Error).message}</p>
          : me.data?.on ? (
            <div className="space-y-2" data-two-step-on>
              <p className="text-base text-ink-900">Two-step sign-in is on for you.</p>
              <p className="text-sm text-grey-600">
                {me.data.recoveryLeft ?? "-"} recovery codes left. Lost your phone? The owner or an Admin switches
                it off from People, and you set it up again here.
              </p>
            </div>
          ) : settingUp ? (
            <SetUp onDone={() => {
              toast.success("Two-step sign-in is on", "You will be asked for the code at your next sign-in.");
              void qc.invalidateQueries({ queryKey: ["two-step"] });
              close(false);
            }} />
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-grey-600">
                Off for you. With it on, somebody who learns your password still cannot get in without your phone.
                {me.data?.required ? " The group requires it for the owner, Admins, GMs and Accountants." : ""}
              </p>
              <Button variant="primary" onClick={() => setSettingUp(true)}>
                <KeyRound className="size-4" /> Set it up
              </Button>
            </div>
          )}
      </DialogContent>
    </Dialog>
  );
}

/** Settings, Signing in: whether the group requires it. Off by default;
    the owner's and an Admin's to change, once their own is on. */
export function TwoStepRequiredCard() {
  const qc = useQueryClient();
  const role = useRole();
  const me = useQuery({ queryKey: ["two-step"], queryFn: getTwoStep });
  const [busy, setBusy] = useState(false);
  const mayChange = role === "owner" || role === "admin";

  const change = async (required: boolean) => {
    setBusy(true);
    const res = await setTwoStepRequired(required);
    setBusy(false);
    if (!res.ok) return toast.error("Not changed", res.reason);
    toast.success(required ? "Two-step sign-in is required" : "Two-step sign-in is no longer required",
      required ? "The owner, Admins, GMs and Accountants set it up before going on." : undefined);
    void qc.invalidateQueries({ queryKey: ["two-step"] });
  };

  return (
    <Card data-two-step-required>
      <CardBody className="space-y-3">
        <h2 className="flex items-center gap-2.5 text-md font-semibold text-ink-900">
          <IconChip size={24}><ShieldCheck /></IconChip>
          Two-step sign-in
        </h2>
        {me.isLoading ? <Skeleton className="h-10 w-full" /> : me.error ? (
          <p className="text-sm text-brand-red-700">Could not read the setting. {(me.error as Error).message}</p>
        ) : (
          <Switch checked={me.data?.required ?? false} disabled={!mayChange || busy}
            onCheckedChange={(on) => void change(on)}
            label="Required for the owner, Admins, GMs and Accountants"
            description={mayChange
              ? "When on, each of them sets it up at their next sign-in. Set up your own first, from your account menu."
              : "The owner or an Admin changes this."} />
        )}
        <p className="text-sm text-grey-600">
          Anybody may set it up for themselves from their account menu, Two-step sign-in.
        </p>
      </CardBody>
    </Card>
  );
}

/** People: switched off for somebody (a lost phone), with a reason. */
export function TwoStepOffDialog({ staffId, name, onClose, onDone }: {
  staffId: string; name: string; onClose: () => void; onDone: () => void;
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    const res = await switchTwoStepOff(staffId, reason);
    setBusy(false);
    if (!res.ok) return toast.error("Not switched off", res.reason);
    toast.success(`Two-step sign-in is off for ${name}`, "They sign in with the password alone, until they set it up again.");
    onDone();
    onClose();
  };
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent title={`Switch two-step sign-in off for ${name}?`} size="sm"
        description="For a lost or changed phone. The reason goes into the audit log."
        footer={<>
          <Button variant="ghost" onClick={onClose}>Keep it on</Button>
          <Button variant="primary" loading={busy} disabled={!reason.trim()} onClick={() => void submit()}>
            Switch it off
          </Button>
        </>}>
        <Field label="Why" required>
          {(f) => <Textarea {...fieldProps(f)} rows={2} value={reason}
                            placeholder="Lost phone" onChange={(e) => setReason(e.target.value)} />}
        </Field>
      </DialogContent>
    </Dialog>
  );
}
