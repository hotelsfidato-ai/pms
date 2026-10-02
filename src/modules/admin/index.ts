/* The front door of the Administration service — the only file another service
   may import (src/test/boundaries.test.ts). It grows as the service's files
   move in; see MODULE.md. */
export { CommissioningCard } from "./flows/CommissioningCard";
/* The group's name and logo for every document (D27-53, D27-65): the name
   for "by <group name>" and the logo as an <img src>, each null when not set -
   print the hotel's name alone then. Never inline the logo as markup. */
export { useGroupSettings, type GroupSettings } from "./data/groupSettings";
/* D27-245: the signed-in person's "set a longer password" prompt, mounted
   once by the app shell. */
export { PasswordDue } from "./components/PasswordDue";
