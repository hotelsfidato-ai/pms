/* Online check-in — BUILT 21 September: the guest's page (`/g/:token`,
   mounted outside the sign-in gate) and the desk's screen under Front desk.
   What it does, and what it still waits on, is in MODULE.md beside this file.

   Guest messages draws the guest's messages to the front desk (D23-14) with
   this, inside its own screen. */
export { default as MessagesToTheDesk } from "./MessagesToTheDesk";

/* The check-in's ID step draws this: a line to the desk's screen when the
   booking has details waiting from the guest's own page (the owner, 25
   September). */
export { default as WaitingDetailsLink } from "./WaitingDetailsLink";
