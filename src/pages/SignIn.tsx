import { useState, type FormEvent } from "react";
import { Eye, EyeOff, LogIn, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/cn";
import { useSession } from "@/lib/session";
import { devAuth } from "@/lib/api";
import { DEV_IDENTITIES } from "@/lib/devIdentities";
import { isConfigured } from "@/lib/firebase";
import { Button, Field, Input } from "@/components/ui";
import markUrl from "@/assets/brand/logo-mark.svg";

/* ══════════════════════════════════════════════════════════════════
   SIGN IN

   Firebase takes the password; this screen never sees it after the
   call. Postgres decides everything that happens next.

   THE ONE SCREEN EVERY PERSON SEES, and it was a small grey card with
   the brand set as a text label above the heading — an eyebrow, which
   is the weakest thing a heading can carry. The group has a real mark
   in `src/assets/brand/` and nothing outside the design-system page had
   ever used it.

   It is now a split: the group's own panel on the left, the form on the
   right, one column on a phone. The panel is the brand; the form stays
   exactly as plain as a form should be at 7am on a desk terminal.

   The "Development only" buttons come from src/lib/devIdentities.ts —
   the same list the account menu's switcher uses. They never reach a
   production build: `npm run build:app` fails if they do.
   ══════════════════════════════════════════════════════════════════ */

export default function SignInPage() {
  const signIn = useSession((s) => s.signIn);
  const signInAsDev = useSession((s) => s.signInAsDev);
  const busy = useSession((s) => s.busy);
  const error = useSession((s) => s.error);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  /* A desk terminal's keyboard is shared, the screen faces the lobby,
     and a mistyped password is the most common reason somebody cannot
     get in. Showing it is the clerk's own choice, so it starts off. */
  const [showPassword, setShowPassword] = useState(false);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void signIn(email, password);
  };

  return (
    <main className="min-h-dvh lg:grid lg:grid-cols-[1.05fr_1fr]">
      {/* ── The group's panel ──────────────────────────────────────
          Ink, the mark, and one true sentence. On a phone it collapses
          to a band so the form is above the fold. */}
      <aside
        className="relative overflow-hidden bg-ink-900 text-white
                   px-6 py-7 sm:px-10 lg:px-14 lg:py-14
                   flex flex-col justify-between gap-10"
      >
        {/* The mark again, oversized and barely there. It is the brand's
            own shape rather than a pattern invented for the panel. */}
        <img
          src={markUrl}
          alt=""
          aria-hidden
          className="pointer-events-none select-none absolute -right-24 -bottom-28
                     w-[28rem] opacity-[0.07] hidden lg:block"
        />

        <div className="flex items-center gap-3">
          <img src={markUrl} alt="" aria-hidden className="size-9 lg:size-11" />
          <span className="text-sm font-semibold uppercase tracking-[0.18em] text-white/90">
            Fidato Hotels
          </span>
        </div>

        <div className="relative max-w-md hidden lg:block">
          <h1 className="text-4xl font-semibold tracking-tight text-white">
            Property management
          </h1>
          <p className="text-md text-white/70 mt-3 leading-relaxed">
            The front desk, housekeeping, the restaurant and the day's
            figures — one system, every property.
          </p>
        </div>

        <p className="relative text-sm text-white/55 hidden lg:block">
          Trouble signing in? Your general manager can reset your password
          from the People screen.
        </p>
      </aside>

      {/* ── The form ───────────────────────────────────────────────── */}
      <div className="flex items-center justify-center px-5 py-10 sm:px-8 bg-white">
        <div className="w-full max-w-sm">
          <h2 className="text-2xl font-semibold text-ink-900">Sign in</h2>
          <p className="text-base text-grey-600 mt-1.5">
            Use the account your property gave you.
          </p>

          <form onSubmit={submit} className="space-y-4 mt-7">
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
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.currentTarget.value)}
                  /* The system already owns "something at the trailing
                     edge of a field" — using it keeps this control the
                     same shape as every other one in the app. */
                  trailingSlot={
                    <button
                      type="button"
                      onClick={() => setShowPassword((s) => !s)}
                      aria-label={showPassword ? "Hide password" : "Show password"}
                      aria-pressed={showPassword}
                      className="p-2 -m-2 rounded text-grey-500 hover:text-ink-900
                                 transition-colors duration-150"
                    >
                      {showPassword
                        ? <EyeOff className="size-4" aria-hidden />
                        : <Eye className="size-4" aria-hidden />}
                    </button>
                  }
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

            {/* PRIMARY, which it had never been. `Button` defaults to the
                secondary variant, so the one action on the one screen
                every person starts at was drawn as a quiet outline. */}
            <Button
              type="submit"
              variant="primary"
              size="lg"
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

          {/* The recovery line the panel carries on a wide screen — a
              phone never sees that panel, and this is the one thing on
              it a stuck clerk actually needs. */}
          <p className="text-sm text-grey-500 mt-6 lg:hidden">
            Trouble signing in? Your general manager can reset your password.
          </p>

          {devAuth && (
            <div className="mt-8">
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
      </div>
    </main>
  );
}
