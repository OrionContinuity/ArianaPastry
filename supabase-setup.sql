-- ═══ Arianna Bakehouse — site backend. Run ONCE in the project's SQL editor ═══
--
-- Model (inherited from GBC, which inherited it from the NEXUS hardening):
--   • public tables are READ-ONLY to anon — zero write policies, ever
--   • every write goes through a SECURITY DEFINER RPC gated on a bcrypt passphrase
--   • search_path is pinned on every function
--   • Supabase default-privs auto-grant EXECUTE — we revoke PUBLIC/authenticated
--     explicitly, then re-grant only anon + service_role
--   • tables holding customer data (orders, events) get NO select policy, so they
--     are invisible to the anon key even though the site can write to them
--
create extension if not exists pgcrypto with schema extensions;

-- ═══════════════════════════════════════════════════════════════════════
--  1. CONTENT — editable page copy, keyed by section
-- ═══════════════════════════════════════════════════════════════════════
create table if not exists public.ar_content (
  section    text primary key,
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.ar_content enable row level security;
create policy ar_content_read on public.ar_content for select using (true);

-- ═══════════════════════════════════════════════════════════════════════
--  2. PRODUCTS — the case
-- ═══════════════════════════════════════════════════════════════════════
create table if not exists public.ar_products (
  id          bigint generated always as identity primary key,
  slug        text unique not null,
  name        text not null,
  category    text not null default 'pastry',   -- pastry | bread | cake | tart | drink
  blurb       text,                             -- one line, shows on the card
  detail      text,                             -- longer copy, shows when expanded
  price_cents int  not null default 0,
  unit        text default 'each',              -- each | dozen | slice | whole | tray
  image       text,                             -- https URL or data-URL; null = SVG illustration
  glyph       text default 'croissant',         -- fallback illustration key
  badge       text,                             -- 'Weekends only', 'Seasonal', …
  lead_days   int  not null default 2,          -- pre-order notice required
  sort        int  not null default 100,
  featured    boolean not null default false,
  active      boolean not null default true,
  updated_at  timestamptz not null default now()
);
alter table public.ar_products enable row level security;
create policy ar_products_read on public.ar_products for select using (true);
create index if not exists ar_products_sort_idx on public.ar_products (active, sort);

-- ═══════════════════════════════════════════════════════════════════════
--  3. JOURNAL — the blog
-- ═══════════════════════════════════════════════════════════════════════
create table if not exists public.ar_posts (
  id           bigint generated always as identity primary key,
  slug         text unique not null,
  title        text not null,
  excerpt      text,
  body         text,                            -- light markdown (see mdToHtml in journal)
  cover        text,
  author       text default 'Arianna Bakehouse',
  tags         jsonb not null default '[]'::jsonb,
  read_minutes int default 4,
  published_at timestamptz not null default now(),
  active       boolean not null default true,
  updated_at   timestamptz not null default now()
);
alter table public.ar_posts enable row level security;
create policy ar_posts_read on public.ar_posts for select using (true);
create index if not exists ar_posts_pub_idx on public.ar_posts (active, published_at desc);

-- ═══════════════════════════════════════════════════════════════════════
--  4. PHOTOS — hero album + slot images
-- ═══════════════════════════════════════════════════════════════════════
create table if not exists public.ar_photos (
  id         bigint generated always as identity primary key,
  slot       text not null default 'album',     -- 'album' | 'story' | 'prod-<slug>'
  url        text not null,
  alt        text not null default '',
  sort       int  not null default 100,
  active     boolean not null default true,
  updated_at timestamptz not null default now()
);
alter table public.ar_photos enable row level security;
create policy ar_photos_read on public.ar_photos for select using (true);

-- ═══════════════════════════════════════════════════════════════════════
--  5. ORDERS — customer data. NO select policy: invisible to the anon key.
--     Writes happen only through ar_submit_order (honeypot + rate limited).
-- ═══════════════════════════════════════════════════════════════════════
create table if not exists public.ar_orders (
  id           bigint generated always as identity primary key,
  name         text not null,
  phone        text,
  email        text,
  pickup_date  text,
  pickup_time  text,
  occasion     text,
  items        jsonb not null default '[]'::jsonb,   -- server-priced, see below
  total_cents  int not null default 0,               -- computed server-side
  notes        text,
  status       text not null default 'new',          -- new | confirmed | ready | done | cancelled
  ip           text,
  ua           text,
  created_at   timestamptz not null default now()
);
alter table public.ar_orders enable row level security;
-- deliberately no policies

-- ═══════════════════════════════════════════════════════════════════════
--  6. EVENTS — first-party analytics. Also invisible to anon.
-- ═══════════════════════════════════════════════════════════════════════
create table if not exists public.ar_events (
  id         bigint generated always as identity primary key,
  type       text not null,   -- page_view|order_start|order_submit|call_click|post_read|menu_open
  path       text, ref text, sid text,
  meta       jsonb not null default '{}'::jsonb,
  ip         text, ua text,
  created_at timestamptz not null default now()
);
alter table public.ar_events enable row level security;
create index if not exists ar_events_created_idx on public.ar_events (created_at);
create index if not exists ar_events_type_idx    on public.ar_events (type);

-- ═══════════════════════════════════════════════════════════════════════
--  7. ADMIN passphrase (bcrypt at rest). Invisible to anon: no policies.
--     SET IT: replace CHANGE-ME-NOW below. Re-run this insert to rotate.
-- ═══════════════════════════════════════════════════════════════════════
create table if not exists public.ar_admin (
  id int primary key default 1,
  pass_hash text not null
);
alter table public.ar_admin enable row level security;
insert into public.ar_admin (id, pass_hash)
values (1, extensions.crypt('CHANGE-ME-NOW', extensions.gen_salt('bf', 10)))
on conflict (id) do update set pass_hash = excluded.pass_hash;

create or replace function public.ar_check_admin(p_pass text)
returns boolean language sql stable security definer
set search_path to 'public','extensions','pg_temp' as $$
  select exists (
    select 1 from public.ar_admin
    where id = 1 and pass_hash = extensions.crypt(coalesce(p_pass,''), pass_hash)
  );
$$;

-- ═══════════════════════════════════════════════════════════════════════
--  8. PUBLIC WRITE PATH — the pre-order funnel
--     Prices are NEVER trusted from the client: the server re-prices every
--     line against ar_products and computes the total itself.
-- ═══════════════════════════════════════════════════════════════════════
create or replace function public.ar_submit_order(p jsonb)
returns bigint language plpgsql security definer
set search_path to 'public','extensions','pg_temp' as $$
declare
  v_ip text; v_ua text; v_id bigint;
  v_name  text := left(btrim(coalesce(p->>'name','')),  120);
  v_phone text := left(btrim(coalesce(p->>'phone','')),  40);
  v_email text := left(btrim(coalesce(p->>'email','')), 160);
  v_items jsonb := coalesce(p->'items', '[]'::jsonb);
  v_clean jsonb := '[]'::jsonb;
  v_total int := 0;
  v_line  jsonb;
  v_qty   int;
  v_prod  record;
begin
  -- honeypot: a hidden "website" field. Bots fill it. Pretend success.
  if coalesce(p->>'website','') <> '' then return 0; end if;

  if length(v_name) < 2 then raise exception 'invalid_name'; end if;
  if v_phone = '' and v_email = '' then raise exception 'contact_required'; end if;
  if jsonb_array_length(v_items) = 0 then raise exception 'empty_order'; end if;
  if jsonb_array_length(v_items) > 40 then raise exception 'too_many_items'; end if;

  begin
    v_ip := coalesce(
      current_setting('request.headers', true)::json->>'cf-connecting-ip',
      current_setting('request.headers', true)::json->>'x-real-ip',
      split_part(current_setting('request.headers', true)::json->>'x-forwarded-for', ',', 1));
    v_ua := left(current_setting('request.headers', true)::json->>'user-agent', 300);
  exception when others then v_ip := null; v_ua := null;
  end;

  -- rate limits: per-IP hourly, and a global daily ceiling
  if v_ip is not null and (
       select count(*) from public.ar_orders
       where ip = v_ip and created_at > now() - interval '1 hour') >= 5 then
    raise exception 'rate_limited';
  end if;
  if (select count(*) from public.ar_orders
      where created_at > now() - interval '1 day') >= 120 then
    raise exception 'rate_limited';
  end if;

  -- re-price every line from the products table; silently drop unknown slugs
  for v_line in select * from jsonb_array_elements(v_items) loop
    v_qty := greatest(1, least(coalesce((v_line->>'qty')::int, 1), 99));
    select slug, name, price_cents, unit into v_prod
      from public.ar_products
      where slug = (v_line->>'slug') and active limit 1;
    if found then
      v_total := v_total + (v_prod.price_cents * v_qty);
      v_clean := v_clean || jsonb_build_object(
        'slug', v_prod.slug, 'name', v_prod.name, 'unit', v_prod.unit,
        'qty', v_qty, 'price_cents', v_prod.price_cents,
        'line_cents', v_prod.price_cents * v_qty);
    end if;
  end loop;

  if jsonb_array_length(v_clean) = 0 then raise exception 'empty_order'; end if;

  insert into public.ar_orders
    (name, phone, email, pickup_date, pickup_time, occasion, items, total_cents, notes, ip, ua)
  values (
    v_name, nullif(v_phone,''), nullif(v_email,''),
    nullif(left(btrim(coalesce(p->>'pickup_date','')), 40),''),
    nullif(left(btrim(coalesce(p->>'pickup_time','')), 40),''),
    nullif(left(btrim(coalesce(p->>'occasion','')),   80),''),
    v_clean, v_total,
    nullif(left(btrim(coalesce(p->>'notes','')),    4000),''),
    v_ip, v_ua)
  returning id into v_id;
  return v_id;
end $$;

-- lightweight analytics write (anon)
create or replace function public.ar_log_event(p jsonb)
returns void language plpgsql security definer
set search_path to 'public','extensions','pg_temp' as $$
declare v_ip text; v_ua text;
begin
  if coalesce(p->>'type','') not in
     ('page_view','order_start','order_submit','call_click','post_read','menu_open') then
    return;
  end if;
  begin
    v_ip := coalesce(current_setting('request.headers', true)::json->>'cf-connecting-ip',
                     current_setting('request.headers', true)::json->>'x-real-ip');
    v_ua := left(current_setting('request.headers', true)::json->>'user-agent', 300);
  exception when others then v_ip := null; v_ua := null;
  end;
  -- cheap flood guard
  if (select count(*) from public.ar_events
      where created_at > now() - interval '1 minute') >= 400 then return; end if;
  insert into public.ar_events (type, path, ref, sid, meta, ip, ua)
  values (p->>'type', left(coalesce(p->>'path',''),200), left(coalesce(p->>'ref',''),200),
          left(coalesce(p->>'sid',''),40), coalesce(p->'meta','{}'::jsonb), v_ip, v_ua);
end $$;

-- ═══════════════════════════════════════════════════════════════════════
--  9. ADMIN WRITE PATH — every one of these checks the passphrase first
-- ═══════════════════════════════════════════════════════════════════════
create or replace function public.ar_save_content(p_pass text, p_section text, p_data jsonb)
returns boolean language plpgsql security definer
set search_path to 'public','extensions','pg_temp' as $$
begin
  if not public.ar_check_admin(p_pass) then raise exception 'not_authorized'; end if;
  insert into public.ar_content (section, data, updated_at)
  values (p_section, p_data, now())
  on conflict (section) do update set data = excluded.data, updated_at = now();
  return true;
end $$;

create or replace function public.ar_save_product(p_pass text, p_id bigint, p_row jsonb)
returns bigint language plpgsql security definer
set search_path to 'public','extensions','pg_temp' as $$
declare v_id bigint;
begin
  if not public.ar_check_admin(p_pass) then raise exception 'not_authorized'; end if;
  if p_id is null then
    insert into public.ar_products
      (slug, name, category, blurb, detail, price_cents, unit, image, glyph, badge,
       lead_days, sort, featured, active)
    values (
      coalesce(nullif(btrim(p_row->>'slug'),''),
               'item-' || extract(epoch from now())::bigint),
      p_row->>'name', coalesce(p_row->>'category','pastry'),
      p_row->>'blurb', p_row->>'detail',
      coalesce((p_row->>'price_cents')::int, 0), coalesce(p_row->>'unit','each'),
      p_row->>'image', coalesce(p_row->>'glyph','croissant'), p_row->>'badge',
      coalesce((p_row->>'lead_days')::int, 2), coalesce((p_row->>'sort')::int, 100),
      coalesce((p_row->>'featured')::boolean, false),
      coalesce((p_row->>'active')::boolean, true))
    returning id into v_id;
  else
    update public.ar_products set
      slug        = coalesce(nullif(btrim(p_row->>'slug'),''), slug),
      name        = coalesce(p_row->>'name', name),
      category    = coalesce(p_row->>'category', category),
      blurb       = p_row->>'blurb',
      detail      = p_row->>'detail',
      price_cents = coalesce((p_row->>'price_cents')::int, price_cents),
      unit        = coalesce(p_row->>'unit', unit),
      image       = coalesce(p_row->>'image', image),
      glyph       = coalesce(p_row->>'glyph', glyph),
      badge       = p_row->>'badge',
      lead_days   = coalesce((p_row->>'lead_days')::int, lead_days),
      sort        = coalesce((p_row->>'sort')::int, sort),
      featured    = coalesce((p_row->>'featured')::boolean, featured),
      active      = coalesce((p_row->>'active')::boolean, active),
      updated_at  = now()
    where id = p_id returning id into v_id;
  end if;
  return v_id;
end $$;

create or replace function public.ar_delete_product(p_pass text, p_id bigint)
returns boolean language plpgsql security definer
set search_path to 'public','extensions','pg_temp' as $$
begin
  if not public.ar_check_admin(p_pass) then raise exception 'not_authorized'; end if;
  delete from public.ar_products where id = p_id;
  return true;
end $$;

create or replace function public.ar_save_post(p_pass text, p_id bigint, p_row jsonb)
returns bigint language plpgsql security definer
set search_path to 'public','extensions','pg_temp' as $$
declare v_id bigint;
begin
  if not public.ar_check_admin(p_pass) then raise exception 'not_authorized'; end if;
  if p_id is null then
    insert into public.ar_posts
      (slug, title, excerpt, body, cover, author, tags, read_minutes, published_at, active)
    values (
      coalesce(nullif(btrim(p_row->>'slug'),''),
               'post-' || extract(epoch from now())::bigint),
      p_row->>'title', p_row->>'excerpt', p_row->>'body', p_row->>'cover',
      coalesce(p_row->>'author','Arianna Bakehouse'),
      coalesce(p_row->'tags','[]'::jsonb),
      coalesce((p_row->>'read_minutes')::int, 4),
      coalesce((p_row->>'published_at')::timestamptz, now()),
      coalesce((p_row->>'active')::boolean, true))
    returning id into v_id;
  else
    update public.ar_posts set
      slug         = coalesce(nullif(btrim(p_row->>'slug'),''), slug),
      title        = coalesce(p_row->>'title', title),
      excerpt      = p_row->>'excerpt',
      body         = coalesce(p_row->>'body', body),
      cover        = coalesce(p_row->>'cover', cover),
      author       = coalesce(p_row->>'author', author),
      tags         = coalesce(p_row->'tags', tags),
      read_minutes = coalesce((p_row->>'read_minutes')::int, read_minutes),
      published_at = coalesce((p_row->>'published_at')::timestamptz, published_at),
      active       = coalesce((p_row->>'active')::boolean, active),
      updated_at   = now()
    where id = p_id returning id into v_id;
  end if;
  return v_id;
end $$;

create or replace function public.ar_delete_post(p_pass text, p_id bigint)
returns boolean language plpgsql security definer
set search_path to 'public','extensions','pg_temp' as $$
begin
  if not public.ar_check_admin(p_pass) then raise exception 'not_authorized'; end if;
  delete from public.ar_posts where id = p_id;
  return true;
end $$;

create or replace function public.ar_save_photo(p_pass text, p_id bigint, p_row jsonb)
returns bigint language plpgsql security definer
set search_path to 'public','extensions','pg_temp' as $$
declare v_id bigint;
begin
  if not public.ar_check_admin(p_pass) then raise exception 'not_authorized'; end if;
  if p_id is null then
    insert into public.ar_photos (slot, url, alt, sort, active)
    values (coalesce(p_row->>'slot','album'), p_row->>'url', coalesce(p_row->>'alt',''),
            coalesce((p_row->>'sort')::int, 100), coalesce((p_row->>'active')::boolean, true))
    returning id into v_id;
  else
    update public.ar_photos set
      slot = coalesce(p_row->>'slot', slot), url = coalesce(p_row->>'url', url),
      alt  = coalesce(p_row->>'alt', alt),   sort = coalesce((p_row->>'sort')::int, sort),
      active = coalesce((p_row->>'active')::boolean, active), updated_at = now()
    where id = p_id returning id into v_id;
  end if;
  return v_id;
end $$;

create or replace function public.ar_delete_photo(p_pass text, p_id bigint)
returns boolean language plpgsql security definer
set search_path to 'public','extensions','pg_temp' as $$
begin
  if not public.ar_check_admin(p_pass) then raise exception 'not_authorized'; end if;
  delete from public.ar_photos where id = p_id;
  return true;
end $$;

create or replace function public.ar_list_orders(p_pass text)
returns setof public.ar_orders language plpgsql stable security definer
set search_path to 'public','extensions','pg_temp' as $$
begin
  if not public.ar_check_admin(p_pass) then raise exception 'not_authorized'; end if;
  return query select * from public.ar_orders
    order by (status = 'new') desc, created_at desc limit 300;
end $$;

create or replace function public.ar_set_order_status(p_pass text, p_id bigint, p_status text)
returns boolean language plpgsql security definer
set search_path to 'public','extensions','pg_temp' as $$
begin
  if not public.ar_check_admin(p_pass) then raise exception 'not_authorized'; end if;
  if p_status not in ('new','confirmed','ready','done','cancelled') then
    raise exception 'bad_status';
  end if;
  update public.ar_orders set status = p_status where id = p_id;
  return true;
end $$;

create or replace function public.ar_analytics(p_pass text)
returns jsonb language plpgsql stable security definer
set search_path to 'public','extensions','pg_temp' as $$
declare v jsonb;
begin
  if not public.ar_check_admin(p_pass) then raise exception 'not_authorized'; end if;
  select jsonb_build_object(
    'views_7d',    (select count(*) from public.ar_events
                    where type='page_view' and created_at > now() - interval '7 days'),
    'orders_7d',   (select count(*) from public.ar_orders
                    where created_at > now() - interval '7 days'),
    'revenue_7d',  (select coalesce(sum(total_cents),0) from public.ar_orders
                    where created_at > now() - interval '7 days' and status <> 'cancelled'),
    'new_orders',  (select count(*) from public.ar_orders where status='new'),
    'by_type',     (select coalesce(jsonb_object_agg(type, n),'{}'::jsonb) from (
                      select type, count(*) n from public.ar_events
                      where created_at > now() - interval '7 days' group by type) t),
    'top_items',   (select coalesce(jsonb_agg(x),'[]'::jsonb) from (
                      select i->>'name' as name, sum((i->>'qty')::int) as qty
                      from public.ar_orders o, jsonb_array_elements(o.items) i
                      where o.created_at > now() - interval '30 days'
                      group by 1 order by 2 desc limit 8) x)
  ) into v;
  return v;
end $$;

-- ═══════════════════════════════════════════════════════════════════════
-- 10. GRANTS — strip Supabase's auto-grants, then hand back only what's needed
-- ═══════════════════════════════════════════════════════════════════════
do $$
declare f text;
begin
  foreach f in array array[
    'ar_check_admin(text)',
    'ar_submit_order(jsonb)',
    'ar_log_event(jsonb)',
    'ar_save_content(text,text,jsonb)',
    'ar_save_product(text,bigint,jsonb)',
    'ar_delete_product(text,bigint)',
    'ar_save_post(text,bigint,jsonb)',
    'ar_delete_post(text,bigint)',
    'ar_save_photo(text,bigint,jsonb)',
    'ar_delete_photo(text,bigint)',
    'ar_list_orders(text)',
    'ar_set_order_status(text,bigint,text)',
    'ar_analytics(text)'
  ]
  loop
    execute 'revoke execute on function public.' || f || ' from public, authenticated';
    execute 'grant  execute on function public.' || f || ' to anon, service_role';
  end loop;
end $$;

-- ═══════════════════════════════════════════════════════════════════════
-- 11. SEED — the opening case and the first journal entries.
--     Everything here is editable in admin.html afterward.
-- ═══════════════════════════════════════════════════════════════════════
insert into public.ar_products
  (slug, name, category, blurb, detail, price_cents, unit, glyph, badge, lead_days, sort, featured)
values
 ('butter-croissant','Butter Croissant','pastry',
  'Laminated over three days. Twenty-seven layers, counted.',
  'Cultured European butter, folded into a slow-fermented dough across three days. The interior should pull apart in sheets; the exterior should shatter. If it does neither, we did not send it out.',
  525,'each','croissant',null,1,10,true),
 ('kouign-amann','Kouign-Amann','pastry',
  'Caramelized in its own sugar until the edges go to glass.',
  'A Breton pastry that is mostly an argument between butter and sugar. Baked in a ring so the sugar pools, catches, and hardens into a shell at the rim.',
  650,'each','kouign',null,1,20,true),
 ('cardamom-bun','Cardamom Bun','pastry',
  'Green cardamom, cracked the morning it is used.',
  'We buy pods, not powder, and crack them at the bench. Ground cardamom loses its oils within days — the difference is the entire point of the bun.',
  600,'each','bun',null,1,30,true),
 ('canele','Canelé de Bordeaux','pastry',
  'Copper molds, beeswax, and fifty hours of resting batter.',
  'Rum and vanilla custard poured into beeswaxed copper. Dark, almost burnt at the shell; barely set in the middle. Made in small numbers because the molds allow no more.',
  475,'each','canele','Weekends only',2,40,true),
 ('almond-tart','Brown Butter Almond Tart','tart',
  'Brown butter frangipane in a pâte sucrée shell.',
  'The butter is cooked until the milk solids toast, which is what gives the frangipane its color and its smell. Topped with sliced almonds and a thin apricot glaze.',
  4200,'whole','tart',null,3,50,false),
 ('seasonal-galette','Seasonal Galette','tart',
  'Whatever the Austin farmers are proudest of that week.',
  'Free-form, rustic, and honestly a little different every time. Ask what is in it — we will tell you exactly who grew it.',
  3800,'whole','galette','Seasonal',3,60,false),
 ('olive-oil-cake','Olive Oil & Citrus Cake','cake',
  'Peppery oil, whole citrus, a crumb that keeps for days.',
  'Made with a grassy Texas olive oil and whole blitzed citrus — peel included, for the bitterness. Improves on the second day, which is rare for cake and worth knowing.',
  5400,'whole','cake',null,3,70,false),
 ('chocolate-rye','Chocolate Rye Layer Cake','cake',
  'Dark rye flour against 70% chocolate.',
  'Rye gives chocolate somewhere to go — an earthiness that keeps the whole thing from reading as simply sweet. Three layers, ganache, flaked salt.',
  6800,'whole','cake',null,4,80,false),
 ('country-loaf','Country Loaf','bread',
  'Natural leaven, twenty-hour cold retard, baked dark.',
  'Stone-milled wheat with a little whole rye in the levain. We bake it darker than most people expect. That is where the flavor is.',
  900,'each','loaf',null,2,90,false),
 ('pastry-box','The Baker''s Dozen','pastry',
  'Thirteen pastries, our choosing, boxed for a table.',
  'The simplest way to feed a room. We pick from whatever came out best that morning — always a mix of laminated and enriched, always at least one thing you did not order on purpose.',
  6500,'dozen','box',null,2,100,true),
 ('filter-coffee','Filter Coffee','drink',
  'A single Texas-roasted origin, ground to order.',
  'One origin at a time, rotated when the bag runs out. Served black; milk is on the counter and we will not judge you for it.',
  400,'each','coffee',null,0,110,false)
on conflict (slug) do nothing;

insert into public.ar_posts (slug, title, excerpt, body, tags, read_minutes, published_at) values
 ('why-we-laminate-for-three-days',
  'Why we laminate for three days',
  'Faster lamination is possible. It is also worse, and here is exactly where it falls apart.',
  E'A croissant can be made in a day. Plenty of very good bakeries do it, and if you are baking two hundred a morning you may not have a choice.\n\nWe take three.\n\n## What the extra time actually does\n\nThe first day is the détrempe — flour, water, salt, a little yeast, and nothing else. It rests overnight so the gluten relaxes and the flour fully hydrates. A dough that has not rested fights back when you roll it, and a dough that fights back tears its butter layer.\n\nThe second day is the butter and the folds. Cultured butter, beaten flat and cold, locked into the dough and turned three times. Between each turn the dough goes back to the cold. Rushing this is the single most common way lamination fails: warm butter does not stay in a sheet, it smears into the dough, and once it has smeared there is no getting it back.\n\nThe third day is shaping and the final proof. Slow, cold, and long.\n\n## Where the shortcut shows\n\nIn the crumb. A fast croissant tends to look right and eat wrong — the layers are visible but they do not separate, because the butter went into the dough instead of staying between it. You get bread shaped like a croissant.\n\nThe test we use is simple and you can do it too. Tear one in half rather than cutting it. The interior should pull into distinct sheets that come apart with a little resistance. If it pulls like bread, something went warm somewhere.',
  '["technique","lamination"]'::jsonb, 5, now() - interval '6 days'),
 ('the-cardamom-problem',
  'The cardamom problem',
  'Ground cardamom is stale within a week of grinding. We buy pods and crack them at the bench.',
  E'Cardamom is an oil-carried spice. Almost everything you taste in it lives in volatile compounds that begin leaving the moment the seed is broken open.\n\nBuy it ground and you are buying something that was potent in a factory and is now, at best, a suggestion.\n\n## What we do instead\n\nWe buy green pods whole and crack them the morning they go into the bun filling. It is genuinely annoying. It adds twenty minutes to a prep list that has no twenty minutes in it.\n\nIt is also the entire reason the bun tastes like anything.\n\n## Try it once\n\nIf you bake at home, do this experiment exactly once and you will never go back. Buy a small tin of ground cardamom and a bag of green pods. Smell the tin. Then crack four pods, grind the black seeds inside, and smell that.\n\nThey are not the same spice. They are barely related.\n\nThe pods keep for a year in a jar. The ground tin was finished before you bought it.',
  '["ingredients","spice"]'::jsonb, 3, now() - interval '13 days'),
 ('bake-it-darker',
  'Bake it darker than feels comfortable',
  'Most home loaves come out of the oven ten minutes early. Here is how to know.',
  E'The most common fixable mistake in home bread is pulling the loaf too soon.\n\nIt makes sense. A pale golden loaf looks finished and looks safe. A dark, nearly-mahogany loaf looks like a mistake right up until you taste it.\n\n## What browning is\n\nTwo things are happening in the last fifteen minutes: caramelization of the sugars and the Maillard reaction between sugars and amino acids. Both of them are flavor being created. Stop early and that flavor was simply never made — you cannot add it back with salt.\n\n## How to actually judge it\n\nColor is a better guide than time, and sound is better than color.\n\nGo by color first: you want a deep reddish brown across the whole surface, not just the ears. Then tap the bottom. A finished loaf sounds hollow and a little sharp. An underbaked one sounds dull and dead, and no amount of resting will fix it.\n\nIf your first darker loaf feels alarming, cut it anyway. Then bake the next one two minutes longer.',
  '["technique","bread"]'::jsonb, 4, now() - interval '21 days')
on conflict (slug) do nothing;

insert into public.ar_content (section, data) values
 ('hours', '{"lines":["Wednesday – Friday · 7am – 2pm","Saturday · 7am – 3pm","Sunday · 8am – 1pm","Closed Monday & Tuesday"]}'::jsonb),
 ('contact', '{"phone":"","email":"hello@ariannabakehouse.com","address":"Austin, Texas"}'::jsonb),
 ('notice', '{"text":""}'::jsonb)
on conflict (section) do nothing;
