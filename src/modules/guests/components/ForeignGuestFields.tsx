import { Field, Input, NativeSelect, fieldProps } from "@/components/ui";
import {
  countryProblem, documentDatesProblem, expiredDocuments, idNumberProblem, phoneProblem,
} from "../../../../api/src/validate.ts";

/* ══════════════════════════════════════════════════════════════════
   FORM III — what the desk asks a foreign guest (D27-25)

   Immigration and Foreigners Rules 2025, Rule 17 and Form III. The
   owner, 27 September: record every box the portal asks
   (indianfrro.gov.in/formIII); the law's own fields must be filled
   before check-in finishes, the rest may be completed later from the
   register. One set of fields for check-in, the walk-in and "Complete
   details", so the three cannot ask different questions.

   The document's type and number stay with each flow's own ID step;
   these are what Form III asks beyond them. The server applies the
   same rule (api/src/modules/guests/formIII.ts) and refuses
   independently.
   ══════════════════════════════════════════════════════════════════ */

export const PURPOSES = [
  ["tourism", "Tourism"], ["business", "Business"], ["employment", "Employment"],
  ["medical", "Medical"], ["student", "Student"], ["conference", "Conference"],
  ["others", "Others"],
] as const;

/** A document's types: exactly what gd_id_type_valid (013) permits. */
export const ID_TYPES = [
  ["passport", "Passport"], ["aadhaar", "Aadhaar"],
  ["driving_licence", "Driving licence"], ["voter", "Voter ID"], ["other", "Other"],
] as const;

/** The portal's own three. */
const GENDERS = [["female", "Female"], ["male", "Male"], ["transgender", "Transgender"]] as const;

type Kind = "text" | "date" | "tel" | "gender" | "purpose" | "yesno";
type Spec = readonly [key: string, label: string, kind: Kind];

/* In Form III's order, then the portal's own boxes. */
const PERSON: Spec[] = [
  ["visaNumber", "Visa or OCI number", "text"],
  ["visaType", "Visa type", "text"],
  ["phoneInIndia", "Phone in India", "tel"],
  ["mobileInIndia", "Mobile in India", "tel"],
  ["phoneAbroad", "Phone outside India", "tel"],
  ["mobileAbroad", "Mobile outside India", "tel"],
  ["gender", "Gender", "gender"],
  ["dateOfBirth", "Date of birth", "date"],
  ["passportIssuedOn", "Passport issued on", "date"],
  ["passportIssuePlace", "Passport issued at", "text"],
  ["passportIssueCountry", "Passport issuing country", "text"],
  ["passportExpiry", "Passport expiry", "date"],
  ["visaIssuedOn", "Visa issued on", "date"],
  ["visaIssuePlace", "Visa issued at", "text"],
  ["visaIssueCountry", "Visa issuing country", "text"],
  ["visaExpiry", "Visa expiry", "date"],
  ["addressLine", "Address abroad", "text"],
  ["city", "City abroad", "text"],
  ["country", "Country abroad", "text"],
];
const VISIT: Spec[] = [
  ["arrivedFrom", "Arrived from", "text"],
  ["previousStay", "Previous place of stay", "text"],
  ["purpose", "Purpose of visit", "purpose"],
  ["purposeOther", "Other purpose", "text"],
  ["arrivedInIndiaOn", "Arrived in India on", "date"],
  ["arrivalPort", "Port of arrival in India", "text"],
  ["employedInIndia", "Employed in India", "yesno"],
  ["refAddress", "Reference address in India", "text"],
  ["refCity", "Reference city", "text"],
  ["refState", "Reference state", "text"],
  ["refPincode", "Reference PIN code", "text"],
  ["remarks", "Remarks", "text"],
];
/* The four numbers are this visit's (form_iii_stays), not the document's. */
const CONTACTS = ["phoneInIndia", "mobileInIndia", "phoneAbroad", "mobileAbroad"];
const IDENTITY_KEYS = PERSON.map(([k]) => k).filter((k) => !CONTACTS.includes(k));

/** Every answer, as typed. `employedInIndia` is "yes", "no" or "". */
export type Particulars = Record<string, string>;
export const NO_PARTICULARS: Particulars = {};

/** What the law's Form III needs - the server's rule, mirrored so the
    clerk finds out on the step that asks. A citizen of
    Nepal or Bhutan needs no visa (Exemption Order 2025, cl. 3(1)(c)); an
    ID skipped for a reason takes its visa with it. */
