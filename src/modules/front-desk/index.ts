/* The front door of the Front desk service — the only file another service
   may import (src/test/boundaries.test.ts). It grows as the service's files
   move in; see MODULE.md. */
export { StayTable, STAY_LABEL } from "./components/StayTable";
/* Settings › Operations (the owner's D27-243). */
export { FrontDeskRulesCard } from "./components/FrontDeskRules";
/* Phase 5 (D27-260): the hotel's lists, read by other services' screens. */
export { ReadyReasons } from "./components/ReadyReasons";
export { listOf, holidaysOf, vipLevels, type ListItem, type Holiday } from "./data/lists";
export type { StayColumn, StayRow } from "./components/StayTable";
export { assignRoom, checkOut, earlyArrival, leavingEarly, type LeavingEarly } from "./data/operations";
/* D27-328 (3): the advance owed before check-in, for the Bill tab's Settle. */
export { expressCheckIn } from "./data/operations";
export type { Posting } from "./data/operations";
export { fetchStays, fetchStaysWhere, getHouseNow, getStay, isCancelledOrVoid, listArrivals, listDepartures, listInHouse, listStays } from "./data/stays";
export type { HouseNow, HouseNowRoom } from "./data/stays";
/* D27-348: Settings › Documents draws a sample registration card. */
export { RegistrationCardSheet } from "./pages/RegistrationCard";
export type { RegistrationCard } from "./data/stays";
export { getStayView } from "./data/stayview";
export type { ChartRoom } from "./data/stayview";
export { LateCheckOutFlow } from "./flows/LateCheckOutFlow";
export { LeavingEarlyStep } from "./flows/LeavingEarlyStep";
/* D27-163: the one page (reservations' New booking) checks a guest in and
   adds the stay's extras through front desk's own doors, not copies. */
export { checkIn, assignableRooms } from "./data/operations";
export { listInclusions, addStayInclusion } from "./data/stayExtras";
