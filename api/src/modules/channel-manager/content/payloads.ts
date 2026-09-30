import type { HotelContent, RoomTypeContent, MealPlanContent } from "./store.ts";
import { SU_ENDPOINTS } from "../su/codes.ts";

/* ══════════════════════════════════════════════════════════════════
   THE CONTENT REQUESTS — built from the PMS, checked before any is sent

   SU's three content calls, from its documents:

   Property   OTA_HotelDescriptiveContentNotif
              HotelDescriptiveContentNotifType "New" the first time, then
              "Overlay" — and an overlay REPLACES what SU holds: "existing
              information will be deleted if you don't include it". So every
              send carries the whole property, never a partial update.

   Room type  OTA_HotelRoom, SellableProduct.InvStatusType
              Initial (create) · Modify (+ InvNotifType Overlay) ·
              Active · Deactivated. RoomRate is required and "should be
              greater than 0"; MaxChildOccupancy "must be less than Maximum
              Occupancy".

   Rate plan  OTA_HotelRatePlan, RatePlanNotifType
              New · Overlay · Activate · Remove (SU's word for deactivate).

   CHECK EVERYTHING, THEN SEND ANYTHING. A problem anywhere stops the whole
   send before the first call, and every problem is named in one list, so
   the owner fixes them in one sitting rather than one refusal at a time.
   Nothing missing is filled in: an empty postcode is a problem, not "".

   Numbers go as strings, the way SU's samples write them, and money as
   the database wrote it.
   ══════════════════════════════════════════════════════════════════ */

export interface ContentRequest {
  kind: "hotel" | "room type" | "rate plan";
  /** What a person recognises: the hotel's, room type's or meal plan's name. */
  name: string;
  /** What SU is asked to do, in the words recorded against the row. */
  action: "created" | "updated" | "activated" | "deactivated";
  endpoint: string;
  payload: unknown;
  roomTypeId?: string;
  mealPlan?: string;
}

/* SU: "Must begin with +, followed by all digits required to dial
   internationally. No whitespace, hyphens, or other characters allowed.
   Not more than 15 numbers." */
const SU_PHONE = /^\+\d{1,15}$/;

/** The phone as SU needs it: spaces and hyphens taken out when it is sent,
    never in the hotel record (the master, 17 September). Anything else that
    is not a digit after the + is left for SU_PHONE to name. */
export const phoneForSu = (phone: string) => phone.trim().replace(/[\s-]/g, "");

export function contentProblems(content: HotelContent): string[] {
  const problems: string[] = [];
  const { hotel, channel } = content;

  if (!channel) {
    return ["The hotel's SU details have not been entered yet: its SU hotel id, "
      + "country and a contact's name."];
  }

  const need = (value: string | null | undefined, what: string) => {
    if (!value || !value.trim()) problems.push(what);
  };
  need(hotel.addressLine, "SU needs the hotel's street address. It is set on the Properties screen.");
  need(hotel.city, "SU needs the hotel's city. It is set on the Properties screen.");
  /* The hotel's own, from its profile (D27-214). */
  need(hotel.postalCode, "SU needs the hotel's postcode: the PIN code in Settings, on the Property tab.");
  need(channel.countryCode, "SU needs the hotel's country.");
  need(hotel.latitude, "SU needs the hotel's latitude. It is set in Settings, on the Property tab.");
  need(hotel.longitude, "SU needs the hotel's longitude. It is set in Settings, on the Property tab.");
  need(channel.contactFirstName, "SU needs a contact's first name.");
  need(channel.contactLastName, "SU needs a contact's last name.");
  need(hotel.email, "SU needs the hotel's email address. It is set on the Properties screen.");

  if (!hotel.phone || !hotel.phone.trim()) {
    problems.push("SU needs the hotel's phone number. It is set on the Properties screen.");
  } else if (!SU_PHONE.test(phoneForSu(hotel.phone))) {
    problems.push(
      "SU needs the hotel's phone number as + and the country code, then the number, "
      + "in digits (spaces and hyphens are fine). Change it on the Properties screen.");
  }

  for (const type of content.roomTypes) {
    const m = type.mapping;
    if (!m?.isConnected) continue;
    const rate = type.rackRate === null ? null : Number(type.rackRate);
    if (rate === null || !(rate > 0)) {
      problems.push(
        `${type.name} has no rack rate, and SU does not list a room type without a price `
        + "above zero. Set it on the Room types screen, or take it off SU.");
    }
    if (m.maxChildren >= type.maxOccupancy) {
      problems.push(
        `${type.name} sleeps ${type.maxOccupancy}, so SU needs the number of children `
        + `to be less than ${type.maxOccupancy}.`);
    }
  }

  return problems;
}

/** Every request to send, in the order SU needs them: the property, then
    its room types, then its rate plans. Call only when contentProblems is
    empty. */
export function contentRequests(content: HotelContent): ContentRequest[] {
  const channel = content.channel!;
  const requests: ContentRequest[] = [propertyRequest(content)];

  for (const type of content.roomTypes) requests.push(...roomTypeRequests(channel.suHotelId, type));
  for (const plan of content.mealPlans) requests.push(...ratePlanRequests(channel.suHotelId, plan));
  return requests;
}

