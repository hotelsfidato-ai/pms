import { useState } from "react";
import { useNavigate } from "react-router";
import { FlaskConical } from "lucide-react";
import {
  Button, Dialog, DialogContent, Field, fieldProps, Input, toast,
} from "@/components/ui";
import { useSession } from "@/lib/session";
import { useUi } from "@/lib/ui";
import { plainName } from "@/lib/testHotel";
import { TestTag } from "@/components/app/TestHotel";
import {
  makeTestHotel, resetTestHotel, recopyTestHotel,
} from "@/modules/admin/data/admin";
import type { AdminResult } from "@/data/repositories/result";

/* ══════════════════════════════════════════════════════════════════
   A REAL HOTEL'S TEST HOTEL (the owner's D27-296, 10 October)

   On each real hotel's card on Properties, for the owner and a group
   administrator only (D27-296 (10)); the server refuses anybody else.

     none yet    "Make a test hotel", and what it is in one sentence
     made        its name with TEST, then Open (switch to it), Reset and
                 Re-copy setup

   Reset and Re-copy each say what is deleted and what stays, and go only
   once the word is typed - RESET, RE-COPY - which the server checks again.
   What they did is said after, in the server's figures; a refusal is the
   server's own sentence.
   ══════════════════════════════════════════════════════════════════ */

export interface TestHotelOf {
  /** The test hotel's code and name; its id where the session knows it. */
  code: string;
  name: string;
  id?: string;
}

const records = (n: number) => `${n} ${n === 1 ? "record" : "records"}`;

export function TestHotelControls({ real, test, onChanged }: {
  /** The real hotel this card is about. */
  real: { code: string; name: string };
  /** Its test hotel, or null while it has none. */
  test: TestHotelOf | null;
  onChanged: () => void;
}) {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);
  const [asking, setAsking] = useState<"reset" | "recopy" | null>(null);

  const make = async () => {
    if (busy) return;
    setBusy(true);
    setRefused(null);
    const res = await makeTestHotel(real.code);
    if (!res.ok) { setBusy(false); setRefused(res.reason); return; }
    /* The session learns the new hotel, with its testOf, so the switcher,
       the stripe and this card know it. */
    await useSession.getState().refresh().catch(() => {});
    setBusy(false);
    toast.success(`${res.name} is ready`,
      "A copy of this hotel's setup. Add the people who will practise in it on People.");
    onChanged();
  };

  /* Switches to it: the property every screen reads, then its Rooms. */
  const open = (t: TestHotelOf) => {
    if (t.id) useSession.getState().setHotelId(t.id);
    useUi.getState().setHotelId(t.code);
    navigate(`/h/${t.code}/stay`);
  };

  const name = test ? plainName({ name: test.name, testOf: real.code }) : "";

  return (
    <div data-test-hotel={real.code} className="mt-3 pt-3 border-t border-grey-100">
      <p className="flex items-center gap-1.5 text-xs font-medium text-grey-500">
        <FlaskConical className="size-3.5" aria-hidden />
        Test hotel
      </p>
      {test ? (
        <>
          <div className="flex items-center gap-2 flex-wrap mt-1.5">
            <span className="text-sm font-medium text-ink-900">{name}</span>
            <TestTag />
            <span className="tabular text-sm text-grey-500">{test.code}</span>
          </div>
          <div className="flex items-center gap-2 flex-wrap mt-2">
            <Button variant="secondary" onClick={() => open(test)}>Open</Button>
            <Button variant="secondary" onClick={() => setAsking("reset")}>Reset</Button>
            <Button variant="secondary" onClick={() => setAsking("recopy")}>Re-copy setup</Button>
          </div>
        </>
      ) : (
        <>
          <p className="text-sm text-grey-600 mt-1.5 leading-relaxed">
            A practice copy of this hotel's whole setup, with no guests or money.
          </p>
          <Button variant="secondary" className="mt-2" loading={busy} onClick={() => void make()}>
            Make a test hotel
          </Button>
          {refused && <p role="alert" className="text-sm text-brand-red-700 mt-1.5">{refused}</p>}
        </>
      )}

      {test && asking === "reset" && (
        <TypedConfirm
          title={`Reset ${name} · TEST`}
          word="RESET"
          action="Reset"
          what={<>
            <p><span className="font-medium text-ink-900">Deleted:</span> every booking, bill,
              invoice, restaurant order, guest, company, cash entry, stock move and night audit
              made in the test hotel.</p>
            <p><span className="font-medium text-ink-900">Kept:</span> its setup - rooms, rates,
              the menu and settings - and the people testing in it.</p>
          </>}
          run={(confirm) => resetTestHotel(test.code, confirm)}
          done={(r) => `Removed ${records(r.removed)}.`}
          onClose={() => setAsking(null)}
          onDone={onChanged}
        />
      )}
      {test && asking === "recopy" && (
        <TypedConfirm
          title={`Re-copy setup into ${name} · TEST`}
          word="RE-COPY"
          action="Re-copy setup"
          what={<>
            <p>Brings {real.name}'s rooms, rates, menu and settings again; test activity is
              deleted first.</p>
            <p><span className="font-medium text-ink-900">Kept:</span> the people testing in it.</p>
          </>}
          run={(confirm) => recopyTestHotel(test.code, confirm)}
          done={(r) => `Removed ${records(r.removed)}. Copied ${records(r.copied)} of setup from ${real.name}.`}
          onClose={() => setAsking(null)}
          onDone={onChanged}
        />
      )}
    </div>
  );
}

/* ── The typed word ─────────────────────────────────────────────────
   The button is off until the word is in the box exactly. The server is
   sent the word as typed and checks it again, so a box filled some other
   way still cannot reset anything. The owner's full reset (OwnerReset.tsx)
   asks for the hotel's code the same way. */
export function TypedConfirm<T>({ title, word, action, what, run, done, onClose, onDone }: {
  title: string;
  word: string;
  action: string;
  what: React.ReactNode;
  run: (confirm: string) => Promise<AdminResult<T>>;
  done: (result: T) => string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  const go = async () => {
    if (busy || typed.trim() !== word) return;
    setBusy(true);
    setRefused(null);
    const res = await run(typed.trim());
    setBusy(false);
    if (!res.ok) return setRefused(res.reason);
    setResult(done(res as unknown as T));
    onDone();
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        title={title}
        description={result ? "Done." : "This cannot be undone."}
        size="sm"
        footer={result ? (
          <Button variant="primary" size="lg" onClick={onClose}>Close</Button>
        ) : (
          <>
            <Button variant="secondary" size="lg" onClick={onClose}>Cancel</Button>
            <Button variant="danger" size="lg" loading={busy}
                    disabled={typed.trim() !== word}
                    onClick={() => void go()}>
              {action}
            </Button>
          </>
        )}
      >
        {result ? (
          <p role="status" className="text-base text-ink-900">{result}</p>
        ) : (
          <div className="space-y-3">
            <div className="space-y-2 text-sm text-grey-700 leading-relaxed">{what}</div>
            <Field label={`Type ${word} to confirm`}>
              {(f) => (
                <Input {...fieldProps(f)} value={typed} autoComplete="off"
                       className="tabular" onChange={(e) => setTyped(e.target.value)} />
              )}
            </Field>
            {refused && <p role="alert" className="text-sm text-brand-red-700">{refused}</p>}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
