import { useUi } from "@/lib/ui";
import { useSession } from "@/lib/session";

/* ══════════════════════════════════════════════════════════════════
   WHERE EVERY SCREEN TEST STARTS

   These lived at the top of `src/App.test.tsx` until its tests were
   split by service (docs/SERVICE-FOLDERS-PLAN.md, step 7): the shell's
   stayed there, and each service's moved beside the service, into
   `src/modules/<service>/<service>.test.tsx`. Every one of those files
   imports what is here, so each test starts exactly where it did when
   they were one file. The code is unchanged; only its address is new.
   ══════════════════════════════════════════════════════════════════ */

/* ══════════════════════════════════════════════════════════════════
   Routing per PHASE-1-FRONTEND §1.2:
     /                group dashboard
     /h/:code/stay    the tape chart
   The property is in the URL, not only in a store.
   ══════════════════════════════════════════════════════════════════ */

/* CP9: the id a screen puts in a URL is the hotel CODE, because that is
   what Postgres calls it — `hotels.code`, commented "appears in URLs" in
   migration 002. It used to be the fixture's slug. Screens did not change;
   they take whatever the repository hands them. */
export const HOTEL = "5EL";
export const go = (path: string) => window.history.pushState({}, "", path);

/* CP8 put a session in front of the shell. These tests are about
   routing, not sign-in, so they seed a signed-in clerk directly. The
   guard itself is asserted in its own block, in `src/App.test.tsx`. */
export const AGRA_HOTEL = "11111111-1111-1111-1111-111111111111";

export const signedIn = (overrides: Partial<ReturnType<typeof useSession.getState>> = {}) =>
  useSession.setState({
    status: "signed-in",
    scope: {
      staffId: "22222222-2222-2222-2222-222222222222",
      email: "agra@fidato.in",
      fullName: "Agra Clerk",
      isGroupAdmin: false,
      hotels: [{ hotelId: AGRA_HOTEL, role: "front_desk" }],
    },
    hotels: [
      {
        id: AGRA_HOTEL, code: "AGR", name: "Fidato Agra", city: "Agra",
        state: "UP", gstin: null, timezone: "Asia/Kolkata", currency: "INR",
        checkInTime: "14:00", checkOutTime: "11:00",
        /* A DIFFERENT date from the demo property's 25 August, on
           purpose: this is Agra, and two properties do not share an
           operating day. */
        businessDate: "2026-08-24",
      },
    ],
    hotelId: AGRA_HOTEL,
    ...overrides,
  });

/* The hook every test in App.test.tsx ran first, before the split: the
   address at /, the demo property chosen, a signed-in clerk. Each test
   file registers it with `beforeEach(startSignedIn)` at the top, so a
   describe block's own beforeEach still runs after it, as it did. */
/* The demo property as one of the person's own hotels. The app keeps the
   remembered hotel among the person's (AppShell, 4 October), so a screen
   opened on 5 Elements needs the person to hold it, as staff there do. */
export const DEMO_HOTEL_ID = "33333333-3333-3333-3333-333333333333";
const idOf = (code: string) => (code === HOTEL ? DEMO_HOTEL_ID : `demo-${code}`);
export const withDemoHotel = (code: string = HOTEL) => useSession.setState((s) => ({
  /* The same role there as at their first hotel. */
  ...(s.scope ? { scope: { ...s.scope, hotels: [
    ...s.scope.hotels.filter((h) => h.hotelId !== idOf(code)),
    { hotelId: idOf(code), role: s.scope.hotels[0]?.role ?? "front_desk" },
  ] } } : {}),
  hotels: [...s.hotels.filter((h) => h.code !== code), {
    id: idOf(code), code, name: code === HOTEL ? "5 Elements Akkalkot" : code,
    city: "Akkalkot", state: "MH", gstin: null, timezone: "Asia/Kolkata", currency: "INR",
    checkInTime: "14:00", checkOutTime: "11:00", businessDate: "2026-08-25",
  }],
}));

/* A TEST HOTEL (the owner's D27-296): the practice copy of a real hotel,
   among the person's hotels. `testOf` names the real hotel's CODE - the
   one thing GET /api/hotels says about it. `inView` puts it in the
   address's place, as a screen opened at /h/<code>/... would. */
export const TEST_HOTEL = "5ELT";
export const TEST_HOTEL_ID = "44444444-4444-4444-4444-444444444444";
export const withTestHotel = ({ code = TEST_HOTEL, of = HOTEL, inView = true }:
  { code?: string; of?: string; inView?: boolean } = {}) => {
  useSession.setState((s) => ({
    ...(s.scope ? { scope: { ...s.scope, hotels: [
      ...s.scope.hotels.filter((h) => h.hotelId !== TEST_HOTEL_ID),
      { hotelId: TEST_HOTEL_ID, role: s.scope.hotels[0]?.role ?? "front_desk" },
    ] } } : {}),
    hotels: [...s.hotels.filter((h) => h.code !== code), {
      id: TEST_HOTEL_ID, code, name: "5 Elements Akkalkot · TEST",
      city: "Akkalkot", state: "MH", gstin: null, timezone: "Asia/Kolkata", currency: "INR",
      checkInTime: "14:00", checkOutTime: "11:00", businessDate: "2026-08-25", testOf: of,
    }],
  }));
  if (inView) useUi.setState({ hotelId: code });
};

export const startSignedIn = () => {
  go("/");
  useUi.setState({ hotelId: HOTEL, sidebarCollapsed: false });
  signedIn();
};
