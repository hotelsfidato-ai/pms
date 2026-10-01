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

/* The desk adds a guest's ID photo at check-in (D27-210), for a guest who
   sent none online: front desk's check-in and the stay panel draw this.
   `<AddIdPhotoAtDesk stayId={reservationId} />`, inside a `/h/:code/...`
   screen. It shows itself only to the desk's roles. */
export { default as AddIdPhotoAtDesk } from "./AddIdPhotoAtDesk";
