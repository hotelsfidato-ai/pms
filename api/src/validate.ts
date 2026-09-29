/* ══════════════════════════════════════════════════════════════════
   WHAT A TYPED VALUE MAY BE — ONE FILE, READ BY THE SERVER AND THE WEBSITE

   The QA of 28 September found impossible values saved everywhere a
   person types: a phone "abc", an Aadhaar "12ab", nationality "ZZ", an
   FRRO number "!", 400 nights, a price of 0 nobody meant (X-1, X-2, X-3,
   FD-2, BK-4, GU-2, GU-3, RT-4). Each rule below is the owner's (the
   answers of 28 September, round D; the phone rule is also their 21
   September one for matching a returning guest).

   Each check answers null when the value will do, or the sentence to
   show. A blank is not a problem here: whether a field may be left out
   is the caller's question, asked before it calls.

   ⚠ THIS FILE IMPORTS NOTHING, as permissions.ts does, and must stay
   that way: it is compiled by both packages and bundled into the
   website. The server is the rule; a screen may ask the same function
   first so the clerk hears it before pressing the button.
   ══════════════════════════════════════════════════════════════════ */

type Text = string | null | undefined;
const blank = (v: Text): v is null | undefined | "" => !v?.trim();

/* ── Phone and email (X-2) ───────────────────────────────────────── */

/** Digits, spaces, a leading +, hyphens and brackets; 10 to 15 digits in
    all; not all one digit - the owner's 21 September rule, so every phone
    kept can be found and matched (app.phone_key). */
export function phoneProblem(phone: Text): string | null {
  if (blank(phone)) return null;
  const p = phone.trim();
  const digits = p.replace(/\D/g, "");
  return /^\+?[\d\s()-]+$/.test(p) && digits.length >= 10 && digits.length <= 15
    && !/^(\d)\1*$/.test(digits)
    ? null
    : `"${p}" is not a phone number. Type 10 to 15 digits, e.g. +91 98765 43210.`;
}

/** Something@something.something, no spaces, at most 254 characters.
    Whether the mailbox exists is not something a form can know. */
export function emailProblem(email: Text): string | null {
  if (blank(email)) return null;
  const e = email.trim();
  return e.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)
    ? null
    : `"${e}" is not an email address, e.g. name@example.com.`;
}

/* ── Identity documents (FD-2, GP-1, GU-2) ────────────────────────── */

/* Verhoeff's tables, the check digit UIDAI puts at the end of every
   Aadhaar number: it catches one mistyped digit and two swapped ones. */
const D = ["0123456789", "1234067895", "2340178956", "3401289567", "4012395678",
  "5987604321", "6598710432", "7659821043", "8765932104", "9876543210"];
const P = ["0123456789", "1576283094", "5803796142", "8916043527", "9453126870",
  "4286573901", "2793806415", "7046913258"];

function verhoeffOk(digits: string): boolean {
  let c = 0;
  [...digits].reverse().forEach((d, i) => {
    c = Number(D[c]![Number(P[i % 8]![Number(d)])]);
  });
  return c === 0;
}

/** Twelve digits (spaces allowed), never starting 0 or 1, with UIDAI's
    check digit right. */
export function aadhaarProblem(number: Text): string | null {
  if (blank(number)) return null;
  const n = number.replace(/\s/g, "");
  if (!/^[2-9]\d{11}$/.test(n)) {
    return "An Aadhaar number is 12 digits and does not start with 0 or 1.";
  }
  return verhoeffOk(n)
    ? null
    : "That Aadhaar number is not right - a digit is mistyped. Check it against the card.";
}

/** The number on the document, by its type: Aadhaar as above; a passport
    6 to 15 letters and digits; anything else at least 4 characters. */
export function idNumberProblem(type: Text, number: Text): string | null {
  if (blank(number)) return null;
  const n = number.trim();
  if (type === "aadhaar") return aadhaarProblem(n);
  if (type === "passport") {
    return /^[A-Za-z0-9]{6,15}$/.test(n)
      ? null
      : "A passport number is 6 to 15 letters and digits, e.g. A1234567.";
  }
  return n.length >= 4 && n.length <= 40
    ? null
    : "A document number is 4 to 40 characters.";
}

/** The dates on a person's documents. Impossible ones are refused (the
    owner, 28 September): a birth or an issue date in the future, a
    document expiring before it was issued. `today` is the property's
    business date, YYYY-MM-DD. An EXPIRED document is not refused here -
    see expiredDocuments. */
export function documentDatesProblem(doc: {
  dateOfBirth?: Text; passportIssuedOn?: Text; passportExpiry?: Text;
  visaIssuedOn?: Text; visaExpiry?: Text;
}, today: string): string | null {
  for (const [value, what] of [
    [doc.dateOfBirth, "date of birth"], [doc.passportIssuedOn, "passport's issue date"],
    [doc.visaIssuedOn, "visa's issue date"], [doc.passportExpiry, "passport's expiry date"],
    [doc.visaExpiry, "visa's expiry date"],
  ] as const) {
    if (!blank(value) && dateProblem(value)) return `The ${what} is not a date.`;
  }
  if (!blank(doc.dateOfBirth) && doc.dateOfBirth > today) return "The date of birth is in the future.";
  if (!blank(doc.passportIssuedOn) && doc.passportIssuedOn > today) {
    return "The passport's issue date is in the future.";
  }
  if (!blank(doc.visaIssuedOn) && doc.visaIssuedOn > today) return "The visa's issue date is in the future.";
  if (!blank(doc.passportIssuedOn) && !blank(doc.passportExpiry)
      && doc.passportExpiry < doc.passportIssuedOn) {
    return "The passport expires before it was issued.";
  }
  if (!blank(doc.visaIssuedOn) && !blank(doc.visaExpiry) && doc.visaExpiry < doc.visaIssuedOn) {
    return "The visa expires before it was issued.";
  }
  return null;
}

