import type { Client } from "../../db.ts";
import {
  countryProblem, documentDatesProblem, idNumberProblem, phoneProblem,
} from "../../validate.ts";

/* ══════════════════════════════════════════════════════════════════
   FORM III — what the desk records about a foreign guest (D27-25)

   Immigration and Foreigners Rules 2025, Rule 17 and Form III: the
   keeper takes every foreigner's particulars on arrival and where they
   go on departure, keeps them a year, and files each on the portal
   within 24 hours. The owner, 27 September: the system records every
   box the portal asks; the law's own fields must be there before a
   foreign guest is checked in, the rest may be completed later on the
   register ("Complete details").

   One rule and two savers, here, because check-in, walk-in, check-out
   and the register all write the same record - four copies of "what
   is required" would be four answers.
   ══════════════════════════════════════════════════════════════════ */

/** The person: guest_documents (013, 147). */
export interface Identity {
  idType?: string;
  idNumber?: string;
  nationality?: string;
  passportExpiry?: string;
  visaNumber?: string;
  visaExpiry?: string;
  addressLine?: string;
  city?: string;
  country?: string;
  gender?: string;
  dateOfBirth?: string;
  passportIssuedOn?: string;
  passportIssuePlace?: string;
  passportIssueCountry?: string;
  visaType?: string;
  visaIssuedOn?: string;
  visaIssuePlace?: string;
  visaIssueCountry?: string;
}

/** The visit: form_iii_stays (147). */
export interface Visit {
  arrivedFrom?: string;
  previousStay?: string;
  purpose?: string;
  purposeOther?: string;
  phoneInIndia?: string;
  mobileInIndia?: string;
  phoneAbroad?: string;
  mobileAbroad?: string;
  arrivedInIndiaOn?: string;
  arrivalPort?: string;
  employedInIndia?: boolean;
  refAddress?: string;
  refCity?: string;
  refState?: string;
  refPincode?: string;
  remarks?: string;
  nextDestination?: string;
}

/** Anybody not Indian, OCI cardholders included (Rule 17(1)). */
export const isForeign = (nationality?: string | null): boolean =>
  (nationality?.trim().toUpperCase() || "IN") !== "IN";

const blank = (v?: string | null) => !v?.trim();

/** The sentence refusing a foreign guest's check-in, or null.

    The law's Form III fields: visa or OCI number and its type, phone
    in India, arrived from, purpose, previous place of stay. A citizen
    of Nepal or Bhutan needs no visa (Exemption Order 2025, S.O.
    3997(E), cl. 3(1)(c)), so none is asked of them. With the ID
    skipped for a reason (as today) the document's fields are not
    asked; the visit's still are - the guest answers those, no scanner
    needed. */
export function formIIIRefusal(
  identity: Identity | undefined, visit: Visit | undefined, idCaptured: boolean,
): string | null {
  const nationality = identity?.nationality?.trim().toUpperCase();
  if (!isForeign(nationality)) return null;

  const missing: string[] = [];
  if (idCaptured && nationality !== "NP" && nationality !== "BT") {
    if (blank(identity?.visaNumber)) missing.push("visa or OCI number");
    if (blank(identity?.visaType)) missing.push("visa type");
  }
  if (blank(visit?.phoneInIndia)) missing.push("phone in India");
  if (blank(visit?.arrivedFrom)) missing.push("arrived from");
  if (blank(visit?.purpose)) missing.push("purpose of visit");
  if (blank(visit?.previousStay)) missing.push("previous place of stay");

  return missing.length
    ? `Form III needs a foreign guest's ${missing.join(", ")}.`
    : null;
}

/** What a typed document or visit may NOT be (round D, the owner's answers
    of 28 September), for every guest, Indian or foreign: the number by its
    type (an Aadhaar is 12 digits with UIDAI's check digit, FD-2; a passport
    6 to 15 letters and digits), an impossible date (GU-2), a country that
    is not one (BK-4), a phone that is not one (X-2). `today` is the
    business date. An EXPIRED passport or visa is not refused: the screen
    warns, and it is recorded as typed. One rule for check-in, walk-in and
    the register, as formIIIRefusal is. */
