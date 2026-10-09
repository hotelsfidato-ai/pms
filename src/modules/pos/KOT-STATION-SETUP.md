# The KOT and bill printers - one-time setup

Each place that prints - the kitchen, the bar, the cashier - has a computer
next to its printer, and that computer prints its own slips by itself, with no
print window (the owner's D27-159, 29 September; several by place, D27-292,
9 October). One computer may print several kinds, or everything.

What prints where is chosen in **Restaurant setup → KOT section**:

- **KOT kinds** - Kitchen and Bar to start (rename them at will), and any you
  add (Tandoor, Desserts). Each slip says what it is, in big letters at the
  top: **KITCHEN KOT 14**, **BAR KOT 14**. One Send keeps one number.
- **Which section prints where** - each menu section, filled in from its tax
  heading: Bar and Alcohol to the Bar, the rest to the Kitchen. Change the odd
  one (Mocktails to the Bar). Add-ons go with their dish.
- **This computer** - on each computer with a printer: its name, and what it
  prints. **One computer per kind**: ticking a kind on another computer moves
  it there.
- **The bills** - one computer may print them too, silently: **INTERIM BILL**
  before payment, **BILL** after, **BILL · DUPLICATE** when printed again.
  With none chosen, Print bill opens the bill on the device that pressed it,
  as before.

The website cannot reach a printer by its address on your network, so a
printer is always reached through the computer it is connected to.

You need, for each printing computer: the computer (Windows), Google Chrome
on it, its printer connected and installed, and a sign-in that can open
Restaurant setup's KOT section (the owner, an administrator, the GM or the
kitchen manager).

---

## 1 · Make its printer the computer's default printer

**Where: that computer (the kitchen PC, the bar PC), Windows Settings.**

1. Start → Settings → Bluetooth & devices → Printers & scanners.
2. Turn **off** "Let Windows manage my default printer".
3. Click the printer → **Set as default**.
4. Still there: **Printing preferences** → choose the **80 mm** roll as the
   paper size (the name depends on the printer, e.g. "80mm x 297mm" or
   "Roll paper 80 x 297 mm").

The KOT and the bill are laid out for an 80 mm roll (D27-161).

## 2 · Make a Chrome shortcut that prints without asking

**Where: that computer, the desktop.**

1. Right-click the desktop → New → Shortcut.
2. In "Type the location of the item", paste this, all on one line:

   ```text
   "C:\Program Files\Google\Chrome\Application\chrome.exe" --kiosk-printing --user-data-dir="C:\KOT-Chrome" --app=https://pms.fidatohotels.com/pos/5EL/kitchen
   ```

3. Next → name it **KOT station** → Finish.

If Chrome is somewhere else on this computer (some have
`C:\Program Files (x86)\Google\Chrome\Application\chrome.exe`), use that
path instead: right-click your usual Chrome icon → Properties shows it.

What the three parts do:

- `--kiosk-printing` - Chrome prints straight to the default printer, with
  no print window.
- `--user-data-dir="C:\KOT-Chrome"` - a Chrome of its own, used only for
  printing. Chrome reads `--kiosk-printing` only when it starts, so a Chrome
  that is already open (your everyday one) would ignore it; a separate one
  always starts fresh with it. And Chrome prints to the printer used **last**
  unless told otherwise, so a Chrome that has only ever printed slips always
  picks this printer.
- `--app=…/pos/5EL/kitchen` - opens the Kitchen screen in its own window,
  without tabs. At the bar, the Kitchen screen's **Bar** button shows only the
  bar's orders, and this computer remembers it.

## 3 · Sign in and tick what it prints

**Where: that computer, the KOT station window.**

1. Double-click **KOT station** and sign in.
2. Open **Restaurant setup → KOT section** (the menu, or the **Set up** link
   on the red line).
3. Under **This computer**: type its name, e.g. **Bar PC**, tick **Prints Bar
   KOTs** (and **Prints the bills** if this one prints them) → **Save**.
4. Go back to the Kitchen screen and leave it open.

Tables, the Till, the Terminal and the Kitchen now read
**"Bar KOTs: Bar PC - online"**.

## 4 · Test it once

**Where: any other device - a phone, the POS, reception.**

Send a dish and a drink to the kitchen from Tables (or the Till, or the
Terminal). Within a few seconds **KITCHEN KOT n** prints at the kitchen and
**BAR KOT n** at the bar, with no window. Print a table's bill from Tables:
**INTERIM BILL** prints at the bill printer.

- **A print window appears instead:** that Chrome was started without the
  setting. Close every KOT station window, then start it again from the
  **KOT station** shortcut only.
- **It prints on the wrong paper or printer:** step 1, then close and reopen
  the KOT station window.
- **Nothing prints, and the POS says "… not seen since …":** the KOT station
  window is closed, or the computer is asleep or off the network.

## 5 · Every day

- **Leave the KOT station window open**, on the Kitchen screen (any
  restaurant screen prints; other screens do not). Do not minimise it.
- The computer should not go to sleep during service: Settings → System →
  Power → Screen and sleep → "When plugged in, put my device to sleep after":
  **Never**.
- To start it with Windows: press Windows + R, type `shell:startup`, Enter,
  and copy the **KOT station** shortcut into the folder that opens.

## What happens when…

- **A computer was off or asleep for a while:** its KOTs wait for it, with a
  red line naming it on every till screen. When it is back, it prints every
  KOT it missed, oldest first - only today's (the business date's, D27-167).
- **The bill printer is offline:** Print bill says so and offers **Print
  here**, which opens the bill on that device. A bill printed here does not
  print again at the bill printer.
- **A KOT is lost, torn or unreadable:** on that computer, Restaurant setup →
  KOT section → **This computer's last 20 KOTs** → **Reprint**. The slip says
  REPRINT.
- **A printer moves to another computer:** do steps 1-3 on the new one.
  Ticking its kinds there moves them; the old computer stops printing them by
  itself. A computer that prints nothing any more can be **Removed** from the
  list.
- **No computer prints a kind something is sent to:** Tables, the Till, the
  Terminal and the Kitchen say in red **"No computer prints Bar KOTs - they
  are not printing"**. The Kitchen screen still shows every dish.

---

Sources, read 29 September 2026:

- Chrome prints to the most recently used printer unless the
  PrintPreviewUseSystemDefaultPrinter policy is on - Chrome Enterprise,
  <https://chromeenterprise.google/policies/print-preview-use-system-default-printer/>.
- `--kiosk-printing` sends a print straight to the printer; on some Chrome
  versions the print window flashes for a moment first - Chromium issue
  40959316, <https://issues.chromium.org/issues/40959316>. Chromium's own
  list of switches (chrome_switches.cc) could not be reached that day; the
  test in step 4 is the proof on this computer.