function requiredKeys(nationality: string, idCaptured: boolean): string[] {
  const code = nationality.trim().toUpperCase() || "IN";
  if (code === "IN") return [];
  return [
    ...(idCaptured && code !== "NP" && code !== "BT" ? ["visaNumber", "visaType"] : []),
    "phoneInIndia", "arrivedFrom", "purpose", "previousStay",
  ];
}

/** The labels of what is still blank, for the sentence under the button. */
export function formIIIMissing(
  p: Particulars, nationality: string, idCaptured: boolean,
): string[] {
  const label = new Map([...PERSON, ...VISIT].map(([k, l]) => [k, l]));
  return requiredKeys(nationality, idCaptured)
    .filter((k) => !p[k]?.trim()).map((k) => label.get(k)!);
}

/** What the server's identityProblem (api/src/modules/guests/formIII.ts)
    will refuse, asked here from the same validate.ts so the clerk hears it
    on the ID step (round D, 28 September): the number by its type, an
    impossible date, a country or a phone that is not one. `today` is the
    business date. */
export function idProblem(
  p: Particulars, idType: string, idNumber: string, nationality: string, today: string,
): string | null {
  return idNumberProblem(idType, idNumber) ?? documentDatesProblem(p, today)
    ?? countryProblem(nationality)
    ?? phoneProblem(p["phoneInIndia"]) ?? phoneProblem(p["mobileInIndia"])
    ?? phoneProblem(p["phoneAbroad"]) ?? phoneProblem(p["mobileAbroad"]);
}

/** An expired passport or visa: WARNED, then recorded as typed (the owner,
    28 September) - the flow asks "check in anyway?". */
export const idExpired = (p: Particulars, today: string): string[] => expiredDocuments(p, today);

/** The two halves the server takes: the person's, and this visit's.
    Only what was typed is sent - a blank never overwrites an answer. */
export function particularsPayload(p: Particulars) {
  const pick = (keys: string[]) => Object.fromEntries(
    keys.filter((k) => p[k]?.trim()).map((k) => [k, p[k]!.trim()]));
  const visitKeys = [...CONTACTS, "nextDestination",
    ...VISIT.map(([k]) => k).filter((k) => k !== "employedInIndia")];
  return {
    identity: pick(IDENTITY_KEYS),
    visit: {
      ...pick(visitKeys),
      ...(p["employedInIndia"] ? { employedInIndia: p["employedInIndia"] === "yes" } : {}),
    },
  };
}

export function ForeignGuestFields({
  value, onChange, nationality, idCaptured, withNextDestination = false,
}: {
  value: Particulars;
  onChange: (next: Particulars) => void;
  nationality: string;
  idCaptured: boolean;
  /** "Complete details" after check-out edits where they went, too. */
  withNextDestination?: boolean;
}) {
  const required = new Set(requiredKeys(nationality, idCaptured));

  const field = ([key, label, kind]: Spec) => {
    if (key === "purposeOther" && value["purpose"] !== "others") return null;
    const set = (v: string) => onChange({ ...value, [key]: v });
    return (
      <Field key={key} label={label} required={required.has(key)}>
        {(f) =>
          kind === "gender" || kind === "purpose" || kind === "yesno" ? (
            <NativeSelect id={f.id} aria-describedby={f.describedBy}
              value={value[key] ?? ""} onChange={(e) => set(e.target.value)}>
              <option value="">Not recorded</option>
              {(kind === "gender" ? GENDERS : kind === "purpose" ? PURPOSES
                : [["yes", "Yes"], ["no", "No"]] as const).map(([v, l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </NativeSelect>
          ) : (
            <Input {...fieldProps(f)} type={kind} value={value[key] ?? ""}
              onChange={(e) => set(e.target.value)} />
          )
        }
      </Field>
    );
  };

  return (
    <div className="space-y-4 border-l-2 border-brand-yellow pl-3.5" data-form-iii>
      <p className="text-2xs text-grey-600">
        Form III goes to the FRRO portal within 24 hours of arrival, and the
        departure within 24 hours of leaving. Starred fields are needed now;
        the rest can be completed later from the Form III register.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">{PERSON.map(field)}</div>
      <p className="text-sm font-medium text-ink-900">This visit</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {VISIT.map(field)}
        {withNextDestination && field(["nextDestination", "Next destination", "text"])}
      </div>
    </div>
  );
}
