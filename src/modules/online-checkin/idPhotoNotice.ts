/* ══════════════════════════════════════════════════════════════════
   THE ID PHOTO'S NOTICE AND CONSENT (D27-207, D27-210)

   Shown BEFORE the file button, every time: what is asked for, the
   Aadhaar rule, why, who sees it, how long, and the tick. The owner
   approved these words for the launch on 30 September 2026; the lawyer
   reads them after. The notice names the hotel and nothing else (D21-27).

   ⚠ A CHANGE OF WORDS IS A NEW VERSION. The server writes the version on
   every photo's row (api/src/routes/idPhotos.ts, NOTICE_VERSION), so what
   an earlier guest agreed to is not rewritten by a later edit. Change the
   words here and the date in both places.
   ══════════════════════════════════════════════════════════════════ */

export const ID_PHOTO_NOTICE_VERSION = "2026-09-30";

/** The one sentence every screen that takes an ID photo shows, the desk's
    included: Aadhaar only with its first 8 digits hidden. */
export const AADHAAR_MASKED = "Aadhaar: cover the first 8 digits before you take the photo, "
  + "or use a masked Aadhaar from UIDAI. A photo showing the full number will be removed "
  + "and we will ask you again.";

export interface IdPhotoNotice {
  heading: string;
  /** Each a label and its sentence, in the order they are read. */
  points: { label: string; text: string }[];
  agree: string;
  skip: string;
}

export function idPhotoNotice(hotel: string, contact: string | null): IdPhotoNotice {
  return {
    heading: "A photo of your ID (optional)",
    points: [
      { label: "What we ask for", text: "a photo of one government photo ID: passport, driving licence, voter ID or Aadhaar." },
      { label: "Aadhaar", text: AADHAAR_MASKED.replace("Aadhaar: c", "C") },
      { label: "Why", text: "so the front desk can check your details before you arrive. You still show the ID itself at the desk." },
      { label: "Who sees it", text: `the front desk and managers of ${hotel}. Nobody else. It is stored encrypted.` },
      {
        label: "How long",
        text: `${hotel} keeps it with your booking. To have it deleted, or to ask about it, contact ${hotel}`
          + `${contact ? ` at ${contact}` : ""}.`,
      },
    ],
    agree: `I agree to ${hotel} keeping this photo of my ID.`,
    skip: "You can skip this and show your ID at the desk.",
  };
}