export function identityProblem(
  identity: Identity | undefined, visit: Visit | undefined, today: string,
): string | null {
  return idNumberProblem(identity?.idType, identity?.idNumber)
    ?? documentDatesProblem(identity ?? {}, today)
    ?? countryProblem(identity?.nationality)
    ?? phoneProblem(visit?.phoneInIndia) ?? phoneProblem(visit?.mobileInIndia)
    ?? phoneProblem(visit?.phoneAbroad) ?? phoneProblem(visit?.mobileAbroad);
}

const text = (v?: string | null) => v?.trim() || null;

/** The person's document. Only what was typed is written: a clerk adding
    a date of birth today must not blank the passport recorded last year.
    Who saw it (026) moves only when a document number is recorded. */
export async function saveIdentity(
  client: Client, guestId: string, id: Identity,
): Promise<void> {
  await client.query(
    `insert into guest_documents
       (guest_id, id_type, id_number, passport_expiry, visa_number, visa_expiry,
        address_line, city, country, gender, date_of_birth,
        passport_issued_on, passport_issue_place, passport_issue_country,
        visa_type, visa_issued_on, visa_issue_place, visa_issue_country,
        captured_by, captured_at)
     values ($1,$2,$3,$4::date,$5,$6::date,$7,$8,$9,$10,$11::date,
             $12::date,$13,$14,$15,$16::date,$17,$18,
             case when $3::text is null then null else app.current_user_id() end,
             case when $3::text is null then null else now() end)
     on conflict (guest_id) do update set
       id_type                = coalesce(excluded.id_type, guest_documents.id_type),
       id_number              = coalesce(excluded.id_number, guest_documents.id_number),
       passport_expiry        = coalesce(excluded.passport_expiry, guest_documents.passport_expiry),
       visa_number            = coalesce(excluded.visa_number, guest_documents.visa_number),
       visa_expiry            = coalesce(excluded.visa_expiry, guest_documents.visa_expiry),
       address_line           = coalesce(excluded.address_line, guest_documents.address_line),
       city                   = coalesce(excluded.city, guest_documents.city),
       country                = coalesce(excluded.country, guest_documents.country),
       gender                 = coalesce(excluded.gender, guest_documents.gender),
       date_of_birth          = coalesce(excluded.date_of_birth, guest_documents.date_of_birth),
       passport_issued_on     = coalesce(excluded.passport_issued_on, guest_documents.passport_issued_on),
       passport_issue_place   = coalesce(excluded.passport_issue_place, guest_documents.passport_issue_place),
       passport_issue_country = coalesce(excluded.passport_issue_country, guest_documents.passport_issue_country),
       visa_type              = coalesce(excluded.visa_type, guest_documents.visa_type),
       visa_issued_on         = coalesce(excluded.visa_issued_on, guest_documents.visa_issued_on),
       visa_issue_place       = coalesce(excluded.visa_issue_place, guest_documents.visa_issue_place),
       visa_issue_country     = coalesce(excluded.visa_issue_country, guest_documents.visa_issue_country),
       captured_by            = coalesce(excluded.captured_by, guest_documents.captured_by),
       captured_at            = coalesce(excluded.captured_at, guest_documents.captured_at)`,
    [guestId, text(id.idType), text(id.idNumber), text(id.passportExpiry),
     text(id.visaNumber), text(id.visaExpiry), text(id.addressLine), text(id.city),
     text(id.country), text(id.gender), text(id.dateOfBirth),
     text(id.passportIssuedOn), text(id.passportIssuePlace),
     text(id.passportIssueCountry), text(id.visaType), text(id.visaIssuedOn),
     text(id.visaIssuePlace), text(id.visaIssueCountry)],
  );
}

/** An ID number as it may be shown beyond the register: an Aadhaar is its
    last four only until the lawyer answers (D25-37), any other whole, as the
    clerk compares it with the card in their hand. */
export const maskedId = (type: string | null, number: string | null): string | null =>
  number && type === "aadhaar" ? `XXXX XXXX ${number.slice(-4)}` : number;

