# Lens By Lyssa: going live

This takes about an hour the first time (Google Calendar is optional and can come later). The monthly cost is $0 (Netlify free plan). Stripe charges only when someone pays, about 2.9% + 30¢ per payment.

## Before you start

You'll need:
- A **GitHub** account (free), for storing the code
- A **Netlify** account (free), for hosting the site. Sign up with GitHub.
- A **Stripe** account, for payments. You'll need Lyssa's bank account and SSN/EIN to activate it.
- *(Optional)* Lyssa's **Google account**, to connect her calendar
- *(Optional)* A domain like `lensbylyssa.com`, about $12/yr

## What's in here

```
public/index.html          the website
public/admin/index.html    the admin panel (yoursite.com/admin)
netlify/functions/         the small backend: content, photos, inbox, Stripe checkout + webhook
content.default.json       starting text/prices (only used until Lyssa saves in the admin)
src/ + tools/build.py      source files; edit these, then run `python3 tools/build.py`
test/                      `npm test` (backend tests) and `npm run dev` (local preview)
```

Everything Lyssa edits (text, photos, prices, mini sessions, inbox) is stored in **Netlify Blobs**, which comes free with every Netlify site and needs no setup.

## 1. Put the code on GitHub

```bash
cd lens-by-lyssa
git init && git add . && git commit -m "Lens By Lyssa site"
# create an empty private repo on github.com, then:
git remote add origin https://github.com/<you>/lens-by-lyssa.git
git push -u origin main
```

## 2. Create the Netlify site

1. Go to netlify.com, then **Add new site → Import an existing project → GitHub**, and pick the repo.
2. Leave the build command **blank**. `netlify.toml` already sets the publish folder (`public`) and functions folder, and Netlify runs `npm install` automatically.
3. Deploy. The site will load right away with sample content.

## 3. Add the environment variables

Go to **Site configuration → Environment variables** and add these, then **redeploy** (Deploys → Trigger deploy):

| Name | Value |
|---|---|
| `ADMIN_PASSWORD` | Lyssa's admin password. Make it long. |
| `SESSION_SECRET` | Any long random string (e.g. run `openssl rand -hex 32`). |
| `STRIPE_SECRET_KEY` | From Stripe (step 4). Start with the `sk_test_…` key. |
| `STRIPE_WEBHOOK_SECRET` | From Stripe (step 4), starts with `whsec_…`. |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` *(calendar)* | From step 5. |
| `GOOGLE_PRIVATE_KEY` *(calendar)* | From step 5: the whole `-----BEGIN PRIVATE KEY-----…` value. |
| `GOOGLE_CALENDAR_ID` *(calendar)* | Lyssa's calendar ID, usually her Gmail address. |
| `TIMEZONE` *(optional)* | Defaults to `America/Denver`. |
| `RESEND_API_KEY` *(optional)* | Emails Lyssa when a booking note or payment comes in. |
| `NOTIFY_EMAIL` *(optional)* | Where those emails go (her email). |
| `NOTIFY_FROM` *(optional)* | e.g. `Lens By Lyssa <hello@lensbylyssa.com>` once the domain is verified in Resend. |

Then open `https://<your-site>/admin`, sign in, and start editing.

## 4. Set up Stripe

1. Create an account at stripe.com. Set the **business name to Lens By Lyssa** (it appears on the checkout page) and add a logo and brand color under Settings → Branding.
2. In **Developers → API keys**, copy the **Secret key** into `STRIPE_SECRET_KEY`.
3. In **Developers → Webhooks → Add endpoint**:
   - URL: `https://<your-site>/api/stripe-webhook`
   - Events: `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.expired`, `invoice.paid`
   - Copy the **Signing secret** into `STRIPE_WEBHOOK_SECRET`, then redeploy.
4. Under **Settings → Emails**, turn on "Successful payments" so clients get receipts. Stripe also emails Lyssa about each payment.
5. **Test it:** while in test mode, book a mini on the live site using card `4242 4242 4242 4242` with any future date and any CVC. You should see the payment in the admin Inbox and the time turn "booked!" on the site.
6. **Go live:** activate the Stripe account, switch to **live** mode, and repeat steps 2–3 with the live key and a live webhook (it gets its own signing secret). Update both environment variables and redeploy.

## 5. Connect Google Calendar (about 15 minutes)

When this is set up, every booking goes on Lyssa's calendar. Bookings waiting for payment show in **yellow** with "[Awaiting payment]", bookings with a deposit paid show in **orange**, and fully paid ones show in **green**. Busy times on her calendar are also hidden from mini-session time slots.

