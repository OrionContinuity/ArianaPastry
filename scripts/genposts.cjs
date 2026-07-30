#!/usr/bin/env node
/* Ariana Bakehouse — bake the seed journal entries into real static pages.
 *
 * Why this exists: the journal reads from Supabase at runtime, which is fine for
 * humans but poor for crawlers. These generated pages give each seed entry a real
 * crawlable URL with BlogPosting schema. Entries written later in admin.html render
 * client-side at /journal/#slug; add them here and re-run to promote one to static.
 *
 *   node scripts/genposts.cjs
 *
 * Bodies here MUST stay in sync with the seed block in supabase-setup.sql.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const SITE = 'https://orioncontinuity.github.io/Arianna';
const ROOT = path.join(__dirname, '..');

const POSTS = [
  {
    slug: 'why-we-laminate-for-three-days',
    title: 'Why we laminate for three days',
    excerpt: 'Faster lamination is possible. It is also worse, and here is exactly where it falls apart.',
    published: '2026-07-24',
    minutes: 5,
    tags: ['technique', 'lamination'],
    body: `A croissant can be made in a day. Plenty of very good bakeries do it, and if you are baking two hundred a morning you may not have a choice.

We take three.

## What the extra time actually does

The first day is the détrempe — flour, water, salt, a little yeast, and nothing else. It rests overnight so the gluten relaxes and the flour fully hydrates. A dough that has not rested fights back when you roll it, and a dough that fights back tears its butter layer.

The second day is the butter and the folds. Cultured butter, beaten flat and cold, locked into the dough and turned three times. Between each turn the dough goes back to the cold. Rushing this is the single most common way lamination fails: warm butter does not stay in a sheet, it smears into the dough, and once it has smeared there is no getting it back.

The third day is shaping and the final proof. Slow, cold, and long.

## Where the shortcut shows

In the crumb. A fast croissant tends to look right and eat wrong — the layers are visible but they do not separate, because the butter went into the dough instead of staying between it. You get bread shaped like a croissant.

The test we use is simple and you can do it too. Tear one in half rather than cutting it. The interior should pull into distinct sheets that come apart with a little resistance. If it pulls like bread, something went warm somewhere.`,
  },
  {
    slug: 'the-cardamom-problem',
    title: 'The cardamom problem',
    excerpt: 'Ground cardamom is stale within a week of grinding. We buy pods and crack them at the bench.',
    published: '2026-07-17',
    minutes: 3,
    tags: ['ingredients', 'spice'],
    body: `Cardamom is an oil-carried spice. Almost everything you taste in it lives in volatile compounds that begin leaving the moment the seed is broken open.

Buy it ground and you are buying something that was potent in a factory and is now, at best, a suggestion.

## What we do instead

We buy green pods whole and crack them the morning they go into the bun filling. It is genuinely annoying. It adds twenty minutes to a prep list that has no twenty minutes in it.

It is also the entire reason the bun tastes like anything.

## Try it once

If you bake at home, do this experiment exactly once and you will never go back. Buy a small tin of ground cardamom and a bag of green pods. Smell the tin. Then crack four pods, grind the black seeds inside, and smell that.

They are not the same spice. They are barely related.

The pods keep for a year in a jar. The ground tin was finished before you bought it.`,
  },
  {
    slug: 'bake-it-darker',
    title: 'Bake it darker than feels comfortable',
    excerpt: 'Most home loaves come out of the oven ten minutes early. Here is how to know.',
    published: '2026-07-09',
    minutes: 4,
    tags: ['technique', 'bread'],
    body: `The most common fixable mistake in home bread is pulling the loaf too soon.

It makes sense. A pale golden loaf looks finished and looks safe. A dark, nearly-mahogany loaf looks like a mistake right up until you taste it.

## What browning is

Two things are happening in the last fifteen minutes: caramelization of the sugars and the Maillard reaction between sugars and amino acids. Both of them are flavor being created. Stop early and that flavor was simply never made — you cannot add it back with salt.

## How to actually judge it

Color is a better guide than time, and sound is better than color.

Go by color first: you want a deep reddish brown across the whole surface, not just the ears. Then tap the bottom. A finished loaf sounds hollow and a little sharp. An underbaked one sounds dull and dead, and no amount of resting will fix it.

If your first darker loaf feels alarming, cut it anyway. Then bake the next one two minutes longer.`,
  },
];

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const inline = (s) => s
  .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  .replace(/(^|[\s(])\*([^*\n]+)\*/g, '$1<em>$2</em>')
  .replace(/`([^`]+)`/g, '<code>$1</code>');

/* escape first, then introduce tags — post bodies can never inject HTML */
function mdToHtml(src) {
  return String(src || '').replace(/\r\n/g, '\n').split(/\n{2,}/).map((raw) => {
    const b = esc(raw.trim());
    if (!b) return '';
    if (/^###\s+/.test(b)) return `<h3>${inline(b.replace(/^###\s+/, ''))}</h3>`;
    if (/^##\s+/.test(b))  return `<h2>${inline(b.replace(/^##\s+/, ''))}</h2>`;
    if (/^&gt;\s?/.test(b)) return `<blockquote>${inline(b.replace(/^&gt;\s?/gm, ''))}</blockquote>`;
    if (/^[-*]\s+/.test(b)) {
      return `<ul>${b.split('\n').map((l) => `<li>${inline(l.replace(/^[-*]\s+/, ''))}</li>`).join('')}</ul>`;
    }
    if (/^\d+\.\s+/.test(b)) {
      return `<ol>${b.split('\n').map((l) => `<li>${inline(l.replace(/^\d+\.\s+/, ''))}</li>`).join('')}</ol>`;
    }
    return `<p>${inline(b).replace(/\n/g, '<br>')}</p>`;
  }).join('\n      ');
}

const fmtDate = (s) => new Date(s + 'T00:00:00')
  .toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

const MARK = `<svg class="mark" viewBox="0 0 64 64" aria-hidden="true">
        <rect width="64" height="64" rx="14" fill="#2B2018"/>
        <path d="M14 40.5c0-12.4 9.4-22 21-22 4.3 0 8.2 1.3 11.4 3.6-2.6-1.1-5.4-1.7-8.4-1.7-11.6 0-20.4 8.6-20.4 20.1 0 3 .6 5.8 1.8 8.3A21.6 21.6 0 0 1 14 40.5Z" fill="#E0A06E"/>
        <path d="M20.8 41.2c0-9.6 7.4-17.2 16.7-17.2 3.9 0 7.4 1.3 10.2 3.5-2.2-.9-4.6-1.4-7.2-1.4-9.6 0-16.9 7-16.9 16.4 0 2.5.5 4.8 1.5 6.9a16.7 16.7 0 0 1-4.3-8.2Z" fill="#9E4E26"/>
        <circle cx="45.5" cy="42" r="2.6" fill="#E0A06E"/><circle cx="41" cy="47.5" r="1.8" fill="#9E4E26"/>
        <circle cx="49.5" cy="48.5" r="1.4" fill="#756351"/>
      </svg>`;

function page(p, idx) {
  const url = `${SITE}/journal/${p.slug}/`;
  const prev = POSTS[idx + 1];
  const ld = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'BlogPosting',
        '@id': url + '#post',
        headline: p.title,
        description: p.excerpt,
        datePublished: p.published,
        dateModified: p.published,
        keywords: p.tags.join(', '),
        wordCount: p.body.split(/\s+/).length,
        inLanguage: 'en-US',
        mainEntityOfPage: { '@type': 'WebPage', '@id': url },
        author: { '@type': 'Organization', name: 'Ariana Bakehouse', url: SITE + '/' },
        publisher: { '@type': 'Bakery', name: 'Ariana Bakehouse', url: SITE + '/' },
      },
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Home', item: SITE + '/' },
          { '@type': 'ListItem', position: 2, name: 'Journal', item: SITE + '/journal/' },
          { '@type': 'ListItem', position: 3, name: p.title, item: url },
        ],
      },
    ],
  };

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(p.title)} — Ariana Bakehouse</title>
<meta name="description" content="${esc(p.excerpt)}">
<link rel="canonical" href="${url}">
<meta name="theme-color" content="#FBF6EF">
<meta name="color-scheme" content="light">
<link rel="icon" type="image/svg+xml" href="../../favicon.svg">
<meta property="og:type" content="article">
<meta property="og:site_name" content="Ariana Bakehouse">
<meta property="og:title" content="${esc(p.title)}">
<meta property="og:description" content="${esc(p.excerpt)}">
<meta property="og:url" content="${url}">
<meta property="article:published_time" content="${p.published}">
<meta name="twitter:card" content="summary">
<meta name="twitter:title" content="${esc(p.title)}">
<meta name="twitter:description" content="${esc(p.excerpt)}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,600;9..144,700&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
<link rel="stylesheet" href="../../site.css">
<script type="application/ld+json">
${JSON.stringify(ld, null, 2)}
</script>
</head>
<body>
<a class="skip" href="#main">Skip to content</a>

