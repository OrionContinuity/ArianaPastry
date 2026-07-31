/* ═══════════════════════════════════════════════════════════════════════
   Ariana Bakehouse — in-place edit mode.

   Loaded ONLY when the storefront is opened with ?edit=1 by someone holding the
   admin passphrase, so ordinary visitors never download a byte of it.

   Editing model, and why:
   • All copy is stored as PLAIN TEXT in one `ar_content` row (section 'copy'),
     applied with textContent. Nothing here ever writes innerHTML — a stored
     string can therefore never inject markup into a public page, even if the
     database were tampered with.
   • Elements opt in with data-edit="<key>". Design that needs markup (the hero's
     italic word, line breaks) is split into several keys rather than storing HTML.
   • Images become client-resized data URLs, so there is no storage bucket to
     provision and no second system to keep in sync.
   • Every write goes through the same passphrase-gated definer RPCs the back
     office uses. Edit mode adds no new privilege and no new write path.
   ═══════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var CFG = window.AR_CONFIG || {};
  var PASS = '';
  try { PASS = sessionStorage.getItem('ar_pass') || ''; } catch (e) {}

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return [].slice.call((r || document).querySelectorAll(s)); };

  function rpc(fn, body) {
    var ctl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctl) ctl.abort(); }, 20000);
    return fetch(CFG.SUPA_URL + '/rest/v1/rpc/' + fn, {
      method: 'POST',
      headers: { apikey: CFG.SUPA_KEY, Authorization: 'Bearer ' + CFG.SUPA_KEY,
                 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctl ? ctl.signal : undefined,
    }).then(function (r) {
      clearTimeout(timer);
      return r.text().then(function (t) {
        var d = null;
        try { d = t ? JSON.parse(t) : null; } catch (e) { d = t; }
        return { ok: r.ok, status: r.status, data: d };
      });
    }).catch(function (e) {
      clearTimeout(timer);
      return { ok: false, status: 0,
               data: (e && e.name === 'AbortError') ? 'timed out' : String((e && e.message) || e) };
    });
  }

  /* PostgREST hands a jsonb result back as an object, a JSON string, or a
     single-element array depending on version. Normalise before reading. */
  function unwrap(x) {
    for (var i = 0; i < 3; i++) {
      if (x == null) return {};
      if (Array.isArray(x)) { x = x[0]; continue; }
      if (typeof x === 'string') { try { x = JSON.parse(x); } catch (e) { return {}; } continue; }
      return (typeof x === 'object') ? x : {};
    }
    return {};
  }

  function api(path) {
    return fetch(CFG.SUPA_URL + '/rest/v1/' + path, {
      headers: { apikey: CFG.SUPA_KEY, Authorization: 'Bearer ' + CFG.SUPA_KEY },
    }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; });
  }

  /* ── styles ─────────────────────────────────────────────────────────── */
  var CSS_TEXT = [
    '.ed-bar{position:fixed;left:0;right:0;top:0;z-index:9000;display:flex;align-items:center;',
    '  gap:12px;padding:9px 16px;background:#2B2018;color:#FBF6EF;font-family:Inter,system-ui,sans-serif;',
    '  font-size:13px;box-shadow:0 6px 22px -12px rgba(0,0,0,.7)}',
    '.ed-bar b{font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:#E0A06E}',
    '.ed-bar .sp{margin-left:auto}',
    '.ed-bar button{font:inherit;font-size:13px;font-weight:600;border:0;border-radius:999px;',
    '  padding:8px 15px;cursor:pointer;min-height:38px;background:#9E4E26;color:#FBF6EF}',
    '.ed-bar button.ghost{background:transparent;border:1px solid rgba(233,227,219,.35);color:#E9E3DB}',
    '.ed-state{font-size:12px;color:#C9B8A8}',
    'body.ed-on{padding-top:56px}',
    'body.ed-on header{top:56px}',
    /* editable affordance */
    '[data-edit]{position:relative;outline:1px dashed rgba(158,78,38,.45);outline-offset:3px;',
    '  cursor:text;transition:outline-color .15s ease,background .15s ease;border-radius:3px}',
    '[data-edit]:hover{outline:2px solid #9E4E26;background:rgba(224,160,110,.14)}',
    '[data-img]{outline:2px dashed rgba(158,78,38,.55);outline-offset:4px;cursor:pointer;border-radius:6px}',
    '[data-img]:hover{outline:2px solid #9E4E26}',
    /* per-card controls */
    '.ed-card{position:absolute;top:8px;right:8px;z-index:20;display:flex;gap:6px}',
    '.ed-card button{width:34px;height:34px;border-radius:50%;border:0;cursor:pointer;font-size:14px;',
    '  display:grid;place-items:center;background:#FFFDFA;color:#2B2018;',
    '  box-shadow:0 2px 8px rgba(43,32,24,.28)}',
    '.ed-card button.del{background:#7C3A1B;color:#FBF6EF}',
    '.ed-add{display:inline-flex;align-items:center;gap:8px;margin-top:18px;background:#2B2018;',
    '  color:#FBF6EF;border:0;border-radius:999px;padding:12px 22px;font:inherit;font-size:14px;',
    '  font-weight:600;cursor:pointer;min-height:44px}',
    /* sheet */
    '.ed-wrap{position:fixed;inset:0;z-index:9100;background:rgba(43,32,24,.55);display:grid;',
    '  place-items:center;padding:18px}',
    '.ed-sheet{background:#FBF6EF;border-radius:16px;padding:22px;width:min(560px,100%);',
    '  max-height:88vh;overflow:auto;font-family:Inter,system-ui,sans-serif;color:#2B2018;',
    '  box-shadow:0 24px 60px -20px rgba(43,32,24,.6)}',
    '.ed-sheet h3{font-family:Fraunces,Georgia,serif;font-size:19px;margin-bottom:4px}',
    '.ed-sheet .hint{font-size:12.5px;color:#756351;margin-bottom:16px}',
    '.ed-sheet label{display:block;font-size:11.5px;font-weight:600;letter-spacing:.06em;',
    '  text-transform:uppercase;color:#5A4A3C;margin:12px 0 5px}',
    '.ed-sheet input,.ed-sheet textarea,.ed-sheet select{width:100%;font-family:inherit;font-size:16px;',
    '  color:#2B2018;background:#FFFDFA;border:1px solid rgba(43,32,24,.18);border-radius:9px;padding:11px 13px}',
    '.ed-sheet textarea{min-height:110px;resize:vertical;line-height:1.55}',
    '.ed-sheet input:focus,.ed-sheet textarea:focus,.ed-sheet select:focus{outline:none;',
    '  border-color:#9E4E26;box-shadow:0 0 0 3px rgba(158,78,38,.22)}',
    '.ed-two{display:grid;grid-template-columns:1fr 1fr;gap:12px}',
    '@media(max-width:520px){.ed-two{grid-template-columns:1fr}}',
    '.ed-row{display:flex;gap:10px;align-items:center;margin-top:18px;flex-wrap:wrap}',
    '.ed-row .sp{margin-left:auto}',
    '.ed-btn{font:inherit;font-size:14px;font-weight:600;border:0;border-radius:999px;padding:11px 20px;',
    '  cursor:pointer;min-height:44px;background:#9E4E26;color:#FBF6EF}',
    '.ed-btn.sec{background:transparent;color:#2B2018;border:1px solid rgba(43,32,24,.2)}',
    '.ed-btn.danger{background:#7C3A1B;color:#FBF6EF}',
    '.ed-msg{font-size:13.5px;min-height:18px;margin-top:10px;color:#7C3A1B;font-weight:600}',
    '.ed-prev{max-width:100%;max-height:150px;border-radius:8px;margin-top:10px;display:block;',
    '  border:1px solid rgba(43,32,24,.18)}',
    /* toast */
    '.ed-toast{position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:9200;',
    '  background:#2B2018;color:#FBF6EF;padding:12px 20px;border-radius:999px;font-size:14px;',
    '  font-family:Inter,system-ui,sans-serif;box-shadow:0 10px 30px -10px rgba(0,0,0,.6);',
    '  opacity:0;transition:opacity .2s ease}',
    '.ed-toast.on{opacity:1}',
    '.ed-toast.bad{background:#7C3A1B}',
    '@media print{.ed-bar,.ed-card,.ed-add{display:none}}',
  ].join('\n');

  function injectCSS() {
    var s = document.createElement('style');
    s.id = 'ed-css';
    s.textContent = CSS_TEXT;
    document.head.appendChild(s);
  }

  /* ── toast ──────────────────────────────────────────────────────────── */
  var toastEl;
  function toast(text, bad) {
    if (!toastEl) {
      toastEl = document.createElement('div');
      toastEl.className = 'ed-toast';
      document.body.appendChild(toastEl);
    }
    toastEl.textContent = text;
    toastEl.className = 'ed-toast on' + (bad ? ' bad' : '');
    clearTimeout(toastEl._t);
    toastEl._t = setTimeout(function () { toastEl.className = 'ed-toast'; }, 2600);
  }

  /* ── sheet helper ───────────────────────────────────────────────────── */
  function sheet(opts) {
    var wrap = document.createElement('div');
    wrap.className = 'ed-wrap';
    var box = document.createElement('div');
    box.className = 'ed-sheet';
    wrap.appendChild(box);

    var h = document.createElement('h3'); h.textContent = opts.title; box.appendChild(h);
    if (opts.hint) {
      var p = document.createElement('p'); p.className = 'hint'; p.textContent = opts.hint;
      box.appendChild(p);
    }
    var body = document.createElement('div'); box.appendChild(body);
    var msg = document.createElement('p'); msg.className = 'ed-msg'; box.appendChild(msg);

    var row = document.createElement('div'); row.className = 'ed-row';
    var save = document.createElement('button'); save.className = 'ed-btn';
    save.setAttribute('data-act', 'save');
    save.textContent = opts.saveLabel || 'Save';
    var cancel = document.createElement('button'); cancel.className = 'ed-btn sec';
    cancel.setAttribute('data-act', 'cancel');
    cancel.textContent = 'Cancel';
    row.appendChild(save); row.appendChild(cancel);
    if (opts.onDelete) {
      var sp = document.createElement('span'); sp.className = 'sp'; row.appendChild(sp);
      var del = document.createElement('button'); del.className = 'ed-btn danger';
      del.setAttribute('data-act', 'delete');
      del.textContent = 'Delete';
      del.addEventListener('click', function () { opts.onDelete(close, function (t) { msg.textContent = t; }); });
      row.appendChild(del);
    }
    box.appendChild(row);

    function close() { if (wrap.parentNode) wrap.parentNode.removeChild(wrap); document.removeEventListener('keydown', esc); }
    function esc(e) { if (e.key === 'Escape') close(); }
    cancel.addEventListener('click', close);
    wrap.addEventListener('click', function (e) { if (e.target === wrap) close(); });
    document.addEventListener('keydown', esc);
    save.addEventListener('click', function () {
      save.disabled = true; save.textContent = 'Saving…';
      opts.onSave(close, function (t) {
        msg.textContent = t; save.disabled = false; save.textContent = opts.saveLabel || 'Save';
      });
    });

    document.body.appendChild(wrap);
    opts.build(body, box);
    var first = body.querySelector('input,textarea,select');
    if (first) first.focus();
    return { close: close, msg: msg };
  }

  function field(parent, label, value, type) {
    var l = document.createElement('label'); l.textContent = label; parent.appendChild(l);
    var el = document.createElement(type === 'textarea' ? 'textarea' : 'input');
    if (type && type !== 'textarea') el.type = type;
    el.value = value == null ? '' : value;
    parent.appendChild(el);
    return el;
  }

  /* ── copy (all plain-text site strings) ─────────────────────────────── */
  var COPY = {};

  function loadCopy() {
    return api('ar_content?select=section,data&section=eq.copy').then(function (rows) {
      COPY = (rows && rows[0] && rows[0].data) || {};
      return COPY;
    });
  }

  function saveCopy(next, done, fail) {
    rpc('ar_save_content', { p_pass: PASS, p_section: 'copy', p_data: next }).then(function (r) {
      if (r.ok) { COPY = next; done(); }
      else fail('Save failed — HTTP ' + (r.status || 'no response'));
    });
  }

  function editText(el) {
    var key = el.getAttribute('data-edit');
    var current = el.textContent;
    var long = current.length > 60;
    var input;
    sheet({
      title: 'Edit text',
      hint: 'Plain text only. This replaces the words in place, everywhere they appear on the site.',
      build: function (body) {
        input = field(body, key.replace(/\./g, ' › '), current, long ? 'textarea' : 'text');
      },
      onSave: function (close, fail) {
        var v = input.value.trim();
        if (!v) return fail('Text cannot be empty. Use Cancel to leave it unchanged.');
        var next = {};
        Object.keys(COPY).forEach(function (k) { next[k] = COPY[k]; });
        next[key] = v;
        saveCopy(next, function () {
          el.textContent = v;
          close(); toast('Saved');
        }, fail);
      },
    });
  }

  /* ── images ─────────────────────────────────────────────────────────── */
  function pickImage(maxW, cb) {
    var inp = document.createElement('input');
    inp.type = 'file'; inp.accept = 'image/*';
    inp.addEventListener('change', function () {
      var f = inp.files && inp.files[0];
      if (!f) return;
      var rd = new FileReader();
      rd.onload = function () {
        var img = new Image();
        img.onload = function () {
          // resize client-side: a phone photo is several megabytes and would
          // otherwise be written verbatim into a database row and shipped to
          // every visitor on every page load.
          var scale = Math.min(1, maxW / img.width);
          var w = Math.round(img.width * scale), h = Math.round(img.height * scale);
          var c = document.createElement('canvas');
          c.width = w; c.height = h;
          c.getContext('2d').drawImage(img, 0, 0, w, h);
          var out;
          try { out = c.toDataURL('image/jpeg', 0.82); } catch (e) { out = rd.result; }
          if (out.length > 900000) { out = c.toDataURL('image/jpeg', 0.6); }
          cb(out, Math.round(out.length / 1024));
        };
        img.onerror = function () { cb(null); };
        img.src = rd.result;
      };
      rd.readAsDataURL(f);
    });
    inp.click();
  }

  function editImage(el) {
    var slot = el.getAttribute('data-img');
    var pending = null;
    var prev;
    sheet({
      title: 'Replace image',
      hint: slot === 'logo'
        ? 'Upload a logo. It replaces the drawn mark in the header. A square PNG with a transparent background works best.'
        : 'Upload a photo. It is resized in your browser before it is saved.',
      saveLabel: 'Save image',
      build: function (body) {
        var b = document.createElement('button');
        b.className = 'ed-btn sec'; b.textContent = 'Choose an image…';
        b.addEventListener('click', function () {
          pickImage(slot === 'logo' ? 512 : 1400, function (dataUrl, kb) {
            if (!dataUrl) { toast('Could not read that image', true); return; }
            pending = dataUrl;
            prev.src = dataUrl; prev.style.display = 'block';
            toast('Ready to save · ' + kb + ' KB');
          });
        });
        body.appendChild(b);
        prev = document.createElement('img');
        prev.className = 'ed-prev'; prev.style.display = 'none';
        body.appendChild(prev);
      },
      onSave: function (close, fail) {
        if (!pending) return fail('Choose an image first.');
        var imgs = {};
        api('ar_content?select=data&section=eq.images').then(function (rows) {
          imgs = (rows && rows[0] && rows[0].data) || {};
          imgs[slot] = pending;
          rpc('ar_save_content', { p_pass: PASS, p_section: 'images', p_data: imgs })
            .then(function (r) {
              if (!r.ok) return fail('Save failed — HTTP ' + (r.status || 'no response'));
              applyImage(slot, pending);
              close(); toast('Image saved');
            });
        });
      },
      onDelete: function (close, fail) {
        api('ar_content?select=data&section=eq.images').then(function (rows) {
          var imgs = (rows && rows[0] && rows[0].data) || {};
          delete imgs[slot];
          rpc('ar_save_content', { p_pass: PASS, p_section: 'images', p_data: imgs })
            .then(function (r) {
              if (!r.ok) return fail('Could not remove it — HTTP ' + (r.status || '?'));
              close(); toast('Image removed — reloading'); setTimeout(function () { location.reload(); }, 700);
            });
        });
      },
    });
  }

  function applyImage(slot, url) {
    if (slot === 'logo') {
      var holder = $('[data-img="logo"]');
      if (!holder) return;
      var img = holder.querySelector('img.ar-logo');
      if (!img) {
        img = document.createElement('img');
        img.className = 'ar-logo';
        img.style.cssText = 'width:34px;height:34px;object-fit:contain;display:block';
        var svg = holder.querySelector('svg');
        if (svg) svg.style.display = 'none';
        holder.insertBefore(img, holder.firstChild);
      }
      img.src = url;
    }
  }

  /* ── products ───────────────────────────────────────────────────────── */
  function productSheet(p) {
    var isNew = !p;
    p = p || { category: 'pastry', unit: 'each', glyph: 'croissant', lead_days: 2, sort: 100,
               price_cents: 0, active: true, featured: false };
    var f = {};
    var photo = p.image || null;
    var prev;
    sheet({
      title: isNew ? 'Add something to the case' : 'Edit “' + (p.name || '') + '”',
      hint: 'Prices are re-checked on the server when an order is placed, so this is the only place a price is real.',
      build: function (body) {
        f.name = field(body, 'Name', p.name, 'text');
        var two = document.createElement('div'); two.className = 'ed-two'; body.appendChild(two);
        f.price = field(two, 'Price (dollars)', ((p.price_cents || 0) / 100).toFixed(2), 'number');
        f.price.step = '0.01'; f.price.min = '0';
        f.unit = field(two, 'Unit', p.unit, 'text');
        f.blurb = field(body, 'Card line', p.blurb, 'text');
        f.detail = field(body, 'Longer description', p.detail, 'textarea');
        var two2 = document.createElement('div'); two2.className = 'ed-two'; body.appendChild(two2);
        f.badge = field(two2, 'Badge (optional)', p.badge, 'text');
        f.lead = field(two2, 'Days notice', p.lead_days, 'number');

        var l = document.createElement('label'); l.textContent = 'Category'; body.appendChild(l);
        f.cat = document.createElement('select');
        ['pastry', 'tart', 'cake', 'bread', 'drink'].forEach(function (c) {
          var o = document.createElement('option'); o.value = c; o.textContent = c;
          if (c === p.category) o.selected = true;
          f.cat.appendChild(o);
        });
        body.appendChild(f.cat);

        var two3 = document.createElement('div'); two3.className = 'ed-two'; body.appendChild(two3);
        var lf = document.createElement('label'); lf.textContent = 'Show on “fresh this week”'; two3.appendChild(lf);
        f.feat = document.createElement('select');
        [['false', 'No'], ['true', 'Yes']].forEach(function (o) {
          var op = document.createElement('option'); op.value = o[0]; op.textContent = o[1];
          if (String(!!p.featured) === o[0]) op.selected = true;
          f.feat.appendChild(op);
        });
        two3.appendChild(f.feat);

        var lb = document.createElement('label'); lb.textContent = 'Photo'; body.appendChild(lb);
        var pb = document.createElement('button');
        pb.className = 'ed-btn sec'; pb.textContent = photo ? 'Replace photo…' : 'Add a photo…';
        pb.addEventListener('click', function () {
          pickImage(1400, function (d, kb) {
            if (!d) return toast('Could not read that image', true);
            photo = d; prev.src = d; prev.style.display = 'block'; toast('Photo ready · ' + kb + ' KB');
          });
        });
        body.appendChild(pb);
        prev = document.createElement('img'); prev.className = 'ed-prev';
        prev.style.display = photo ? 'block' : 'none';
        if (photo) prev.src = photo;
        body.appendChild(prev);
      },
      onSave: function (close, fail) {
        var name = f.name.value.trim();
        if (!name) return fail('Give it a name.');
        var row = {
          name: name,
          slug: p.slug || name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
          category: f.cat.value,
          price_cents: Math.round(parseFloat(f.price.value || '0') * 100),
          unit: f.unit.value.trim() || 'each',
          blurb: f.blurb.value.trim(),
          detail: f.detail.value.trim(),
          badge: f.badge.value.trim() || null,
          lead_days: Number(f.lead.value || 0),
          featured: f.feat.value === 'true',
          glyph: p.glyph || 'croissant',
          sort: p.sort == null ? 100 : p.sort,
          active: p.active !== false,
          image: photo,
        };
        rpc('ar_save_product', { p_pass: PASS, p_id: p.id || null, p_row: row }).then(function (r) {
          if (!r.ok) return fail('Save failed — HTTP ' + (r.status || 'no response'));
          close(); toast(isNew ? 'Added to the case' : 'Saved');
          refresh();
        });
      },
      onDelete: isNew ? null : function (close, fail) {
        if (!confirm('Remove “' + p.name + '” from the case?')) return;
        rpc('ar_delete_product', { p_pass: PASS, p_id: p.id }).then(function (r) {
          if (!r.ok) return fail('Could not delete — HTTP ' + (r.status || '?'));
          close(); toast('Removed'); refresh();
        });
      },
    });
  }

  /* ── hours & notice ─────────────────────────────────────────────────── */
  function editHours() {
    var ta, notice;
    Promise.all([
      api('ar_content?select=data&section=eq.hours'),
      api('ar_content?select=data&section=eq.notice'),
    ]).then(function (res) {
      var lines = ((res[0] && res[0][0] && res[0][0].data && res[0][0].data.lines) || []).join('\n');
      var noticeText = (res[1] && res[1][0] && res[1][1] !== undefined ? '' : '') ||
                       ((res[1] && res[1][0] && res[1][0].data && res[1][0].data.text) || '');
      sheet({
        title: 'Hours & notice',
        hint: 'One line per row, in the form  Days · Times  — the middle dot splits the two columns. The notice shows above Visit; leave it blank to hide it.',
        build: function (body) {
          ta = field(body, 'Hours', lines, 'textarea');
          notice = field(body, 'Notice bar', noticeText, 'text');
        },
        onSave: function (close, fail) {
          var arr = ta.value.split('\n').map(function (l) { return l.trim(); })
                      .filter(function (l) { return l; });
          rpc('ar_save_content', { p_pass: PASS, p_section: 'hours', p_data: { lines: arr } })
            .then(function (r1) {
              if (!r1.ok) return fail('Hours failed — HTTP ' + (r1.status || '?'));
              rpc('ar_save_content', { p_pass: PASS, p_section: 'notice',
                                       p_data: { text: notice.value.trim() } })
                .then(function (r2) {
                  if (!r2.ok) return fail('Notice failed — HTTP ' + (r2.status || '?'));
                  close(); toast('Saved'); refresh();
                });
            });
        },
      });
    });
  }

  /* ── wiring ─────────────────────────────────────────────────────────── */
  function refresh() {
    if (window.AR && window.AR.goLive) window.AR.goLive();
    setTimeout(decorate, 450);
  }

  function decorate() {
    // product cards get their own controls
    $$('.p-card').forEach(function (card) {
      if (card.querySelector('.ed-card')) return;
      var add = card.querySelector('[data-add],[data-inc]');
      var slug = add && (add.getAttribute('data-add') || add.getAttribute('data-inc'));
      if (!slug) return;
      var list = (window.AR && window.AR.products && window.AR.products()) || [];
      var p = null;
      for (var i = 0; i < list.length; i++) if (list[i].slug === slug) p = list[i];
      if (!p) return;

      var art = card.querySelector('.p-art');
      if (art) art.style.position = 'relative';
      var box = document.createElement('div');
      box.className = 'ed-card';

      var ed = document.createElement('button');
      ed.type = 'button'; ed.title = 'Edit this item'; ed.textContent = '✎';
      ed.addEventListener('click', function (e) {
        e.preventDefault(); e.stopPropagation(); productSheet(p);
      });

      var rm = document.createElement('button');
      rm.type = 'button'; rm.className = 'del'; rm.title = 'Remove this item'; rm.textContent = '✕';
      rm.addEventListener('click', function (e) {
        e.preventDefault(); e.stopPropagation();
        if (!confirm('Remove “' + p.name + '” from the case?')) return;
        rpc('ar_delete_product', { p_pass: PASS, p_id: p.id }).then(function (r) {
          if (r.ok) { toast('Removed'); refresh(); }
          else toast('Could not remove it', true);
        });
      });

      box.appendChild(ed); box.appendChild(rm);
      (art || card).appendChild(box);
    });

    // "add an item" button under the catalog
    var cat = $('#catalog');
    if (cat && !$('#edAdd')) {
      var b = document.createElement('button');
      b.id = 'edAdd'; b.className = 'ed-add'; b.type = 'button';
      b.textContent = '＋ Add something to the case';
      b.addEventListener('click', function () { productSheet(null); });
      cat.parentNode.insertBefore(b, cat.nextSibling);
    }

    // hours panel
    var hours = $('#hoursList');
    if (hours && !hours._edWired) {
      hours._edWired = true;
      hours.style.cursor = 'pointer';
      hours.title = 'Edit hours and the notice bar';
      hours.addEventListener('click', editHours);
    }
  }

  function bindStatic() {
    document.addEventListener('click', function (e) {
      var t = e.target.closest('[data-edit]');
      if (t) { e.preventDefault(); e.stopPropagation(); editText(t); return; }
      var im = e.target.closest('[data-img]');
      if (im) { e.preventDefault(); e.stopPropagation(); editImage(im); }
    }, true);
  }

  function bar() {
    var d = document.createElement('div');
    d.className = 'ed-bar';
    var b = document.createElement('b'); b.textContent = 'Edit mode';
    var s = document.createElement('span'); s.className = 'ed-state';
    s.textContent = 'Click any dashed area to change it';
    var sp = document.createElement('span'); sp.className = 'sp';
    var hrs = document.createElement('button'); hrs.className = 'ghost'; hrs.textContent = 'Hours';
    hrs.addEventListener('click', editHours);
    var back = document.createElement('button'); back.className = 'ghost'; back.textContent = 'Back of house';
    back.addEventListener('click', function () { location.href = 'admin.html'; });
    var exit = document.createElement('button'); exit.textContent = 'Done';
    exit.addEventListener('click', function () {
      location.href = location.pathname;
    });
    d.appendChild(b); d.appendChild(s); d.appendChild(sp);
    d.appendChild(hrs); d.appendChild(back); d.appendChild(exit);
    document.body.appendChild(d);
    document.body.classList.add('ed-on');
  }

  /* ── boot ───────────────────────────────────────────────────────────── */
  function start() {
    injectCSS();
    bar();
    bindStatic();
    loadCopy().then(function () { setTimeout(decorate, 400); });
    toast('Edit mode — changes are live the moment you save');
  }

  function askPass() {
    sheet({
      title: 'Back of house',
      hint: 'Enter the bakery passphrase to edit the site in place.',
      saveLabel: 'Unlock',
      build: function (body) {
        var i = field(body, 'Passphrase', '', 'password');
        i.id = 'edPass';
      },
      onSave: function (close, fail) {
        var v = $('#edPass').value;
        if (!v) return fail('Enter the passphrase.');
        rpc('ar_admin_login', { p_pass: v }).then(function (r) {
          var d = unwrap(r && r.data);
          if (r.ok && d.ok === true) {
            PASS = v;
            try { sessionStorage.setItem('ar_pass', v); } catch (e) {}
            close(); start();
          } else if (r.ok && d.locked === true) {
            fail('Too many attempts. Try again in about 15 minutes.');
          } else if (r.ok) {
            fail('That passphrase does not match.');
          } else {
            fail('Could not reach the database — HTTP ' + (r.status || 'no response'));
          }
        });
      },
    });
  }

  function boot() {
    if (!CFG.SUPA_URL || !CFG.SUPA_KEY) {
      injectCSS();
      toast('Edit mode needs a database — config.js is blank', true);
      return;
    }
    injectCSS();
    if (PASS) start(); else askPass();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else { boot(); }
})();