function propertyRequest(content: HotelContent): ContentRequest {
  const { hotel } = content;
  const c = content.channel!;
  const address = {
    AddressLine: hotel.addressLine!.trim(),
    CityName: hotel.city.trim(),
    PostalCode: hotel.postalCode!.trim(),
    CountryName: c.countryCode!.trim(),
  };

  return {
    kind: "hotel", name: hotel.name,
    action: c.onSu ? "updated" : "created",
    endpoint: SU_ENDPOINTS.property,
    payload: {
      HotelDescriptiveContents: {
        HotelDescriptiveContent: {
          HotelName: hotel.name,
          TimeZone: hotel.timezone,
          Platform: "SU",
          hotelid: c.suHotelId,
          LanguageCode: "en",
          CurrencyCode: hotel.currency,
          HotelDescriptiveContentNotifType: c.onSu ? "Overlay" : "New",
          OfficialCheckinTime: hotel.checkIn,
          OfficialCheckoutTime: hotel.checkOut,
          ContactInfos: {
            ContactInfo: [
              { ContactProfileType: "PhysicalLocation", Addresses: { Address: address } },
              {
                ContactProfileType: "availability",
                Names: { Name: { GivenName: c.contactFirstName!.trim(), Surname: c.contactLastName!.trim() } },
                Addresses: { Address: address },
                Emails: { Email: [hotel.email!.trim()] },
                Phones: { Phone: [{ PhoneNumber: phoneForSu(hotel.phone!), PhoneTechType: "1" }] },
              },
            ],
          },
          HotelInfo: { Position: { Latitude: hotel.latitude!, Longitude: hotel.longitude! } },
          ...(c.description?.trim() ? { HotelDescription: c.description.trim() } : {}),
        },
      },
    },
  };
}

function roomTypeRequests(suHotelId: string, type: RoomTypeContent): ContentRequest[] {
  const m = type.mapping;
  if (!m) return [];
  const base = { kind: "room type" as const, name: type.name, endpoint: SU_ENDPOINTS.roomType, roomTypeId: type.id };
  const wrap = (product: unknown) => ({ SellableProducts: { hotelid: suHotelId, SellableProduct: [product] } });

  if (!m.isConnected) {
    /* Off SU only if SU has it on. Never created, or already off: nothing. */
    if (m.onSu !== "active") return [];
    return [{
      ...base, action: "deactivated",
      payload: wrap({ InvNotifType: "Overlay", InvStatusType: "Deactivated", roomid: m.suRoomId }),
    }];
  }

  const guestRoom = {
    Occupancy: { MaxOccupancy: String(type.maxOccupancy), MaxChildOccupancy: String(m.maxChildren) },
    Room: {
      roomid: m.suRoomId,
      RoomRate: type.rackRate!,
      Quantity: String(type.rooms),
      RoomType: String(m.suRoomType),
    },
    Description: { Text: type.name },
  };

  if (m.onSu === null) {
    return [{ ...base, action: "created", payload: wrap({ InvStatusType: "Initial", GuestRoom: guestRoom }) }];
  }

  const modify: ContentRequest = {
    ...base, action: "updated",
    payload: wrap({ InvNotifType: "Overlay", InvStatusType: "Modify", roomid: m.suRoomId, GuestRoom: guestRoom }),
  };
  if (m.onSu === "deactivated") {
    return [{
      ...base, action: "activated",
      payload: wrap({ InvNotifType: "Overlay", InvStatusType: "Active", roomid: m.suRoomId }),
    }, modify];
  }
  return [modify];
}

function ratePlanRequests(suHotelId: string, plan: MealPlanContent): ContentRequest[] {
  const m = plan.mapping;
  if (!m) return [];
  const base = { kind: "rate plan" as const, name: plan.name, endpoint: SU_ENDPOINTS.ratePlan, mealPlan: plan.code };
  const wrap = (ratePlan: unknown) => ({ RatePlans: { hotelid: suHotelId, RatePlan: [ratePlan] } });

  if (!m.isConnected) {
    if (m.onSu !== "active") return [];
    return [{ ...base, action: "deactivated", payload: wrap({ RatePlanNotifType: "Remove", rateplanid: m.suRatePlanId }) }];
  }

  const described = {
    rateplanid: m.suRatePlanId,
    MealPlanID: String(m.suMealPlan),
    Description: { Name: plan.name, Text: plan.includes },
  };

  if (m.onSu === null) {
    return [{ ...base, action: "created", payload: wrap({ RatePlanNotifType: "New", ...described }) }];
  }
  const overlay: ContentRequest = {
    ...base, action: "updated", payload: wrap({ RatePlanNotifType: "Overlay", ...described }),
  };
  if (m.onSu === "deactivated") {
    return [{
      ...base, action: "activated",
      payload: wrap({ RatePlanNotifType: "Activate", rateplanid: m.suRatePlanId }),
    }, overlay];
  }
  return [overlay];
}