<header>
  <div class="wrap nav">
    <a class="brand" href="../../" aria-label="Ariana Bakehouse — home">
      ${MARK}
      <span class="wm">Ariana<span class="tag">Bakehouse</span></span>
    </a>
    <nav class="nav-links" aria-label="Primary">
      <a href="../">Journal</a>
      <a href="../../#case">The Case</a>
      <a href="../../#order">Pre-order</a>
    </nav>
  </div>
</header>

<main id="main" class="wrap">
  <article class="post narrow">
    <p><a href="../" style="color:var(--copper);font-weight:600;font-size:14px">&larr; All entries</a></p>
    <div class="meta">
      <span>${esc(fmtDate(p.published))}</span><span class="dot"></span>
      <span>${p.minutes} min read</span><span class="dot"></span>
      <span>${esc(p.tags.join(' · '))}</span>
    </div>
    <h1>${esc(p.title)}</h1>
    <p class="lede">${esc(p.excerpt)}</p>
    <div class="prose">
      ${mdToHtml(p.body)}
    </div>
    <div class="post-foot">
      ${prev ? `<a class="btn btn-s" href="../${prev.slug}/">&larr; ${esc(prev.title)}</a>`
             : '<a class="btn btn-s" href="../">More from the journal</a>'}
      <a class="btn btn-p" href="../../#order">Pre-order for pickup</a>
    </div>
  </article>
