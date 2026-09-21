/* ══════════════════════════════════════════════════════════════════
   THE PRIVACY NOTICE — a place for its words, and no words yet (D21-61)

   The owner's answer: the page shows a short notice BEFORE THE FIRST
   QUESTION - what is asked, why, who sees it, how long it is kept. The
   master drafted it (`docs/go-live/privacy-notice-draft.md`, section A)
   and the owner's advisor checks it. The draft still has blanks only the
   owner and the advisor can fill - how long an ID is kept (D21-11), the
   company's legal name, the grievance officer - so NOTHING is shown to a
   guest until those are settled. Words a lawyer has not read, on the one
   page a stranger opens, are worse than a gap.

   When the words are approved they go here, once, as a function of the
   hotel's name (the notice names no group, D21-27), and the page shows
   them above the first question with no other change.
   ══════════════════════════════════════════════════════════════════ */

export interface PrivacyNotice {
  heading: string;
  body: string;
}

/** The notice for this hotel - or null while the advisor has not approved it. */
export function privacyNoticeFor(_hotelName: string): PrivacyNotice | null {
  return null;
}
