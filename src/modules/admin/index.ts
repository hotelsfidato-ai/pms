/* The front door of the Administration service — the only file another service
   may import (src/test/boundaries.test.ts). It grows as the service's files
   move in; see MODULE.md. */
export { CommissioningCard } from "./flows/CommissioningCard";
/* The hotel's profile and FSSAI, as Settings › Property showed them: the
   console's Property › Profile page draws it (D27-249, D27-254). */
export { PropertyProfileCard } from "./components/PropertyProfileCard";
/* The group's name and logo for every document (D27-53, D27-65): the name
   for "by <group name>" and the logo as an <img src>, each null when not set -
   print the hotel's name alone then. Never inline the logo as markup. */
export { useGroupSettings, type GroupSettings } from "./data/groupSettings";
/* D27-245: the signed-in person's "set a longer password" prompt, mounted
   once by the app shell. */
export { PasswordDue } from "./components/PasswordDue";
/* D27-396: two-step sign-in - the code screen after a right password (App.tsx)
   and the account menu's own dialog (AccountMenu.tsx). */
export { TwoStepGate, TwoStepDialog } from "./components/TwoStep";
/* D27-311, "Set up this hotel": the top bar's "Back to setup" bar (any
   screen opened with ?setup=<step>), the Dashboard's "Still to do" list, and
   the address of the setup (the bell's reminders link to it). */
export { SetupBar } from "./setup/SetupBar";
export { SetupStillToDo } from "./setup/StillToDo";
export { setupAddress } from "./setup/steps";
