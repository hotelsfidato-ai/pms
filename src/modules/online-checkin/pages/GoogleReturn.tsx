import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
import { useMutation } from "@tanstack/react-query";
import { Card, CardBody } from "@/components/ui";
import { verifyWithGoogle } from "@/modules/online-checkin/data/guestPage";
import { takeGoogleAnswer } from "@/modules/online-checkin/googleRedirect";
import { messageFrom } from "@/modules/online-checkin/guestKit";

/* ══════════════════════════════════════════════════════════════════
   /g-return - WHERE GOOGLE SENDS THE GUEST BACK (OCI-10)

   Outside the session gate, like /g/:token. Google's signed answer arrives
   in the address's fragment; this checks the state is the one THIS tab sent
   (googleRedirect.ts), takes the answer out of the address at once, posts it
   with the nonce to the door, and opens the booking. The door decides; this
   page decides nothing. Every refusal is the door's own sentence.
   ══════════════════════════════════════════════════════════════════ */
export default function GoogleReturn() {
  const navigate = useNavigate();
  const [answer] = useState(() => takeGoogleAnswer(window.location.hash));
  const posted = useRef(false);
  const check = useMutation({
    mutationFn: (a: { token: string; credential: string; nonce: string }) =>
      verifyWithGoogle(a.token, a.credential, a.nonce),
    onSuccess: (r, a) => { if (r.verified) navigate(`/g/${a.token}`, { replace: true }); },
  });
  const { mutate } = check;

  useEffect(() => {
    /* Google's answer does not stay in the address, the history or a screenshot. */
    window.history.replaceState(window.history.state, "", window.location.pathname);
    if (answer.ok && !posted.current) {
      posted.current = true;
      mutate(answer);
    }
  }, [answer, mutate]);

  const said = !answer.ok ? "Google sign-in did not finish. Open your booking again and try once more, or use a code."
    : check.error ? messageFrom(check.error)
    : null;

  return (
    <main className="min-h-dvh bg-grey-50 px-5 py-6 sm:py-10">
      <div className="mx-auto w-full max-w-md">
        <Card><CardBody>
          <p className="text-base text-ink-900" aria-live="polite">{said ?? "Checking with Google…"}</p>
          {said && answer.token && (
            <Link to={`/g/${answer.token}`} replace
              className="mt-3 inline-block text-brand-orange-700 hover:underline font-medium">
              Back to your booking
            </Link>
          )}
        </CardBody></Card>
      </div>
    </main>
  );
}
