/* Ariana Bakehouse — site config.

   These two values are PUBLIC by design. The publishable key ships in every
   page load; it is not a secret. What actually protects the data is the
   database itself: public tables are read-only to anon with zero write
   policies, ar_orders and ar_events have no select policy at all, and every
   write goes through a security-definer RPC. See supabase-setup.sql.

   Never put a service_role / sb_secret_ key in this file. It bypasses all of
   the above and would be handed to every visitor.

   Leave both blank to run in STATIC mode: the baked-in catalog and journal
   render, and the pre-order form falls back to a pre-filled email. */
window.AR_CONFIG = {
  BUILD: 'v2026.07.31-1610',
  SUPA_URL: 'https://unfjnmrjmidrfmmtyhpe.supabase.co',
  SUPA_KEY: 'sb_publishable_vRef972pow7wEIjE-PCANg_zx2OShFA',
};
