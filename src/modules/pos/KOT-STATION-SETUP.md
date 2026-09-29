# The KOT station - one-time setup

One PC per restaurant prints every KOT, by itself, with no print window
(the owner's D27-159, 29 September). No other device prints a KOT. This is
done once, on the PC next to the KOT printer - the kitchen PC or the POS PC.

You need: that PC (Windows), Google Chrome on it, the KOT printer connected
and installed, and a sign-in that can open the Kitchen screen and switch the
KOT printer (the owner, an administrator, the GM or the kitchen manager).

---

## 1 · Make the KOT printer the PC's default printer

**Where: the kitchen PC, Windows Settings.**

1. Start → Settings → Bluetooth & devices → Printers & scanners.
2. Turn **off** "Let Windows manage my default printer".
3. Click the KOT printer → **Set as default**.
4. Still there: **Printing preferences** → choose the **80 mm** roll as the
   paper size (the name depends on the printer, e.g. "80mm x 297mm" or
   "Roll paper 80 x 297 mm").

The KOT is laid out for an 80 mm roll (D27-161).

## 2 · Make a Chrome shortcut that prints without asking

**Where: the kitchen PC, the desktop.**

1. Right-click the desktop → New → Shortcut.
2. In "Type the location of the item", paste this, all on one line:

   ```text
   "C:\Program Files\Google\Chrome\Application\chrome.exe" --kiosk-printing --user-data-dir="C:\KOT-Chrome" --app=https://pms.fidatohotels.com/h/5EL/kitchen
   ```

3. Next → name it **KOT station** → Finish.

If Chrome is somewhere else on this PC (some have
`C:\Program Files (x86)\Google\Chrome\Application\chrome.exe`), use that
path instead: right-click your usual Chrome icon → Properties shows it.

What the three parts do:

- `--kiosk-printing` - Chrome prints straight to the default printer, with
  no print window.
- `--user-data-dir="C:\KOT-Chrome"` - a Chrome of its own, used only for
  KOTs. Chrome reads `--kiosk-printing` only when it starts, so a Chrome
  that is already open (your everyday one) would ignore it; a separate one
  always starts fresh with it. And Chrome prints to the printer used **last**
  unless told otherwise, so a Chrome that has only ever printed KOTs always
  picks the KOT printer.
- `--app=…/h/5EL/kitchen` - opens the Kitchen screen in its own window,
  without tabs.

## 3 · Sign in and switch it on

**Where: the kitchen PC, the KOT station window.**

1. Double-click **KOT station** and sign in. The Kitchen screen opens.
2. Top right: **KOT printer**.
3. Type this PC's name, e.g. **Kitchen PC**, and tick **This device prints
   KOTs**.

The line under the Kitchen screen's header now reads
**"KOT printer: Kitchen PC - online"**, and so does the top of Tables, the
Till and the Terminal on every other device.

## 4 · Test it once

**Where: any other device - a phone, the POS, reception.**

Send one dish to the kitchen from Tables (or the Till, or the Terminal).
Within a few seconds the KOT prints on the KOT printer, with no window.

- **A print window appears instead:** that Chrome was started without the
  setting. Close every KOT station window, then start it again from the
  **KOT station** shortcut only.
- **It prints on the wrong paper or printer:** step 1, then close and reopen
  the KOT station window.
- **Nothing prints, and the POS says "not seen since …":** the KOT station
  window is closed, or the PC is asleep or off the network.

## 5 · Every day

- **Leave the KOT station window open**, on the Kitchen screen (any
  restaurant screen prints; other screens do not). Do not minimise it.
- The PC should not go to sleep during service: Settings → System → Power →
  Screen and sleep → "When plugged in, put my device to sleep after":
  **Never**.
- To start it with Windows: press Windows + R, type `shell:startup`, Enter,
  and copy the **KOT station** shortcut into the folder that opens.

## What happens when…

- **The PC was off or asleep for a while:** when it is back, it prints every
  KOT it missed, oldest first - only today's (the business date's, D27-167).
- **A KOT is lost, torn or unreadable:** on the KOT station, Kitchen screen →
  **KOT printer** → the last 20 KOTs → **Reprint**.
- **The station moves to another PC:** do steps 1-3 on the new PC. Ticking
  "This device prints KOTs" there moves it; the old PC stops by itself.
- **Nobody set a station, or it is off:** Tables, the Till, the Terminal and
  the Kitchen say in red **"KOTs are not printing"**. The Kitchen screen
  still shows every dish.

---

Sources, read 29 September 2026:

- Chrome prints to the most recently used printer unless the
  PrintPreviewUseSystemDefaultPrinter policy is on - Chrome Enterprise,
  <https://chromeenterprise.google/policies/print-preview-use-system-default-printer/>.
- `--kiosk-printing` sends a print straight to the printer; on some Chrome
  versions the print window flashes for a moment first - Chromium issue
  40959316, <https://issues.chromium.org/issues/40959316>. Chromium's own
  list of switches (chrome_switches.cc) could not be reached that day; the
  test in step 4 is the proof on this PC.
