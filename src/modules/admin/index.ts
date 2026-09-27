/* The front door of the Administration service — the only file another service
   may import (src/test/boundaries.test.ts). It grows as the service's files
   move in; see MODULE.md. */
export { CommissioningCard } from "./flows/CommissioningCard";
/* The group's logo for every document (D27-53): an <img src>, or null -
   print the hotel's name then. Never inline it as markup. */
export { useGroupLogo } from "./data/groupLogo";
