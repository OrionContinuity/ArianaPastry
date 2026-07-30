# Arianna Bakehouse

A pastry seller and journal, built the way GBC is built: hand-written static HTML,
zero dependencies, Supabase behind it for anything that changes.

**The brand is a placeholder we invented** — name, palette, voice, catalog and all
three journal entries. Every word is replaceable; nothing here claims to be a real
business, and there are no invented awards, reviews or statistics anywhere on the page.

---

## Run it

It is static. Open `index.html`, or serve the folder:

```sh
python3 -m http.server 8080
```

With `config.js` left blank the site runs in **static mode**: the built-in catalog and
journal render, and the pre-order form falls back to a pre-filled email. Nothing breaks
without a backend.

## Wire the backend

1. Pick a Supabase project (a new one is **$10/month**; the existing `gbc` project can
   host this alongside `gbc_*` tables — every table and function here is prefixed `ar_`
   precisely so the two never collide).
2. Open `supabase-setup.sql`, **change `CHANGE-ME-NOW`** to a real passphrase, and run
   the whole file in that project's SQL editor.
3. Put the project URL and anon key into `config.js`.

The site then reads its catalog, journal and page text live, and orders land in the
database instead of an email draft.

## Files

| Path | What it is |
| --- | --- |
| `index.html` | The whole storefront. CSS and JS inline — it is the critical path. |
| `site.css` | Shared shell for the journal pages only. |
| `journal/index.html` | Journal index; also renders admin-written entries client-side. |
| `journal/<slug>/` | Static, crawlable entry pages. **Generated — do not hand-edit.** |
| `admin.html` | Passphrase-gated back office. `noindex`, and disallowed in robots.txt. |
| `scripts/genposts.cjs` | Bakes the seed entries into static pages and rewrites `sitemap.xml`. |
| `supabase-setup.sql` | Schema, RLS, and every RPC. Run once. |
| `config.js` | The only file with credentials in it. |

Re-generate the static entries after editing `scripts/genposts.cjs`:

```sh
node scripts/genposts.cjs
```

## How the security model works

Same shape as GBC, which came out of the NEXUS hardening:

- Public tables are **read-only to anon**. There is not a single write policy.
- Every write goes through a `security definer` RPC that checks a bcrypt passphrase
  first, with `search_path` pinned.
- Supabase auto-grants `EXECUTE` on new functions, so the setup script **revokes**
  `PUBLIC` and `authenticated` explicitly, then re-grants only `anon` and `service_role`.
- `ar_orders` and `ar_events` hold customer data and have **no select policy at all** —
  the anon key can write an order through the RPC but cannot read one back.
- The order funnel has a honeypot field, a per-IP hourly limit and a global daily
  ceiling, and derives the client IP from `cf-connecting-ip` rather than the
  spoofable left-most `x-forwarded-for` hop.
- **Prices are never trusted from the browser.** `ar_submit_order` re-prices every line
  against `ar_products` and computes the total itself, so a tampered cart cannot
  change what an order is worth.

## Design notes

Palette measured, not guessed — every text pair clears WCAG AA:

| | on parchment `#FBF6EF` |
| --- | --- |
| ink `#2B2018` | 14.77:1 |
| ink-soft `#5A4A3C` | 7.88:1 |
| ink-faint `#756351` | 5.34:1 |
| copper `#9E4E26` | 5.47:1 |

Cream-on-copper buttons run 5.47:1; copper on the band tint `#F3EADD` is 4.93:1.
The ink is deliberately espresso rather than a blue-grey — one cool ink undoes a warm page.

Other rules the build follows: no autoplaying carousel (the rail is manual only), one
IntersectionObserver reveal system with reduced-motion guards in CSS *and* JS, 16px
minimum on form fields to stop iOS zoom-on-focus, 44px touch targets, and header
elevation driven by a sentinel observer rather than a scroll listener.

## Still to do

- **Photography.** Every product falls back to a hand-drawn SVG; the hero says
  "Photography coming" rather than pretending. Add a `image` URL per product in the
  admin and the illustration steps aside.
- **A real address**, phone number, and the domain itself.
- Deciding whether this ships as its own repo (recommended — it is written to be
  copied to a repo root as-is) or lives on under NEXUS.