/** The visit's particulars. Same rule: only what was typed is written, so
    check-out's next destination leaves the arrival's answers alone.
    `companion`: whose they are, when not the booking's lead guest (D27-382). */
export async function saveVisit(
  client: Client, hotelId: string, reservationId: string, v: Visit, companion?: string,
): Promise<void> {
  await client.query(
    `insert into form_iii_stays
       (hotel_id, reservation_id, arrived_from, previous_stay, purpose,
        purpose_other, phone_in_india, arrived_in_india_on, arrival_port,
        employed_in_india, ref_address, ref_city, ref_state, ref_pincode,
        remarks, next_destination, mobile_in_india, phone_abroad,
        mobile_abroad, updated_by, guest_id)
     values ($1,$2,$3,$4,$5,$6,$7,$8::date,$9,$10,$11,$12,$13,$14,$15,$16,
             $17,$18,$19, app.current_user_id(), $20)
     on conflict (reservation_id, guest_id) do update set
       arrived_from        = coalesce(excluded.arrived_from, form_iii_stays.arrived_from),
       previous_stay       = coalesce(excluded.previous_stay, form_iii_stays.previous_stay),
       purpose             = coalesce(excluded.purpose, form_iii_stays.purpose),
       purpose_other       = coalesce(excluded.purpose_other, form_iii_stays.purpose_other),
       phone_in_india      = coalesce(excluded.phone_in_india, form_iii_stays.phone_in_india),
       arrived_in_india_on = coalesce(excluded.arrived_in_india_on, form_iii_stays.arrived_in_india_on),
       arrival_port        = coalesce(excluded.arrival_port, form_iii_stays.arrival_port),
       employed_in_india   = coalesce(excluded.employed_in_india, form_iii_stays.employed_in_india),
       ref_address         = coalesce(excluded.ref_address, form_iii_stays.ref_address),
       ref_city            = coalesce(excluded.ref_city, form_iii_stays.ref_city),
       ref_state           = coalesce(excluded.ref_state, form_iii_stays.ref_state),
       ref_pincode         = coalesce(excluded.ref_pincode, form_iii_stays.ref_pincode),
       remarks             = coalesce(excluded.remarks, form_iii_stays.remarks),
       next_destination    = coalesce(excluded.next_destination, form_iii_stays.next_destination),
       mobile_in_india     = coalesce(excluded.mobile_in_india, form_iii_stays.mobile_in_india),
       phone_abroad        = coalesce(excluded.phone_abroad, form_iii_stays.phone_abroad),
       mobile_abroad       = coalesce(excluded.mobile_abroad, form_iii_stays.mobile_abroad),
       updated_by          = excluded.updated_by`,
    [hotelId, reservationId, text(v.arrivedFrom), text(v.previousStay),
     text(v.purpose), text(v.purposeOther), text(v.phoneInIndia),
     text(v.arrivedInIndiaOn), text(v.arrivalPort), v.employedInIndia ?? null,
     text(v.refAddress), text(v.refCity), text(v.refState), text(v.refPincode),
     text(v.remarks), text(v.nextDestination), text(v.mobileInIndia),
     text(v.phoneAbroad), text(v.mobileAbroad), companion ?? null],
  );
}

/** The room's foreign companions leave with it (Rule 17(1)): the next
    destination the desk was given, for whoever has none of their own. */
export async function saveCompanionsDeparture(
  client: Client, hotelId: string, reservationId: string, nextDestination: string,
): Promise<void> {
  await client.query(
    `insert into form_iii_stays (hotel_id, reservation_id, guest_id, next_destination, updated_by)
     select $1, $2, c.guest_id, $3, app.current_user_id()
       from stay_companions c join guests g on g.id = c.guest_id
      where c.reservation_id = $2 and g.nationality <> 'IN'
     on conflict (reservation_id, guest_id) do update set
       next_destination = coalesce(form_iii_stays.next_destination, excluded.next_destination),
       updated_by       = excluded.updated_by`,
    [hotelId, reservationId, nextDestination],
  );
}
