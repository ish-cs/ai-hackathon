# Mimic Design System — Handoff for the Cost Race demo

This is the design language of the landing page (`web/index.html`). Apply it to
`web/race.html` so the demo reads as the same product. Pull tokens from here; do
not guess. The mock target sites (`mock-public/*`) are **out of scope** — leave
them looking like real third-party sites.

## 1. Tokens

### Color
| Role | Value |
|---|---|
| Base background | `#050504` |
| Page gradient (optional) | `radial-gradient(150% 90% at 50% 0%,#16140f 0%,#0a0a08 42%,#050504 100%) fixed` |
| Demo/section background | `#000` |
| Primary ink (brand cream) | `#E1E0CC` |
| Dim ink | `#cfcbb2`, `#9b988b`, `#6f6e63` |
| Hairline / borders | `rgba(225,224,204,.10)` (also `.08`, `.18`) |
| Muted text | `rgba(225,224,204,.45)` / `.35` / `.6` / `.78` |
| Accent — alert/danger | `#ff6b6b` (lighter `#ff9b9b`) |
| Accent — success | `#7fd3a0` |
| Surfaces / cards | `#0c0c0a`, `#1c1c19` |

### Typography
- **Body / UI / labels:** `'Almarai', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif` — weights 300 / 400 / 700.
- **Display / headlines:** `'Instrument Serif', serif`, usually `font-style:italic`, color `#cfcbb2` or `#E1E0CC` for emphasis spans.
- **Data / numbers (live cost counters):** `ui-monospace, Menlo, monospace`.
- Fonts are self-hosted as `.woff2` in `web/assets/` (UUID filenames). Easiest path for the demo: load `Almarai` (300,400,700) + `Instrument Serif` from Google Fonts; the landing already `preconnect`s to `fonts.googleapis.com` / `fonts.gstatic.com`.
- Responsive sizing uses `clamp()`, e.g. headline `clamp(28px,4.4vw,58px)`, body `clamp(14px,1.2vw,17px)`.

### Shape & motion
- Pill buttons: `border-radius:999px`.
- Signature easing (use everywhere for reveals/transitions): `cubic-bezier(.16,1,.3,1)`.
- Reveal pattern: start `opacity:0;transform:translateY(20px)`, transition `opacity .9s` + `transform .9s` with the easing above.

## 2. Components

### CTA / primary button
```html
<a href="…" style="display:inline-flex;align-items:center;gap:10px;background:#E1E0CC;color:#000;border:none;border-radius:999px;padding:12px 28px;text-decoration:none;font-family:'Almarai',sans-serif;font-weight:700;font-size:16px;transition:gap .3s ease;">Label <span>&rarr;</span></a>
```
On `:hover`, widen the gap (e.g. `gap:14px`) using **real CSS `:hover`** — the
landing's `style-hover` attributes are dead/inert; do not copy them.

### Section heading
Cream label kicker (uppercase, letter-spaced, 11px) above an `Instrument Serif`
italic headline. Center-aligned, generous vertical padding `clamp(60px,9vh,120px)`.

## 3. Voice / feel
Minimal, warm-on-near-black, editorial. Serif italic carries emotional lines;
sans carries function; mono carries numbers. Lots of negative space.

## 4. race.html → landing mapping

Swap the demo's current dev vars for landing tokens. **Keep `--stage` and
`--mimic` as functional lane colors** — they encode the two competitors and must
stay distinct from each other and from the brand red `#ff6b6b`.

| race.html var | current | change to |
|---|---|---|
| `--bg` | `#0c0d10` | `#050504` (or the page gradient) |
| `--ink` | `#e8eaed` | `#E1E0CC` |
| `--dim` | `#8b909c` | `rgba(225,224,204,.45)` (or `#9b988b`) |
| `--line` | `#262a33` | `rgba(225,224,204,.10)` |
| `--stage` | `#ff7a59` | **KEEP** (Stagehand lane) |
| `--mimic` | `#39d98a` | **KEEP** (Mimic lane) |

Beyond the vars: switch the mono-only body to `Almarai` for chrome/labels, use
`Instrument Serif` italic for the headline/lane titles, and keep `ui-monospace`
for the live cost numbers. Restyle the Start button as the pill CTA above.