/** A passport or visa already expired on `onDate` - WARNED, then recorded
    as typed (the owner, 28 September): the guest is standing there, and
    Form III has to report the true facts. The screen asks "check in
    anyway?"; the server does not refuse. */
export function expiredDocuments(doc: { passportExpiry?: Text; visaExpiry?: Text },
  onDate: string): string[] {
  return [
    ...(!blank(doc.passportExpiry) && doc.passportExpiry < onDate
      ? [`The passport expired on ${doc.passportExpiry}.`] : []),
    ...(!blank(doc.visaExpiry) && doc.visaExpiry < onDate
      ? [`The visa expired on ${doc.visaExpiry}.`] : []),
  ];
}

/* ── Nationality (BK-4) ──────────────────────────────────────────── */

/* ISO 3166-1 alpha-2, the 249 codes assigned, plus XK: Kosovo is not
   assigned by ISO, but its citizens travel and have to be recorded as
   something (the EU and most registers use XK). Checked against the
   platform's own region names on 28 September. */
const COUNTRIES = new Set((
  "AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR "
  + "BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ "
  + "EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW "
  + "GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY "
  + "KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV "
  + "MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY "
  + "QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG "
  + "TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM "
  + "ZW XK").split(" "));

export function countryProblem(code: Text): string | null {
  if (blank(code)) return null;
  const c = code.trim().toUpperCase();
  return COUNTRIES.has(c)
    ? null
    : `"${c}" is not a country code. Type the two letters, e.g. IN, GB or US.`;
}

/* ── A company's GSTIN (contracts, D27-178) ──────────────────────── */

/* GSTN's check digit, the 15th character: each of the first 14 read in
   base 36, weighted 1, 2, 1, 2 ...; a product's two base-36 digits added.
   It catches one mistyped character and most swapped pairs. */
const B36 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/** Fifteen characters in the GSTIN's shape (state code, PAN, entity, Z,
    check), with GSTN's check digit right. Case is not a mistake. */
export function gstinProblem(gstin: Text): string | null {
  if (blank(gstin)) return null;
  const g = gstin.trim().toUpperCase();
  if (!/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$/.test(g)) {
    return "A GSTIN is 15 characters: 2 digits, the 10-character PAN, then 3 more, e.g. 27AAPFU0939F1ZV.";
  }
  let sum = 0;
  for (let i = 0; i < 14; i += 1) {
    const product = B36.indexOf(g[i]!) * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(product / 36) + (product % 36);
  }
  return B36[(36 - (sum % 36)) % 36] === g[14]
    ? null
    : "That GSTIN is not right - a character is mistyped. Check it against the company's GST certificate.";
}

/* ── The Form III portal's number (GU-3) ─────────────────────────── */

/** Letters, digits, - and /; 6 to 30 characters; at least one digit (the
    owner, 28 September: loose enough for whatever the portal issues). */
export function portalNumberProblem(reference: Text): string | null {
  if (blank(reference)) return null;
  const r = reference.trim();
  return /^[A-Za-z0-9/-]{6,30}$/.test(r) && /\d/.test(r)
    ? null
    : "The portal's number is 6 to 30 letters and digits (- and / allowed), with at least one digit.";
}

/* ── Rooms (RT-4) ────────────────────────────────────────────────── */

export function roomNumberProblem(number: Text): string | null {
  if (blank(number)) return null;
  return /^[A-Za-z0-9-]{1,10}$/.test(number.trim())
    ? null
    : "A room number is at most 10 letters and digits (and -), e.g. 204 or A-12.";
}

/** 0 (the ground floor) to 99; null is "not recorded". */
export function floorProblem(floor: number | null | undefined): string | null {
  if (floor === null || floor === undefined) return null;
  return Number.isInteger(floor) && floor >= 0 && floor <= 99
    ? null
    : "A floor is a whole number from 0 (the ground floor) to 99.";
}

/* ── Counts and dates (FD-4, FD-6, FD-8, FD-9) ───────────────────── */

/** The most nights one walk-in or one change of dates covers (the owner,
    28 September). A longer stay is split into two bookings. */
export const MAX_NIGHTS = 90;

/** A whole number from `min` to `max`, e.g. adults 1-99, children 0-99. */
export function countProblem(value: unknown, what: string, min: number, max = 99): string | null {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max
    ? null
    : `${what} is a whole number from ${min} to ${max}.`;
}

/** A real calendar date written YYYY-MM-DD. */
export function dateProblem(value: Text): string | null {
  if (blank(value) || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return "Choose a date.";
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value
    ? null
    : `${value} is not a date.`;
}

/* ── Prices (X-1, D27-120) ───────────────────────────────────────── */

/** The largest figure a money column holds - numeric(12,2). */
const MONEY_MAX = 9_999_999_999.99;

/** A typed price: null is "not priced yet" and passes (the caller says
    whether blank is allowed); 0 only when ticked Free (the owner, D27-120);
    never negative, never past what the database can hold. */
export function priceProblem(price: number | null | undefined, free: boolean): string | null {
  if (price === null || price === undefined) return null;
  if (!Number.isFinite(price) || price < 0) return "A price is a number, 0 or more.";
  if (price > MONEY_MAX) return "That figure is larger than any price the system can hold. Check it.";
  if (price === 0 && !free) {
    return "0 is kept only when it is ticked Free. Leave it blank if nobody has priced it yet.";
  }
  return null;
}
