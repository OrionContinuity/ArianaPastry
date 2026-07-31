#!/usr/bin/env node
/* Stamp a build marker across the site.
 *
 * Why: a static site on GitHub Pages gives you no way to tell, from the phone in
 * your hand, whether you are looking at the deploy you just made or a cached copy
 * from twenty minutes ago. That ambiguity cost real debugging time — a fixed login
 * looked broken because the browser was still running the old page.
 *
 * This writes one version string into config.js, and busts the query string on
 * every asset reference so a stale config.js or stylesheet cannot survive a deploy.
 * The pages render the marker in the footer, and on the admin gate.
 *
 *   node scripts/stamp.cjs
 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

const d = new Date();
const p2 = (n) => String(n).padStart(2, '0');
const VERSION = `v${d.getUTCFullYear()}.${p2(d.getUTCMonth() + 1)}.${p2(d.getUTCDate())}`
              + `-${p2(d.getUTCHours())}${p2(d.getUTCMinutes())}`;

const files = [
  'config.js', 'index.html', 'admin.html', '404.html',
  'journal/index.html', 'scripts/genposts.cjs',
];

let touched = 0;
for (const rel of files) {
  const f = path.join(ROOT, rel);
  if (!fs.existsSync(f)) continue;
  let s = fs.readFileSync(f, 'utf8');
  const before = s;

  // the single source of truth
  s = s.replace(/BUILD:\s*'[^']*'/g, `BUILD: '${VERSION}'`);
  // cache-bust every asset reference
  s = s.replace(/(config\.js|site\.css|favicon\.svg)\?v=[^"']*/g, `$1?v=${VERSION}`);

  if (s !== before) { fs.writeFileSync(f, s, 'utf8'); touched++; console.log('  stamped ' + rel); }
}

console.log(`${VERSION} — ${touched} file(s)`);
