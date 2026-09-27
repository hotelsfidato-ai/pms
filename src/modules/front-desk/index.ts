/* The front door of the Front desk service — the only file another service
   may import (src/test/boundaries.test.ts). It grows as the service's files
   move in; see MODULE.md. */
export { StayTable } from "./components/StayTable";
export type { StayColumn, StayRow } from "./components/StayTable";
export { assignRoom, checkOut, checkOutAllowed, earlyArrival } from "./data/operations";
export type { Posting } from "./data/operations";
export { fetchStays, getHouseNow, getStay, listArrivals, listArrivalsOutstanding, listDepartures, listInHouse, listStays } from "./data/stays";
export type { HouseNow, HouseNowRoom } from "./data/stays";
export { getStayViewCounts } from "./data/stayview";
export { LateCheckOutFlow } from "./flows/LateCheckOutFlow";
