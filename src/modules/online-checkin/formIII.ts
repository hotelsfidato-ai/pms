import { dateShort } from "@/lib/format";

/* ══════════════════════════════════════════════════════════════════
   WHAT A GUEST ADDS BEFORE THEY ARRIVE (D27-169)

   The arrival time, their requests, the nationality, and for a foreign
   guest Form III's own questions about the person and the visit
   (migration 147: the portal's lists, read 27 September) - not its
   remarks or the next destination, which stay with the desk. One list of
   names for the guest's form and the desk's card, so the clerk reads the
   question the guest was asked.
   ══════════════════════════════════════════════════════════════════ */

export const GENDERS = [
  { value: "female", label: "Female" },
  { value: "male", label: "Male" },
  { value: "transgender", label: "Transgender" },
];

export const PURPOSES = [
  { value: "tourism", label: "Tourism" },
  { value: "business", label: "Business" },
  { value: "employment", label: "Employment" },
  { value: "medical", label: "Medical" },
  { value: "student", label: "Study" },
  { value: "conference", label: "Conference" },
  { value: "others", label: "Something else" },
];

/** Each field's question, in the order the form asks it. */
export const LABELS: Record<string, string> = {
  expectedArrival: "Arriving at about",
  specialRequests: "Requests",
  nationality: "Nationality",
  gender: "Gender",
  dateOfBirth: "Date of birth",
  passportIssuedOn: "Passport issued on",
  passportIssuePlace: "Passport issued at",
  passportIssueCountry: "Passport issued by",
  visaType: "Visa type",
  visaIssuedOn: "Visa issued on",
  visaIssuePlace: "Visa issued at",
  visaIssueCountry: "Visa issued by",
  arrivedFrom: "Coming from",
  previousStay: "Stayed before this at",
  purpose: "Purpose of the visit",
  purposeOther: "The purpose, in their words",
  arrivedInIndiaOn: "Arrived in India on",
  arrivalPort: "Arrived in India at",
  mobileInIndia: "Mobile in India",
  phoneInIndia: "Phone in India",
  mobileAbroad: "Mobile abroad",
  phoneAbroad: "Phone abroad",
  employedInIndia: "Employed in India",
  refAddress: "Address in India",
  refCity: "City in India",
  refState: "State in India",
  refPincode: "PIN code in India",
};

const DATES = new Set(["dateOfBirth", "passportIssuedOn", "visaIssuedOn", "arrivedInIndiaOn"]);
const word = (list: { value: string; label: string }[], v: string) =>
  list.find((o) => o.value === v)?.label ?? v;

/** The desk's lines for what the guest sent: only what they filled in, in
    the form's order, each under the question it answered. */
export function moreLines(more: Record<string, string | boolean>): [string, string][] {
  return Object.keys(LABELS).filter((k) => more[k] !== undefined && more[k] !== "").map((k) => {
    const v = more[k]!;
    const shown = typeof v === "boolean" ? (v ? "Yes" : "No")
      : DATES.has(k) ? dateShort(v)
      : k === "gender" ? word(GENDERS, v)
      : k === "purpose" ? word(PURPOSES, v)
      : k === "nationality" && v === "IN" ? "Indian"
      : v;
    return [LABELS[k]!, shown];
  });
}
