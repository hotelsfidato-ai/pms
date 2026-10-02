import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Dialog, DialogContent, Field, fieldProps, Input, Button, toast,
} from "@/components/ui";
import { useSession } from "@/lib/session";
import { getPasswordDue, setStaffPassword } from "@/modules/admin/data/admin";

/* ══════════════════════════════════════════════════════════════════
   A LONGER PASSWORD, BEFORE GOING ON (D27-245)

   Somebody given the owner's, an Admin's or a GM's role while holding a
   password shorter than 10 characters sets a new one at their next
   sign-in. The server says whether it is due (`GET /api/me/password`);
   this asks once per sign-in and cannot be closed until it is set. The
   new password goes through the same route as any other, which checks
   the length again and clears what is due.
   ══════════════════════════════════════════════════════════════════ */
export function PasswordDue() {
  const qc = useQueryClient();
  const me = useSession((s) => s.scope?.staffId);
  const due = useQuery({
    queryKey: ["password-due", me],
    queryFn: getPasswordDue,
    enabled: Boolean(me),
    staleTime: Infinity,
  });
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);

  if (!me || !due.data?.due) return null;
  const min = due.data.min;

  const submit = async () => {
    setBusy(true);
    const res = await setStaffPassword(me, value);
    setBusy(false);
    if (!res.ok) return toast.error("Not set", res.reason);
    toast.success("Your new password is set", "Use it the next time you sign in.");
    setValue("");
    void qc.invalidateQueries({ queryKey: ["password-due"] });
  };

  return (
    <Dialog open onOpenChange={() => {}}>
      <DialogContent
        title="Set a longer password"
        description={`Your role now reaches more, so your password is at least ${min} characters. Set one to go on.`}
        size="sm"
        closable={false}
        footer={
          <Button variant="primary" size="lg" loading={busy}
                  disabled={value.length < min} onClick={() => void submit()}>
            Set it
          </Button>
        }
      >
        <Field label="A new password" hint={`At least ${min} characters.`}>
          {(f) => (
            <Input {...fieldProps(f)} type="password" autoComplete="new-password"
                   value={value} className="h-12 text-base"
                   onChange={(e) => setValue(e.target.value)} />
          )}
        </Field>
      </DialogContent>
    </Dialog>
  );
}
