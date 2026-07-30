/* Arianna Bakehouse — site config.
   Leave both blank and the site runs in STATIC mode: the baked-in catalog and
   journal render, and the pre-order form falls back to a pre-filled email.
   Fill them in and the site reads live content, takes orders into the database,
   and admin.html can edit everything.

   Run supabase-setup.sql in that project's SQL editor FIRST, and change the
   admin passphrase in it before you do.  */
window.AR_CONFIG = {
  SUPA_URL: '',
  SUPA_KEY: '',
};
