require('dotenv').config();

const env = (k, d) => (process.env[k] !== undefined && process.env[k] !== '' ? process.env[k] : d);

const config = {
  env: env('NODE_ENV', 'development'),
  port: parseInt(env('PORT', '3000'), 10),
  baseUrl: env('BASE_URL', 'http://localhost:3000').replace(/\/$/, ''),
  brand: env('BRAND_NAME', 'HollaTap'),
  company: env('COMPANY_NAME', 'Rhinowinks LLC'),
  supportEmail: env('SUPPORT_EMAIL', 'global@hollatap.com'),
  adminEmails: env('ADMIN_EMAILS', 'global@hollatap.com').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
  whatsappNumber: env('WHATSAPP_NUMBER', ''), // e.g. 2348012345678
  sessionSecret: env('SESSION_SECRET', 'dev-only-change-me-please-0123456789'),
  databaseUrl: env('DATABASE_URL', ''),
  sqliteFile: env('SQLITE_FILE', './data/hollatap.sqlite'),
  smtp: {
    host: env('SMTP_HOST', ''),
    port: parseInt(env('SMTP_PORT', '465'), 10),
    user: env('SMTP_USER', ''),
    pass: env('SMTP_PASS', ''),
    from: env('MAIL_FROM', 'HollaTap <global@hollatap.com>'),
  },
  paystack: {
    secret: env('PAYSTACK_SECRET_KEY', ''),
    public: env('PAYSTACK_PUBLIC_KEY', ''),
  },
  google: { clientId: env('GOOGLE_CLIENT_ID', ''), clientSecret: env('GOOGLE_CLIENT_SECRET', '') },
  turnstile: { site: env('TURNSTILE_SITE_KEY', ''), secret: env('TURNSTILE_SECRET_KEY', '') },
};

config.isProd = config.env === 'production';
config.mailEnabled = !!(config.smtp.host && config.smtp.user);
config.paymentsEnabled = !!config.paystack.secret;

// Pricing in kobo-free naira (integers). Change here only.
config.pricing = {
  proAnnual: 25000,
  proFounding: 20000,
  foundingLimit: 5000,
  foundingEnds: '2026-12-31T23:59:59+01:00',
  footerRemoval: 5000,
  teamSeat: 30000,
  teamSeat50: 20000,
  teamMinSeats: 5,
  teamCardIncludedFrom: 20,
  nfcCard: 15000,
  nfcReplacement: 5000,
  friendDiscountPct: 10,
  userCredit: 5000,
  affiliatePct: 20,
  affiliateLaunchPct: 25,
  affiliateTopPct: 30,
  affiliateTopThreshold: 20,
  affiliateNfcPct: 10,
  launchEnds: '2027-02-28T23:59:59+01:00',
  trialDays: 14,
  refundWindowDays: 30,
  minPayout: 5000,
};

config.limits = {
  free: { cards: 2, links: 5, leadsPerMonth: 10 },
  pro: { cards: 5, links: 50, leadsPerMonth: 100000 },
  team: { cards: 5, links: 50, leadsPerMonth: 100000 },
};

config.googleEnabled = !!(config.google.clientId && config.google.clientSecret);
module.exports = config;
