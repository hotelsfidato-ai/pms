# Amrapali's BAR PC, and the settings left to fill on live — plan (20 October)

Neither needs code or a release. Part 1 happens at Amrapali, on the BAR PC. Part 2 is typed into
the PMS screens on live by the owner or a GM. Nothing here is done for them: I cannot sign in, and
these are writes on live. Afterwards I check each one, read-only.

## What live shows now (read-only, 20 Oct, 16:40)

| | Now | Needed |
|---|---|---|
| BAR PC | Prints the Kitchen and Bar KOTs and the bills by itself (36 of 36 KOTs on 18 Oct printed), but each slip opens Chrome's print window | Kiosk printing: no window |
| BAR PC records | **Three** named "BAR PC": one prints everything (made 16 Oct), one active and printing nothing (17 Oct), one switched off (11 Oct). Last seen 19 Oct 18:46 | One |
| Group name | "Fidato Hotels" | ✓ |
| Group logo | An **SVG**. The bills show it, but the booking voucher's PDF prints a PNG only | A PNG |
| Group office | Address, phone, GSTIN, website filled; **email empty** | The email |
| Hotel logos | Amrapali has its own; Majestic Grand and Grand Lucent print the group's | ✓ (or upload theirs) |
| HSN/SAC codes | **None at any hotel**, so no bill prints one | Amrapali: Rooms, Restaurant, Bar, Alcohol. Majestic Grand: Rooms, Restaurant |
| House policies | All three hotels have **the same 4 starting lines** (photo ID; a credit card for incidentals; special requests subject to availability; company GST number) | Each hotel's own, read and agreed |

## Part 1 · The BAR PC: slips print with no window (~15 min, at Amrapali)

**Who:** someone at the BAR PC with a sign-in that opens Restaurant setup's KOT section (the owner,
an administrator, the GM or the kitchen manager). **When:** outside service. A KOT sent while the
window is closed is not lost: it waits, and prints when the window is back.

**Where: the BAR PC.**

1. Close **every** Chrome window on the BAR PC. Chrome only takes the no-window setting when it starts.
2. Open Chrome, sign in at pms.fidatohotels.com, and open **Restaurant setup → KOT section**. Under
   **Set up this computer for printing**, press **Download the setup file**; if Chrome asks, press **Keep**.
3. Open `KOT-station-setup-AMR.cmd`. If Windows says "Windows protected your PC", press **More info**,
   then **Run anyway**. It lists the printers: type the number of the receipt printer.
4. The file sets that printer as the default (and stops Windows changing it), puts a **KOT station**
   shortcut on the desktop and in Startup, keeps the PC from sleeping while plugged in, and opens the
   KOT station window. **Sign in** there.
5. In the KOT section, under **This computer**: name it **BAR PC**, tick **Prints Kitchen KOTs**,
   **Prints Bar KOTs** and **Prints the bills**, then **Save**. That moves all three from the old record to this window.
6. In the list of computers, press **Remove** on the two old "BAR PC" lines (the ones that are not
   "This computer").
7. Go back to the **Kitchen** screen and leave the window open, not minimised.
8. **Test without making a new order:** in the KOT section, under **This computer's last 20 KOTs**,
   press **Reprint** on one. It should print straight away, marked REPRINT, with no window. Then, on the Till,
   under **An earlier day's bill**, print one of 18 October's; it should print the same way.
9. If the slip comes out too wide: Windows Settings → Printers → the printer → Printing preferences →
   the 80 mm roll. Then close the KOT station window and open it again from its shortcut.

**From then on:** at the BAR PC, the PMS is opened **only from the KOT station shortcut**. An ordinary
Chrome window shows the print window again.

**One printer only:** kiosk printing sends every slip to the PC's default printer. If the kitchen has
a printer of its own, it needs its own computer, set up with these same steps (question 1).

The full guide: `src/modules/pos/KOT-STATION-SETUP.md`; the manual, A8.

## Part 2 · The settings on live (~20 min once the codes and the logo are in hand)

**Who:** the owner or a GM, on any computer, signed in at pms.fidatohotels.com, with each hotel chosen in turn.

**2a · The group** (Settings → Property → **Group**; any hotel, it is one for all)
- **Logo → Upload** a **PNG** of the Fidato Hotels logo: at most 200 KB. It replaces the SVG, and the voucher's PDF then prints it.
- **Change office details → Email**: the address printed in every voucher's and every tax invoice's footer.

**2b · HSN/SAC codes** (Settings → Rates and tax → **Taxes**; per hotel)
- On each heading: **Edit** → **HSN/SAC code** → Save. A SAC for a service is 6 digits; an HSN for
  goods is 4, 6 or 8 digits.
- **Amrapali:** Rooms, Restaurant, Bar, Alcohol. **Majestic Grand:** Rooms, Restaurant.
- **The codes come from your CA.** The usual ones are 996311 for hotel rooms and 996331 for a
  restaurant, but the CA confirms these and gives the Bar's and the Alcohol's.

**2c · House policies** (Settings → Property → **Policies** → House policies → **Edit**; per hotel)
- One policy per line, in the order they print. At most 8 lines, 200 characters each.
- They print on that hotel's booking voucher and above the guest's signature on the registration card.
- All three hotels have the same 4 starting lines today: read them, then change or add per hotel.

**2d · Look at the result** (Settings → Property → **Documents** → **Print a sample**)
- Save as PDF the proforma bill, the registration card and the restaurant bill of each hotel, and
  check the logo, the codes and the policies.

## Afterwards — me, read-only

Each setting on live, the BAR PC as one active record printing all three, and a reprinted KOT with no
new order. Then this plan's status, and HANDOVER § 3.

## Questions for the owner

1. **How many printers are on the BAR PC?** Recommended: one receipt printer, so the Kitchen KOTs,
   the Bar KOTs and the bills all print there. If the kitchen has its own printer, it needs its own
   computer, set up the same way.
2. **Who does the BAR PC, and when?** Someone at Amrapali with a GM or kitchen manager sign-in, outside service.
3. **Do you have a PNG of the Fidato Hotels logo?** If you only have the SVG, I can turn it into a PNG
   here and give you the file to upload.
4. **The HSN/SAC codes from your CA:** Rooms, Restaurant, Bar, Alcohol.
5. **House policies:** the same at all three hotels, or each hotel's own?

## Noticed on the way (not part of this plan)

- **Amrapali's hotel business date on live is still 17 October**, and its restaurant orders are on
  18 October's day. As far as live shows, neither day has been closed since.
- **Grand Lucent (HGLM) has no tax headings at all**, so it cannot sell anything yet. Is it trading on the PMS?
