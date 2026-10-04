# Changelog - Market rates

**This service's own log. One entry per working session, newest first.** The
entry shape is the root `CHANGELOG.md`'s: Asked for · Shipped · Found · Proved
· Left open · Commits.

---

## 2026-10-04 · rivals' prices, built (D27-269, D27-270)

**Asked for:** beside each night's suggestion on Revenue outlook, the nearby
hotels' lowest public prices for that night, from SerpApi's Google Hotels
API: 30 nights ahead, checked twice a week, for hotels whose new "Rivals'
prices" switch is on, and only with the server's SERPAPI_KEY.

**Shipped**
- A new service, `market-rates`, in its three places, and migration
  **196_market_rates.sql**: `market_rate_settings` (the switch, off by default,
  and the sweep's last check day) and `market_rates` (the observations), both
  FORCE row-secured on `app.auth_hotel_ids()`; `app.market_rates_begin` and
  `app.market_rates_record`, the only way the sweep (nobody signed in) reads
  and writes.
- The check (`api/src/modules/market-rates/sweep.ts`): Mondays and Thursdays
  from 06:00 on the property's clock, 30 nights, one SerpApi search each; the
  hotel itself, holiday flats and priceless hotels left out; a failed search
  logged and left for the next check day. Started by `server.ts`.
- Routes: `GET /:code/market-rates` (what revenue management reads),
  `GET`/`PUT /:code/market-rates/switch`.
- The switch's page, **Settings → Modules and connections → Rivals' prices**
  (`/settings/connections/rivals-prices`).
- Revenue outlook: "Nearby: lowest ₹x, middle ₹y (n hotels, checked <date>)"
  under each suggestion, opening to the list; a dash with no data (that
  service's own CHANGELOG).

**Outside this service (said here so the master sees it, not finds it):**
`api/src/server.ts` (import, SERVICES, jobs start and stop), `api/src/roleGate.ts`
(three rules), `api/.env.example` (SERPAPI_KEY, empty).

**Proved** (run in this session, judged by exit code)
- `api/test/modules/market-rates/marketRates.test.ts`: 13 of 13. Seen to
  fail first: with the key check, the switch check, the own-hotel filter, the
  30 and the two days each broken, 8 of 13 went red.
- With `test/roleGate.test.ts`, `test/apiGate.test.ts` and
  `test/modules/revenue-management`: 102 of 102.
- `db/tests/rerun.sh`: all 195 migrations re-runnable (migrated twice).
- Web and API typechecks clean; `npm run strip-check` 208 files.
- On the screen (own database `fidato_mr`, made-up rivals): the prices beside
  each suggestion, a dash on the night without data, the list opening; no
  sideways scroll at 375; the switch saved off by the owner, audited once.

**Left open**
- `src/test/migrationNumbers.test.ts` fails on this branch alone: 196 with no
  195. The rooms-and-rates lane holds 195; it passes once both are merged.
- MR-Q1 and MR-Q2 in `MODULE.md`, for the owner.
