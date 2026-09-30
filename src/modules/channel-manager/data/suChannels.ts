/* ══════════════════════════════════════════════════════════════════
   SU's BOOKING SITES — the code SU sends with every booking

   Copied from SU's "Channel or OTA Codes" page
   (https://suissu.gitbook.io/su-api-documentation/codes/channel-or-ota-codes-1,
   read 30 September 2026), in SU's order. A booking arrives carrying one of
   these as `affiliation.OTA_Code`, and the booking source a person picked it
   for on Booking sources is the one the booking is filed under (D27-183:
   "set in the system, as adding options"). Nothing is matched by name.

   SU lists 275 twice with one name, and 445 twice with two (ixigo,
   Bookcabin): each code is here once.
   ══════════════════════════════════════════════════════════════════ */

export const SU_CHANNELS: ReadonlyArray<readonly [code: string, name: string]> = [
  ["19", "booking.com"], ["9", "expedia"], ["189", "Agoda"], ["150", "Trip.com (OLD)"],
  ["76", "hostelworld"], ["108", "tiket"], ["236", "Odigeo"], ["105", "Goibibo"],
  ["244", "Airbnb"], ["239", "silverdoorapartments"],
  ["153", "D-EDGE Old (Formerly Fastbooking)"], ["61", "HostelsClub"], ["232", "DOTW"],
  ["57", "MitchellCorp"], ["162", "mrandmrssmith"], ["109", "hotelscombined"],
  ["82", "hotelbeds"], ["71", "Sunhotels"], ["253", "VRBO"], ["250", "speedybooker"],
  ["55", "Pan Pacific"], ["87", "HRS"], ["38", "BOOKEASY/BOOKIT"], ["146", "synxis"],
  ["170", "Traveloka (OLD)"], ["275", "Meta Channel"], ["66", "Pacific BedBank"],
  ["263", "Hotel Tonight"], ["96", "Travelport"], ["97", "travelguruxml"], ["207", "Smartie"],
  ["251", "eztravel"], ["106", "AOT"], ["231", "simplebooking"], ["122", "tablethotels"],
  ["181", "despegar"], ["206", "tourplan"], ["183", "dorms"], ["205", "Travelanium"],
  ["0", "Booking Engine"], ["160", "Tomas"], ["59", "Lastminute.com"],
  ["245", "travelstaynetworkxml"], ["185", "Tripmax (Formerly BookingDirect)"],
  ["249", "GetYourWeb"], ["261", "netroomz"], ["37", "EntertainmentBook"],
  ["223", "Amadeus (Travelclick)"], ["79", "Hooroo(Qantas)"], ["64", "Lido"],
  ["179", "Flight Centre"], ["5001", "TripAdvisor"], ["280", "travco"],
  ["226", "Booknpayxml"], ["208", "BookingEye"], ["203", "Grabrooms"], ["148", "Hoterip"],
  ["259", "middleeasthotel"], ["130", "Keytel (formerly Hotusa)"], ["1", "Booking Engine"],
  ["140", "viaxml"], ["186", "Emerging Travel Group (Formerly Ostrovok)"],
  ["116", "webhotelier"], ["266", "onefinerate"], ["133", "hotelnetwork"],
  ["90", "Dnata (Formerly Travel Republic)"], ["290", "apartmentsonline"],
  ["110", "pitchup.com"], ["217", "easemytrip"], ["284", "happyeasygo"],
  ["291", "hyperguest (OLD)"], ["293", "bakuun"], ["5002", "Google"], ["225", "ichronoz"],
  ["269", "Shiji"], ["294", "pelican"], ["292", "tripjack"], ["255", "tbo"],
  ["127", "Prestigia"], ["295", "omnihotelier"], ["296", "tripfactory"], ["278", "roiback"],
  ["270", "saffronstays"], ["5004", "mybookingsite.io"], ["5000", "Max"], ["103", "Webrooms"],
  ["281", "simplotel"], ["242", "iescape"], ["297", "Hobse (OLD)"], ["301", "campingvision"],
  ["69", "Reconline(GDS)"], ["5005", "Instant"], ["282", "irctc"], ["300", "findbulous"],
  ["302", "Belhotel"], ["305", "halalbooking"], ["312", "Travepic"],
  ["310", "OffPeakLuxury"], ["317", "TXGB"], ["176", "Rakuten"], ["319", "AltoVita"],
  ["267", "MG Jarvis"], ["265", "Mikitravel"], ["2", "STAAH Max"], ["320", "didatravel"],
  ["328", "airasia"], ["2001", "InstantMigration"], ["329", "bag2bag"], ["339", "Trip.com"],
  ["325", "brevistay"], ["318", "D-EDGE"], ["330", "aubergenie"], ["165", "HPro Travel"],
  ["274", "rezlive"], ["346", "roibos"], ["358", "Almosafer"], ["347", "trustedstays"],
  ["352", "travelplus"], ["351", "cleartrip"], ["355", "hotelsinone"], ["353", "klook"],
  ["5006", "Trivago"], ["361", "bookmybooking"], ["313", "kliknbook"], ["356", "feratel"],
  ["362", "spabreaks"], ["336", "Villa Finder"], ["370", "nuitee"], ["350", "busyrooms"],
  ["378", "elong"], ["371", "opengds"], ["364", "convergent"], ["158", "Bedandbreakfast.eu"],
  ["354", "thepercentage"], ["374", "moteelz"], ["381", "darent"], ["369", "hotelinx"],
  ["372", "illusionsonline"], ["377", "wowcher"], ["344", "columbus"],
  ["363", "mytravelbazaar"], ["365", "pinkelephantinternational"], ["373", "codegen"],
  ["375", "TA Network"], ["376", "heyTrip"], ["383", "hobse"], ["384", "anzcro"],
  ["386", "Traveloka"], ["380", "shiji"], ["382", "tourmind"], ["348", "rehlat"],
  ["385", "withinearthv2"], ["368", "Ottila International"], ["331", "ibook"],
  ["389", "IndigoAirlines"], ["387", "g2travel"], ["391", "travcal"], ["390", "LetsGoa"],
  ["399", "Hibeds"], ["395", "TravelEssence / Little Travel Group"], ["400", "TravelBullz"],
  ["396", "Travex Connect"], ["379", "booknfly"], ["393", "meituan"], ["357", "gotifi"],
  ["345", "secretretreats"], ["410", "Avvio Access Booking Engine (SHR BE)"],
  ["403", "Odeon Tours"], ["414", "Check 24"], ["416", "HotelDirect.co.uk"],
  ["145", "Cendyn RVNG"], ["401", "Riya Travels"], ["419", "VHSHUB / Harvest"],
  ["412", "QIYOUJI"], ["434", "Flow The Room"], ["237", "HotelSpecials.com"],
  ["367", "Plusgrade"], ["388", "Rezolv Hospitality"], ["404", "Cendyn CRS"],
  ["406", "Hotelzify"], ["402", "Zuba"], ["398", "Bookingsmaker.com"],
  ["5007", "Rainmaker.travel"], ["418", "Attic Inn"], ["430", "OnlineVacations.in"],
  ["334", "Xcaliber"], ["425", "hyperguest"], ["447", "HummingBird India"],
  ["444", "XML World"], ["445", "ixigo / Bookcabin"], ["417", "Hopper Hotels"],
  ["443", "Tripmartz"], ["442", "ROVI TRAVEL"], ["437", "CNBOOKING"], ["441", "Tytlees"],
  ["421", "Myhotelbreak"], ["229", "EET Global"], ["448", "Karpaten"],
  ["446", "SriLankan Holidays"], ["439", "TWS4Hotels.com"], ["435", "Bookingina"],
  ["458", "Mirai"], ["440", "KliqLivio"], ["453", "JL Tour"], ["463", "Jomhotel"],
  ["469", "Culturetravel"], ["438", "Stayksa"], ["460", "Readyplanet TravelTech"],
  ["465", "Scapia"], ["407", "KOOB"], ["456", "Travclan"], ["470", "Flycreative"],
  ["462", "Myholidaytrip"], ["471", "Tripmax"],
];

/** SU's name for a code, or null for a code SU does not list. */
export const suChannelName = (code: string | null | undefined): string | null =>
  SU_CHANNELS.find(([c]) => c === code?.trim())?.[1] ?? null;
