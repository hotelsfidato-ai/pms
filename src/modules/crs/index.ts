/* The front door of the CRS bridge on the website - the only file another
   service may import from here (src/test/boundaries.test.ts).

   `CrsFacts`: a booking's CRS number, salesperson and company, and any
   change made in the CRS since, for the booking's own panel (D27-168). */
export { CrsFacts } from "./components/CrsFacts";
