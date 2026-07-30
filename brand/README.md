# Ariana Bakehouse — brand assets

The mark is **The Case**: a bakery case drawn as an oven arch, a shelf of three
pastries, a loaf below, and a counter rule running past the frame on both sides.

## Files

| File | Use |
| --- | --- |
| `ariana-mark.svg` | **Start here.** Vector, infinitely scalable, the master artwork. |
| `ariana-mark.png` | 1600×1600, transparent background. |
| `ariana-mark-espresso.svg/.png` | Reversed, for dark surfaces. |
| `ariana-mark-onecolour.svg/.png` | Single ink. Embroidery, stamps, one-colour print, engraving. |
| `ariana-icon.svg` | **The reduced form** — favicon and app icon only. See below. |
| `ariana-appicon.png` | 2048×2048 espresso tile. App icon, social avatar. |
| `ariana-appicon-parchment.png` | 2048×2048 light tile. |
| `ariana-lockup.png` | 2672×1128, mark beside the wordmark. The default lockup. |
| `ariana-lockup-espresso.png` | Reversed lockup. |
| `ariana-lockup-stacked.png` | 1792×2096, mark above the wordmark. Signage, avatars, anything square. |

PNGs are rendered at 4× device scale. The lockup at 2672px is about 9 inches at
300dpi — ample for a menu, a box, or a shopfront decal. For anything larger,
use the SVG.

## The two sizes of the mark, and why

`ariana-mark` carries the shelf line and three scalloped pastries. Below roughly
24px those become four horizontal bands in a space with room for two, and the
whole thing collapses into a grey smudge.

`ariana-icon` is the answer: shelf and scallops dropped, arch thickened, loaf
kept as a solid bar. Verified by rasterising at 16/20/32/64px and upscaling
nearest-neighbour, not by trusting the vector preview.

**Use the full mark everywhere there is room. Use the icon only for the favicon
and app icon.** This is the one rule that gets forgotten.

## Colour

| Role | Hex |
| --- | --- |
| Ink / espresso | `#2B2018` |
| Copper | `#9E4E26` |
| Copper light — on dark only | `#E0A06E` |
| Parchment | `#FBF6EF` |
| Band | `#F3EADD` |
| Pistachio — accent, sparing | `#4F6B3C` |

Every text pair on the site clears WCAG AA. Copper is 5.47:1 on parchment and
4.93:1 on the band tint; ink is 14.77:1. Copper on espresso is only 2.9:1 — that
is why dark surfaces use copper light instead.

## Type

**Fraunces**, weight 600, for the wordmark — the PNGs here are rendered in the
real typeface, not a fallback. `BAKEHOUSE` is the same face, letterspaced to
`0.42em` so its ink width matches "Ariana" above it. Body copy on the site is
Inter.

## Don't

- Don't recolour outside the palette, or put copper on espresso.
- Don't add gradients, shadows, or outlines. It is a flat mark.
- Don't use the full mark below 24px, or the icon above it.
- Don't stretch the lockup — scale both axes together.
- Don't rebuild the wordmark in another serif. Georgia is the substitute if
  Fraunces is unavailable, and it is a substitute, not an equivalent.
