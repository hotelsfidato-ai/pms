import { useState, type FormEvent } from "react";
import { LogIn, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/cn";
import { useSession } from "@/lib/session";
import { devAuth } from "@/lib/api";
import { isConfigured } from "@/lib/firebase";
import { Button, Card, CardBody, Field, Input } from "@/components/ui";

/* ══════════════════════════════════════════════════════════════════
   SIGN IN

   Firebase takes the password; this screen never sees it after the
   call. Postgres decides everything that happens next.
   ══════════════════════════════════════════════════════════════════ */

/** Seeded by db/dev/dev-identities.sql. Local development only. */
const DEV_IDENTITIES = [
  { uid: "dev-agra", label: "Agra clerk", detail: "one property · front desk" },
  { uid: "dev-pune", label: "Pune clerk", detail: "one property · front desk" },
  { uid: "dev-owner", label: "Owner", detail: "every property · group admin" },
];

export default function SignInPage() {
  const signIn = useSession((s) => s.signIn);
  const signInAsDev = useSession((s) => s.signInAsDev);
  const busy = useSession((s) => s.busy);
  const error = useSession((s) => s.error);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void signIn(email, password);
  };

  return (
    <main className="min-h-dvh flex items-center justify-center bg-grey-50 px-5 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-7">
          <p className="text-2xs font-semibold uppercase tracking-widest text-brand-orange">
            Fidato Hotels
          </p>
          <h1 className="text-xl font-semibold text-ink-900 mt-1.5">
            Property Management
          </h1>
          <p className="text-base text-grey-600 mt-1.5">
            Sign in with the account your property gave you.
          </p>
        </div>

        <Card>
          <CardBody>
            <form onSubmit={submit} className="space-y-4">
              {/* Field takes a render prop — ({ id, describedBy, invalid })
                  — not children directly. */}
              <Field label="Email" required>
                {({ id, describedBy }) => (
                  <Input
                    id={id}
                    aria-describedby={describedBy}
                    type="email"
                    autoComplete="username"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.currentTarget.value)}
                    placeholder="you@fidatohotels.com"
                  />
                )}
              </Field>

              <Field label="Password" required>
                {({ id, describedBy }) => (
                  <Input
                    id={id}
                    aria-describedby={describedBy}
                    type="password"
                    autoComplete="current-password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.currentTarget.value)}
                  />
                )}
              </Field>

              {error && (
                <p
                  role="alert"
                  className="flex items-start gap-2 text-sm text-brand-red bg-brand-red-50 border border-brand-red-100 rounded-md p-2.5"
                >
                  <TriangleAlert className="size-4 shrink-0 mt-px" />
                  {error}
                </p>
              )}

              <Button
                type="submit"
                className="w-full"
                loading={busy}
                disabled={!isConfigured}
                leadingIcon={<LogIn className="size-4" />}
              >
                Sign in
              </Button>

              {!isConfigured && (
                <p className="text-xs text-grey-500 leading-relaxed">
                  Firebase is not configured, so password sign-in is unavailable.
                  Copy <code className="tabular">.env.example</code> to{" "}
                  <code className="tabular">.env</code>.
                </p>
              )}
            </form>
          </CardBody>
        </Card>

        {devAuth && (
          <div className="mt-6">
            <div className="flex items-center gap-3 mb-3">
              <span className="h-px flex-1 bg-grey-200" />
              <span className="text-2xs font-semibold uppercase tracking-widest text-brand-yellow">
                Development only
              </span>
              <span className="h-px flex-1 bg-grey-200" />
            </div>

            <div className="space-y-2">
              {DEV_IDENTITIES.map((id) => (
                <button
                  key={id.uid}
                  type="button"
                  onClick={() => void signInAsDev(id.uid)}
                  disabled={busy}
                  className={cn(
                    "w-full flex items-baseline justify-between gap-3 px-3.5 py-2.5",
                    "rounded-md border border-grey-200 bg-white text-left",
                    "hover:border-grey-300 hover:bg-grey-50 transition-colors duration-150",
                    "disabled:opacity-50",
                  )}
                >
                  <span className="text-base font-medium text-ink-900">{id.label}</span>
                  <span className="text-2xs text-grey-500">{id.detail}</span>
                </button>
              ))}
            </div>

            <p className="text-xs text-grey-500 mt-3 leading-relaxed">
              These sign in through the same <code className="tabular">firebase_uid</code>{" "}
              path a real account uses — only the token check is skipped. The API
              refuses to start this way with{" "}
              <code className="tabular">NODE_ENV=production</code>.
            </p>
          </div>
        )}
      </div>
    </main>
  );
}
