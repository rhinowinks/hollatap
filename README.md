# HollaTap

Free digital business cards with QR and NFC. A Rhinowinks LLC product. Node.js (Express) + Postgres.

## What's in version 1

- **Instant Card** (`/instant`): built entirely in the browser, nothing stored. QR holds the contact itself. Downloads: QR, contact file, card image. PDF auto-fill runs on the device.
- **Accounts** with email one-time codes (no passwords), 14-day Pro trial, referral capture (`?ref=CODE`).
- **Cards**: up to 2 (Free) or 5 (Pro/Teams), 4 designs, colour matched to logo, logo re-encoded safely, custom web address, link buttons, WhatsApp button, PDF auto-fill, live preview.
- **Public card page** (`/your-name`): save contact (.vcf with logo), call/WhatsApp, "Share my details" lead capture with consent, footer on free cards, verified company and founding-member badges, views/saves counts.
- **Card modes** (Pro/Teams): scans go to Google reviews, a menu, WhatsApp or a booking page; `?view=card` always shows the card.
- **QR & share**: PNG and print-ready SVG, WhatsApp share, printing tips. **Email signature** generator.
- **Payments** (Paystack): Pro (₦25,000; founding ₦20,000 for the first 5,000 buyers until 31 Dec 2026; spots-left counter shown only in Admin), footer removal (₦5,000/card/year), Teams (₦30,000/staff/year; ₦20,000 from 50; NFC cards included from 20), NFC cards (₦15,000) and replacements (₦5,000). Webhook + callback, idempotent.
- **Referrals**: friends get 10% off their first purchase; normal users earn ₦5,000 credit; affiliates earn 20% (25% until 28 Feb 2027, 30% for 20+ paid referrals a quarter, 10% on NFC), payable after 30 days.
- **Teams**: company design lock, bulk invites (paste or CSV), claim links, verified badge after payment, remove staff (card switched off), company-email prompt, NFC delivery details.
- **NFC**: admin generates serial batches (CSV for the factory: serial + URL). Tapping an unclaimed card links it to the user's card.
- **Promotions**: targeted by industry, shown after card creation and on the dashboard, click tracking with UTM tags.
- **Plans & services** page with enquiry form (emailed to admins).
- **Admin** (`/admin`): stats, users, payments, enquiries, promotions, commissions (mark paid/void), NFC batches and orders.
- **Privacy**: delete card or whole account instantly; inactive free accounts warned at 11 months and deleted 30 days later; privacy notice and terms (drafts for legal review).
- **Security**: CSRF on every form, strict CSP (no inline scripts), rate limits on sign-in and lead forms, helmet headers, honeypot on lead form, CSV formula-injection guard.

Pricing and limits live in `src/config.js`.

Not in this version (add-ons): Google/Apple Wallet passes, scanning other people's paper cards, CRM connections, custom domains, monthly billing (March 2027), photo (non-PDF) auto-fill.

## Run locally

```
npm install
cp .env.example .env
npm run dev
```
Open http://localhost:3000. Without SMTP settings, sign-in codes print in the terminal. Without Paystack keys, checkout shows a "test payment" page (never in production).

`npm test` runs the end-to-end smoke test (18 checks).

## Deploy on Render (about 15 minutes)

1. Put this folder in a private GitHub repository (Rhinowinks account).
2. In Render, choose **New → Blueprint**, pick the repo. `render.yaml` creates the web service and Postgres database (Frankfurt).
3. When asked, fill in: `SMTP_USER` (global@hollatap.com), `SMTP_PASS` (the Zoho app-specific password), `PAYSTACK_SECRET_KEY` and `PAYSTACK_PUBLIC_KEY` (test keys first). WhatsApp is preset to +234 904 736 3235.
4. In Render → the web service → **Settings → Custom domains**, add `hollatap.com` (Render adds `www` automatically). Then at the DNS host:
   - `A` record, host `@`, value `216.24.57.1`
   - `CNAME` record, host `www`, value `hollatap.onrender.com` (your service's onrender.com address)
   - delete any `AAAA` records for hollatap.com and www
   - then click **Verify** in Render; it issues the HTTPS certificate automatically.
5. In Paystack → Settings → API keys & webhooks, set the webhook URL to `https://hollatap.com/webhooks/paystack`.
6. Email records at the DNS host (from Zoho Mail Admin → Domains → hollatap.com):
   - `TXT` host `@`: `v=spf1 include:zoho.com ~all` (use `zoho.eu`/`zoho.in` if your Zoho account is in that region; keep only one SPF record)
   - `TXT` DKIM record exactly as Zoho shows it (host like `zmail._domainkey`), then click Verify in Zoho
   - `TXT` host `_dmarc`: `v=DMARC1; p=none; rua=mailto:global@hollatap.com`
7. Sign in with global@hollatap.com: that account is the admin.

## Going live checklist

- [ ] Switch Paystack keys from test to live, and the webhook to live.
- [ ] Send one real ₦100+ test purchase and refund it.
- [ ] Test sign-in emails to Gmail, Yahoo and Outlook addresses.
- [ ] Scan a printed QR with an iPhone and an Android phone.
- [ ] Have the privacy notice and terms reviewed (DPCO / data-protection lawyer).
- [ ] Generate the first NFC batch in Admin → NFC cards and send the CSV to the supplier.
