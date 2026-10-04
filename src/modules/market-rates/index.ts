/* The front door of Market rates - the only file another service may import
   (src/test/boundaries.test.ts).

   Rivals' prices (D27-270): each nearby hotel's lowest public price per
   night, checked twice a week. Revenue management reads them beside its
   suggestions through `getNearby` - a GET, and the only thing it uses.
   The switch's page registers itself (rivals.settings.ts), not through here. */
export { getNearby, nearbySummary } from "./data";
export type { CheckedNight, Rival } from "./data";