1. Go to console.cloud.google.com, create a project (e.g. "Lens By Lyssa"), then open **APIs & Services → Library**, search **Google Calendar API**, and click **Enable**.
2. Go to **IAM & Admin → Service Accounts → Create service account** (name it `lens-by-lyssa-site`). You don't need any roles.
3. Open the service account, then **Keys → Add key → Create new key → JSON**. A file downloads.
4. From that file, copy `client_email` into `GOOGLE_SERVICE_ACCOUNT_EMAIL` and `private_key` into `GOOGLE_PRIVATE_KEY`. Paste it exactly as-is: the `\n` characters are fine.
5. In **Google Calendar** (as Lyssa), open **Settings → her calendar → Share with specific people → Add people**. Paste the service account email and choose **Make changes to events**.
6. On the same settings page under **Integrate calendar**, copy the **Calendar ID** (for her main calendar it's her Gmail address) into `GOOGLE_CALENDAR_ID`. Then redeploy.
7. In the admin, go to **Business info → Google Calendar** and press **Send a test event**. It should say "Test worked!"

Tips for Lyssa:
- **Blocking whole days:** timed events on her calendar (dentist, school pickup) automatically hide overlapping mini times. All-day events and events marked **"Free"** don't block anything, so a "Pumpkin minis" all-day reminder won't block her own mini day.
- **Mini times she's already booked:** she doesn't need to add these to her calendar herself. The site does it.
- **Invites:** the site adds events to *her* calendar only. It doesn't send calendar invites to clients (Google requires a Workspace account for that). Clients get Stripe's receipt email instead.

## 6. Custom domain (optional, ~$12/yr)

Go to **Domain management → Add a domain** in Netlify (e.g. `lensbylyssa.com`). HTTPS is automatic.

## How booking works (message first)

1. A client likes a package, taps **Message me to book**, and sends the note. It lands in the admin **Inbox**.
2. Lyssa agrees on a date and time with them (text, email, DM).
3. In the Inbox she presses **Schedule & send pay link** (or **+ New booking** under Bookings). She sets the date, time, location, full price or deposit, and optionally a "pay by" date and a personal note, then presses create.
4. She taps **Copy message with link** and texts or emails it. The message wording is editable under Bookings.
5. The link opens the client's own **invoice page** on the site: invoice number (LBL-1001, …), session details, what's due, her note and terms, a **Pay securely** button (Stripe Checkout) and **Save as PDF**. The link is private: it contains a long random ID and isn't listed anywhere.
6. After paying, the page shows a PAID stamp. The booking turns **Paid**, the calendar event turns green, and the payment shows in the Inbox.

**Deposits:** if she picks "Deposit to hold the date", the invoice asks for the deposit first. After it's paid the booking turns orange (**Deposit paid**) and the same link now asks for the balance. She just re-sends it before the session.

**Stripe-emailed invoice (optional):** on any unpaid booking she can press **Email a Stripe invoice instead**. Stripe emails the client an official invoice (with a Stripe-hosted pay page and PDF). Stripe charges 0.4% per paid invoice on top of card fees, so the site invoice page is the default. Whichever way the client pays, the other one is cancelled automatically so nobody pays twice. Her logo and colours on Stripe invoices come from Stripe **Settings → Branding**.

**Cash or Venmo:** **Mark $… paid** records the payment on the invoice so the balance is still correct.

The invoice heading, default days to pay, thank-you note and terms are all under **Bookings → Invoice settings**.

This can be changed in the admin:
- **Prices & payments → How people book:** switch to "they can pay right away" if she ever wants instant booking.
- **Mini sessions:** choose "pay right away" (default, since mini times are fixed) or "they request it and I send a pay link".
- **The "before you book" notes:** she can edit or turn off the note above the price tags and the one on the Minis page.

## Go-live checklist

- [ ] Site deploys on Netlify and loads
- [ ] `ADMIN_PASSWORD` and `SESSION_SECRET` set; you can sign in at `/admin`
- [ ] Stripe test mode works: create a booking in the admin, open its invoice link, pay with `4242 4242 4242 4242`, and see it turn **Paid**
- [ ] Webhook has all 4 events, including `invoice.paid`
- [ ] Stripe switched to **live** keys, with a new live webhook and secret, then redeployed
- [ ] *(Optional)* Google Calendar "Send a test event" works
- [ ] *(Optional)* Custom domain connected
- [ ] Lyssa replaced the sample photos, stories and pricing subtitle in the admin

## How it works

- **Prices can't be tampered with.** The browser only sends *which* package or slot was picked. The server looks up the price in the saved content and builds the Stripe checkout itself.
- **Mini time slots** are held for 31 minutes while someone is in checkout. When Stripe confirms payment, the slot is booked automatically. If two people somehow pay for the same slot, the second payment is flagged "double-booked" in the Inbox so she can reschedule or refund.
- **Refunds** are done in the Stripe dashboard. After refunding a mini, press "Free up this time slot" on that payment in the Inbox.
- **Photos** are resized in the browser (max 2200px) before upload and served with long cache headers.
- **Admin sign-in** uses a signed token that lasts 14 days. Changing `SESSION_SECRET` signs everyone out.

## Working on it locally

```bash
npm install
npm test          # 30 backend tests (in-memory storage, fake Stripe)
npm run dev       # http://localhost:8787, admin at /admin, password: pumpkin123
                  # fake Stripe: "paying" goes to /__dev/pay, which fires the webhook for you
```

To change the design, edit `src/site.html`, `src/site.css`, `src/admin.html` or `src/shared.js`, run `python3 tools/build.py`, and commit the updated `public/` folder.
