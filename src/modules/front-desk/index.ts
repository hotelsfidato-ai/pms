/* The front door of the Front desk service — the only file another service
   may import (src/test/boundaries.test.ts). It grows as the service's files
   move in; see MODULE.md. */
export { StayTable, STAY_LABEL } from "./components/StayTable";
export type { StayColumn, StayRow } from "./components/StayTable";
export { assignRoom, checkOut, checkOutAllowed, earlyArrival } from "./data/operations";
export type { Posting } from "./data/operations";
export { fetchStays, getHouseNow, getStay, listArrivals, listArrivalsOutstanding, listDepartures, listInHouse, listStays } from "./data/stays";
export type { HouseNow, HouseNowRoom } from "./data/stays";
export { getStayView, getStayViewCounts } from "./data/stayview";
export type { ChartRoom } from "./data/stayview";
export { LateCheckOutFlow } from "./flows/LateCheckOutFlow";
/* D27-163: the one page (reservations' New booking) checks a guest in and
   adds the stay's extras through front desk's own doors, not copies. */
export { checkIn, assignableRooms } from "./data/operations";
export { listInclusions, addStayInclusion } from "./data/stayExtras";
