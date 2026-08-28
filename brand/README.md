# Fidato brand assets

Everything the builder needs to render the Fidato identity correctly, copied
from the CRS and from the original brand package. **Nothing here is a
re-creation** — these are the same files the CRS ships in production.

---

## What is here

```
brand/
  tokens/
    theme.css              ← COPY THIS VERBATIM into src/styles/
    design-system.md          the written rules, and the two departures
  logo/
    logo-full.svg             the supplied lockup — wordmark + mark
    logo-mark.svg             the flame glyph alone
    logoMarkup.ts             inline React/TS form
    logoPng.ts                base64 PNG, for print and email
    public/fidato-hotels.png  raster fallback
  reference/
    Fidato Hotels Visual-Identity-Guidance.pdf   the authoritative brand book
    Fidato Hotels Profile.pdf                    company profile
  source/
    FH-original.svg           the original supplied artwork
    build-logo.mjs            the CRS script that derives the other forms
```

---

## The rules

### The mark is used verbatim

`logo-full.svg` and `logo-mark.svg` are the supplied artwork, **copied without
alteration**. Never recolour, redraw, stretch, add a border, or place on a busy
background. Keep **one "O" of clear space** on all sides, per the guidance
document (p.11).

> **A known discrepancy, deliberately left alone.** The supplied SVG draws the
> wordmark in `#142b3a`. The guidance specifies Fidato Black `#031728`. The rule
> *"do not alter the logo"* wins — the file is used untouched, and `#031728` is
> used for interface ink only. Worth confirming with the brand team which is
> authoritative, but **do not "fix" the file** in the meantime.

`logo-mark.svg` alone is the collapsed sidebar rail, the favicon and the
assistant avatar.

### Colour comes from `theme.css`, never from the PDF

The guidance document (p.13) is the origin of the palette, but `theme.css` is
what the code reads. Copy it verbatim into `src/styles/`. **Never type a hex
value into a component** — if a colour is needed that is not a token, that is a
conversation, not a commit.

### The logo gradient is not a UI colour

```
--color-accent-from  #fe611f
--color-accent-to    #f4bf54
```

Reserved for the mark itself, the collapsed rail, and **one** hero accent on the
dashboard. **Never on buttons** — it would compete with the primary action.

### Two departures from the guidance, both intentional

**1 · A success colour was added.** `--color-success: #1f6f5c`. The brand
palette is five warm colours plus greys, with nothing for *"this went well"*. An
operational system cannot function without it — *confirmed*, *paid*,
*reconciled* and *synced* are among the most frequent states in the product, and
rendering them in the same orange as *pending* would make the status vocabulary
meaningless. The green is deliberately muted and slightly teal so it sits beside
the warm palette rather than fighting it.

**2 · Typography is Inter, not Georgia + Arial.** The guidance specifies Georgia
for headlines and Arial for body — an MS-Office-era pairing that reads dated in a
dense interface and has no variable-weight axis. The interface uses **Inter
Variable**, self-hosted via `@fontsource-variable/inter` so it works offline with
no CDN. **Georgia is retained in exactly one place: printed and print-preview
documents** — invoices, report covers, registration cards — through
`.print-serif`. That is where the brand serif still earns its keep.

Both are flagged in `tokens/design-system.md` for brand review. **Keep both.**

---

## Installing the typeface

```bash
npm install @fontsource-variable/inter
```

Self-hosted, not a CDN link. The interface must render correctly with no network
— a front desk on a dropped connection still needs to read.

---

## If the brand team supplies an update

1. Replace the file in `logo/` or `source/`, unaltered.
2. Update `tokens/theme.css` if a colour changed.
3. Record what changed and why in `docs/DECISIONS.md`.
4. Open `/design-system` and confirm the page still matches.

**Never** apply a brand change by editing a component. The token is the only
place a colour or a size is allowed to be defined.
