# Market rates

Rivals' prices: each nearby hotel's lowest public price per night, as Google
Hotels shows it, for revenue management to read beside its suggestions.

**BUILT 4 October 2026** from the owner's D27-269 and D27-270
(`docs/briefs/decisions-2026-09-27.md`). Not deployed; nothing leaves this
machine.

```
src/modules/market-rates/            the switch's settings page, and the web door
api/src/modules/market-rates/        the check (sweep.ts), the routes, the door
db/migrations/196_market_rates.sql   its two tables and two definer functions
api/test/modules/market-rates/       its tests (the only folder api/vitest collects)
```

**Nothing here is a price this system sells at, and nothing here changes
one.** Revenue management still never moves a price (D18-15); it reads this
service through one GET and shows what it finds.

---

## What it does

1. **The check** (`api/src/modules/market-rates/sweep.ts`). For each hotel
   that is due, one SerpApi search per night for the next **30 nights** from
   the property's own today: `engine=google_hotels`, `q=hotels in <city>`,
   `check_in_date`, `check_out_date` (the next day), `gl=in`, `hl=en`,
   `currency=INR`. One page per night, about **260 searches a month per
   hotel** (the owner's figure: the free plan or $25).
2. **When.** **Mondays and Thursdays, from 06:00 on the property's clock**
   (`CHECK_DAYS`, `CHECK_FROM`). The timer looks every 15 minutes; a look is
   one query. A hotel is checked at most once a day: `app.market_rates_begin`
   marks it before it is searched, so two servers cannot both take it.
3. **Who is checked.** Only a hotel whose **Rivals' prices** switch is on
   (off by default, no row = off) **and** only while the server has
   **`SERPAPI_KEY`**. Without the key the sweep asks nothing, not even the
   database. Without a switched-on hotel it searches nothing.
4. **What is kept** (`market_rates`): hotel, night, when checked, the rival's
   name, its lowest price in rupees (`rate_per_night.extracted_lowest`), and
   the site behind that price when Google names one. **Hotels only** (Google's
   `type` "hotel"; holiday flats are left out), each with a price above
   nought, **never the hotel itself**: its own words, less the city's and a
   few every hotel shares ("hotel", "resort", "inn"...), must not all be in the
   rival's name (`isOwnHotel`). Every check is kept; the screen reads the
   latest per night.
5. **A failed search** is logged (never with the key) and waits for the next
   check day. Never retried sooner: every try is a paid search.

## Screens and routes

| What | Where | Who |
|---|---|---|
| Rivals' prices, the switch | `/settings/connections/rivals-prices` (`rivals.settings.ts`, `pages/RivalsPrices.tsx`) | the console's `setting`: owner, Admin, GM |
| `GET /api/hotels/:code/market-rates?from&to` | each night's latest check, cheapest first | `rate` view, the same as revenue management's pickup |
| `GET /api/hotels/:code/market-rates/switch` | on or off, whether the key is set (never the key), last check day | `room_config` view, and `app.manages_hotel` |
| `PUT /api/hotels/:code/market-rates/switch` | switch it | `room_config` edit (owner, Admin, GM), and `app.manages_hotel` |

**Why "Modules and connections" and not "Rates and tax":** the switch turns on
an outside connection that spends paid searches, like the channel manager and
the CRS beside it; it sets no rate.

The beside-each-suggestion line is revenue management's
(`src/modules/revenue-management/pages/Outlook.tsx`): "Nearby: lowest ₹x,
middle ₹y (n hotels, checked <date>)", opening to the list. A night nobody
checked is "Nearby: -". The middle is the median, to the rupee.

## Tables

- **`market_rate_settings`** (hotel, is_on, last_run_on, changed_by,
  changed_at). FORCE row-secured: read `app.auth_hotel_ids()`, write
  `app.manages_hotel()`. Audited when a person switches it (`update of
  is_on`), not when the sweep marks its day.
- **`market_rates`** (hotel, stay_date, fetched_at, competitor, lowest_price,
  source). FORCE row-secured on `app.auth_hotel_ids()`; select only. Nobody
  signed in writes it: only `app.market_rates_record` (a definer, and only
  while the hotel's switch is on).

## The server setting

`SERPAPI_KEY`, the owner's SerpApi key, read when asked (`serpApiKey()`), in
`api/.env.example` with an empty value. The owner types it on the server.
Never in the repository, a screen, a test or a chat.

## Rules that bind it

- **No default prices.** A night with nothing found is not stored; the screen
  shows a dash.
- **Nothing reaches SerpApi from a test.** The tests hand the sweep a stand-in
  search and stub `fetch` for the whole file.
- **Revenue management only reads it**, through `getNearby` on the web door.
  `neverWritesARate.test.ts` still reads every revenue-management file.

## Gates

```
npx vitest run src/modules/revenue-management src/test
cd api; bash "/d/fidato pms/.local/dbq.sh" bash scripts/with-test-db.sh test/modules/market-rates
```

## Questions for the owner

- **MR-Q1 · holiday flats.** Google lists "vacation rentals" beside hotels.
  Built: hotels only. Recommendation: as built; one line to include them.
- **MR-Q2 · when the switch is turned off**, the prices already checked stay
  on Revenue outlook with their "checked" date. Recommendation: as built.