</main>

<footer>
  <div class="wrap">
    <h4>Ariana Bakehouse</h4>
    <p style="font-size:14px;color:#C9B8A8;max-width:40ch">A small bakery in Austin, Texas.
      Short list, long method, sold out by noon.</p>
    <div class="f-bar">
      <span>&copy; ${new Date().getFullYear()} Ariana Bakehouse. Austin, Texas.</span>
      <a class="f-nexus" href="https://www.atxnexus.com" rel="noopener">Powered by NEXUS</a>
    </div>
  </div>
</footer>
</body>
</html>
`;
}

let n = 0;
POSTS.forEach((p, i) => {
  const dir = path.join(ROOT, 'journal', p.slug);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'index.html'), page(p, i), 'utf8');
  n++;
  console.log('  wrote journal/' + p.slug + '/index.html');
});

/* sitemap covers the home page, the journal index, and every static entry */
const urls = [
  { loc: SITE + '/', pri: '1.0', freq: 'weekly' },
  { loc: SITE + '/journal/', pri: '0.8', freq: 'weekly' },
].concat(POSTS.map((p) => ({
  loc: `${SITE}/journal/${p.slug}/`, pri: '0.6', freq: 'monthly', mod: p.published,
})));

fs.writeFileSync(path.join(ROOT, 'sitemap.xml'),
  '<?xml version="1.0" encoding="UTF-8"?>\n'
  + '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
  + urls.map((u) => '  <url>\n    <loc>' + u.loc + '</loc>\n'
      + (u.mod ? '    <lastmod>' + u.mod + '</lastmod>\n' : '')
      + '    <changefreq>' + u.freq + '</changefreq>\n'
      + '    <priority>' + u.pri + '</priority>\n  </url>').join('\n')
  + '\n</urlset>\n', 'utf8');
console.log('  wrote sitemap.xml (' + urls.length + ' urls)');
console.log('done — ' + n + ' entries baked.');
