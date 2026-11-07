import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Card, CardBody } from "@/components/ui";
import { cn } from "@/lib/cn";
import { PreferenceFields, preferenceWords, type Preferences } from "@/modules/guests";
import { getMyPreferences, saveMyPreferences } from "@/modules/online-checkin/data/guestCare";
import { H2, LEAD, SECTION, messageFrom, unlockGone, useUnlockGone } from "@/modules/online-checkin/guestKit";

/* ══════════════════════════════════════════════════════════════════
   THE GUEST'S OWN PREFERENCES (D27-383 item 10)

   A section behind the code (online-checkin rule 8): its own door route
   (api/src/routes/guestPreferences.ts), this tab's unlock on every call,
   and only this stay's own guest's record. The same form the desk uses
   (guests' PreferenceFields), so the guest and the desk cannot be offered
   different choices. Hidden while it has nothing to show.
   ══════════════════════════════════════════════════════════════════ */

export function PreferencesSection({ token, onUnlockGone }: { token: string; onUnlockGone: () => void }) {
  const qc = useQueryClient();
  const key = ["guest-behind", token, "preferences"];
  const q = useQuery({ queryKey: key, queryFn: () => getMyPreferences(token), retry: false });
  const [draft, setDraft] = useState<Preferences | null>(null);
  const save = useMutation({
    mutationFn: (p: Preferences) => saveMyPreferences(token, p),
    onSuccess: async () => { setDraft(null); await qc.invalidateQueries({ queryKey: key }); },
  });
  useUnlockGone(q.error ?? save.error, onUnlockGone);
  if (!q.data) return null;

  const kept = q.data.preferences;
  const words = preferenceWords(kept, q.data.smokingOffered);
  const has = Boolean(kept.allergies) || words.length > 0;

  return (
    <section className={SECTION} data-guest-preferences-section>
      <h2 className={H2}>Your preferences</h2>
      <p className={LEAD}>How you like your room and your food. We keep them with your details for your next stay too.</p>
      <Card className="mt-3"><CardBody>
        {draft === null ? (
          <div className="flex flex-col gap-3">
            {kept.allergies && (
              <p className="text-base font-semibold text-brand-red-700">Allergy: {kept.allergies}</p>
            )}
            {(words.length > 0 || !has) && (
              <p className={cn("text-base", has ? "text-ink-900" : "text-grey-600")}>
                {words.length ? words.join(" · ") : "None yet."}
              </p>
            )}
            {save.isSuccess && <p className="text-sm text-success-600">Saved. The hotel can see them.</p>}
            <Button variant="secondary" onClick={() => setDraft(kept)}>
              {has ? "Change my preferences" : "Tell us your preferences"}
            </Button>
          </div>
        ) : (
          <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); save.mutate(draft); }}>
            <PreferenceFields value={draft} onChange={setDraft} smokingOffered={q.data.smokingOffered} />
            <div className="flex gap-2">
              <Button type="button" variant="ghost" onClick={() => setDraft(null)}>Cancel</Button>
              <Button type="submit" variant="primary" className="flex-1" disabled={save.isPending}>
                {save.isPending ? "Saving…" : "Save my preferences"}
              </Button>
            </div>
            {save.error && !unlockGone(save.error) && (
              <p className="text-sm text-brand-red-700">{messageFrom(save.error)}</p>
            )}
          </form>
        )}
      </CardBody></Card>
    </section>
  );
}
