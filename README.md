# Coins Tracker

Tracks live prices from the [Coins.ph public ticker API](https://api.pro.coins.ph/openapi/quote/v1/ticker/price) on a schedule, records each coin's all-time high/low, and lets you log real buys/sells against those coins with a live portfolio view.

**Stack:** Next.js 15 (Pages Router) · React 19 · Tailwind CSS 3 · Zod · Prisma ORM · PostgreSQL · GitHub Actions (cron)

For full architecture details, conventions, and gotchas, see **[CLAUDE.md](./CLAUDE.md)**.

---

## Deployment: Postgres, not SQLite

This app runs on **PostgreSQL**, not SQLite. Earlier in development it used SQLite for local simplicity, but that doesn't survive real deployment: Vercel's serverless functions run on an **ephemeral, read-only filesystem** (except `/tmp`, which doesn't persist between invocations, or even reliably within one), so a SQLite file written during one request can vanish before the next. There's no configuration fix for that — it's a property of the hosting model, not a settings gap — so the schema was switched to `postgresql` and stayed that way for both local dev and production, avoiding a dev/prod database mismatch.

### Setting up Postgres

1. **Get a Postgres database.** Any of these work — pick one:
   - **Vercel Postgres** (powered by Neon) — from your Vercel project dashboard: Storage tab → Create Database → Postgres. Vercel sets `DATABASE_URL` for you automatically when you connect it to your project.
   - **[Neon](https://neon.tech)** directly — free tier, generous for a personal app, supports branching (handy for a separate dev database that's still "real" Postgres).
   - **[Supabase](https://supabase.com)** — also has a free Postgres tier if you'd rather use their dashboard/tooling.
2. **Copy the connection string** into `DATABASE_URL` in your `.env` (local) and in Vercel's Environment Variables (production) — see `.env.example` for the format. Local and production can point at different databases (e.g. a Neon branch for dev, the main branch for prod), or the same one if you don't mind sharing data — your call.
3. **Run migrations**: `npx prisma migrate dev --name init` locally creates the schema on whichever database `DATABASE_URL` points to. In production, the build command (`prisma migrate deploy`, already wired into `npm run build`) applies migrations automatically on deploy.
4. That's it — no ongoing SQLite-specific maintenance, no file to worry about persisting.

If you're self-hosting on a normal long-running Node server (not serverless) instead of Vercel, a real Postgres instance is still the simplest correct choice — the schema is already set up for it either way.

---

## Getting Started

```bash
npm install
cp .env.example .env      # then set DATABASE_URL (Postgres — see above) / CRON_SECRET / AUTH_* as needed
npx prisma migrate dev --name init
npm run db:seed           # optional: pre-populate the monitored coin list
npm run dev
```

Visit `http://localhost:3000`.

> **This round**: switched from SQLite to PostgreSQL (see § Deployment: Postgres, not SQLite above) — `datasource db { provider }` in `prisma/schema.prisma` is now `postgresql`. If you have an existing SQLite `prisma/dev.db` you want to keep, you'll need to manually migrate that data over; there's no automated SQLite→Postgres data migration in this repo, only the schema change itself. A fresh `npx prisma migrate dev --name init` against a new Postgres database is the expected path for continuing local development.

To manually trigger the cron logic from the command line:

```bash
curl "http://localhost:3000/api/cron" -H "Authorization: Bearer $CRON_SECRET"
```

## Tracking Currency: PHP, not USDT

Every price on this app — Home, Calendar, Chart, cron-recorded highs/lows — is a **PHP-quoted** price (e.g. `BTCPHP`), not a USDT/USD-equivalent one. `DEFAULT_SEED_COINS` in `src/lib/coinsApi.ts` uses PHP pairs, and Manage Coins nudges you toward the `...PHP` symbol when searching.

**If you added a coin before this change** (as a `...USDT` pair), its price history was recorded in USDT terms — mixing that with PHP going forward would make the high/low numbers meaningless. The clean fix: remove it from Manage Coins and re-add it using its PHP-suffixed symbol (search for the coin, pick the result ending in `PHP`). Note this deletes that coin's `Record`/`Transaction`/target history (removing a coin cascades), so only do this if you don't need the old data — otherwise leave the old USDT-tracked coin as historical reference and add a fresh PHP-tracked one alongside it.

## Data Storage: Only New Daily Highs/Lows Are Kept

The cron job still checks every monitored coin's price on every scheduled run, but it only writes a new `Record` row when that price is a new high or low **for that calendar day** (or the coin's first-ever observation) — a price that falls in the middle of today's already-established range is used to keep the all-time high/low comparison accurate, but isn't persisted. In practice this means most coins get 1–3 rows/day instead of one per cron run, matching what the Calendar page already only cares about (each day's high/low, not every snapshot).

One real tradeoff worth knowing: Home's "Current Price" is drawn from the latest **stored** `Record`, so on a run where nothing new happens, it shows the last stored extreme rather than that exact instant's live price. Accepted deliberately to cap storage growth.

## Correcting a Wrong Manual Price Entry

Typed the wrong price yesterday (or earlier today)? Click the coin's name on Home to open the price-update modal — below the "new price" input, there's a **Recent manual entries** list showing that coin's last 10 manually-entered prices with an **Edit** button per row.

This only applies to manually-entered prices (the ones you typed, not ones the cron job fetched live) — correcting a live-fetched price doesn't make sense the same way, since that value came from the exchange, not a keyboard.

One thing happening behind the scenes worth knowing: correcting an old entry doesn't just fix that one row. Every record for that coin carries forward a running high/low from whatever came before it, so a wrong price from three days ago could have thrown off the running high/low for every entry since. Saving a correction recalculates that chain forward automatically, so "Recorded High/Low" on Home and Calendar's daily figures stay accurate — not just the number you actually fixed.

## Data Retention

Price-history rows (`Record` — the cron snapshots behind Home/Calendar/Chart) older than **5 years** are automatically deleted, pruned at the end of every cron run. Given the storage cap above, this is even less of an urgent concern than it already was — but unbounded growth is still worth avoiding over a long enough timeline, and 5 years is a generous window that shouldn't affect normal use of the Calendar/Chart history pages (and matches the Chart page's max 5-year range selector).

**Your buy/sell history (`Transaction`) is never pruned** — that's financial record-keeping, kept forever regardless of this setting. Journal entries (`JournalEntry`) are never pruned either, for the same reason: your own written notes, not disposable data.

**Market Signals (`NewsItem`) have a shorter, separate window: 1 month** (`NEWS_RETENTION_DAYS`), also pruned at the end of every cron run. Signals/articles are timely by nature — unlike price history, they're not useful reference material long after the fact, and unlike `Record`, their volume isn't capped by a fixed schedule (a consistently newsworthy coin could otherwise accumulate rows indefinitely).

If you want different windows, change `RECORD_RETENTION_DAYS` or `NEWS_RETENTION_DAYS` in `src/lib/retention.ts`.

## Feature Tour

- **Home** (`/`, public) — price table in PHP (Current Price with a ▲/▼ direction arrow, Recorded High/Low, Target High/Low, read-only), last-cron-run status banner, a dismissible banner when any coin hits its target, a modal that appears when a cron run sets a new all-time high/low, and a **Market Signals** section showing auto-generated bullish/bearish signals (see § News/Signals below — these are computed, not scraped news). When logged in, click a coin's name to open a small modal, set its price manually (for coins with no live ticker feed), and — in the same modal — see and correct any of that coin's recent manual entries if one was typed wrong. Logged out, that cell is plain text, nothing to click.
- **Calendar** (`/calendar`, public) — the first monitored coin is pre-selected (no blank "select a coin" step); daily high/low in a month grid.
- **Chart** (`/chart`, public) — line graph of a coin's price history: pick the coin, a range of 1–5 years, and weekly/monthly/yearly bucketing. Shows the period's high (green) and low (red). A right-hand sidebar shows/lets you log journal entries (events/notes tied to a date, optionally to a coin) — entries land on the chart as dashed 📓 markers when their date falls in a visible bucket.
- **Buy / Sell** (`/trade`, login required) — record a buy or sell by entering the PHP amount and number of coins directly (no per-unit price field — see § Buy/Sell below for why); edit or remove any logged transaction; a 4-column portfolio view (Holdings, Total Spent, Current Value, Gain/Loss).
- **Manage Coins** (`/manage`, login required) — search the full Coins.ph symbol list and add/remove monitored coins, or type an exact symbol directly (with an optional starting price) if it doesn't turn up in search; set each coin's target high/low.
- **Login** (`/login`) — single-user session login gating Buy/Sell, Manage Coins, and Home's manual price-update control.

## Buy/Sell: Amount + Coins, Not a Price Field

`/trade` never asks for a per-unit price — every buy/sell entry (and every correction to one) is entered as the PHP amount spent/received plus the number of coins, and the price shown anywhere is derived from those two (`phpAmount / coinAmount`). This was a deliberate choice: the exact execution price isn't always known precisely, and letting it be edited independently of the amount/quantity you actually know for certain let the numbers drift out of sync with each other.

Portfolio math was simplified to match — 4 columns, not a full average-cost/realized-vs-unrealized breakdown:
- **Holdings** — net coins held (buys minus sells)
- **Total Spent** — net PHP still invested (buy cost minus sell proceeds)
- **Current Value** — live price × holdings
- **Gain/Loss** — Current Value − Total Spent

Above the per-coin table, two summary figures roll up across every coin: **Total Spent** (a straight sum) and **Total Gain/Loss** (sums only the coins whose live price lookup succeeded that request — if one fails, it's excluded and called out rather than silently counted as zero, which would skew the total).

**Current Value for manually-tracked coins**: if a coin has no live ticker pair (added via Manage Coins' "Add a coin manually" flow — e.g. one with no PHP trading pair), the portfolio falls back to that coin's stored price — the same one Home's "Current Price" column shows, and the same one you can set via Home's click-to-edit price modal. Without a price set there, Current Value/Gain-Loss show "—" for that coin; once you set one, the portfolio picks it up automatically.


See `CLAUDE.md` for how each of these is wired up (models, API routes, key design decisions).

## Chart & Line Graph Data

The `/chart` page reads from the same `Record` table the cron job writes to — no separate data source. A key distinction from Home's "Recorded High/Low": those are the **cumulative all-time** high/low (each `Record` row carries the prior max/min forward), while the chart's high/low is the **actual price range observed within each bucket** (that week/month/year's own peak and trough price). Cumulative all-time values would just show a slowly-changing staircase on a chart; period-actual ranges show real movement.

- **Range**: 1–5 years — capped at 5 to match the `Record` retention window (see § Data Retention), so you're never offered a range with data that's already been pruned.
- **Granularity**: weekly (bucketed by the Monday starting that week), monthly, or yearly — computed in `src/lib/chartBucket.ts`, shared between the API route and the client so journal entries align to the same buckets the chart uses.
- Built with **recharts** (`ChartView.tsx` → `PriceLineChart.tsx`), loaded via `next/dynamic(..., { ssr: false })` since its `ResponsiveContainer` needs real DOM measurements.

## Journal

A right-sidebar form on the Chart page lets you log a dated note — optionally tied to a specific coin, or left general (shows up regardless of which coin's chart is open). Entries within the chart's visible date range show in the sidebar list, and as dashed vertical markers on the chart itself when their date falls into a bucket that's actually rendered.

- Model: `JournalEntry` (`entryDate`, `title`, `notes`, optional `coinId`).
- Viewing is public; adding/deleting requires login (`POST`/`DELETE /api/journal`).
- **Never touched by retention** — this is your own record-keeping, kept forever like `Transaction`.

## News / Market Signals

⚠️ **Read this before assuming it's all curated journalism.** Two sources feed this section, both landing in the same feed but clearly distinguishable by their `source` field:

1. **Heuristic signals** (always on, no setup) — after each cron run prices a coin, `src/lib/newsApi.ts` computes a bullish/bearish signal from that run's own price movement (a new recorded high/low, or a ≥2% move since the last check-in) and saves it with `source: "System"`. Not a scraped article, never fabricates a headline attributed to a real outlet.
2. **Real articles via free RSS** (always on, no setup, no API key) — each cron run also pulls from free public RSS feeds (Cointelegraph, CryptoSlate, NewsBTC), matches articles mentioning each monitored coin by name/symbol, and classifies sentiment with a plain keyword heuristic (counts bullish vs. bearish terms — not NLP/ML, and the article's summary says so). This is the real-article source and needs zero configuration.

- Triggers via cron — the scheduled `/api/cron` fetches the RSS feeds once per run (not once per coin — matched against every coin from that single pull) and generates both news sources as part of the same pass that fetches prices. A feed hiccup is logged but never fails the cron run itself — it's enrichment, not core functionality.
- **Grouped by run**: the feed shows a divider between each cron run's batch of signals/articles, so you can tell "this is from the latest run, this is from the one before." Ordered by which run produced them, not by article publish date (a real article can be older than when this app happened to fetch it).
- **Paginated**: loads 15 at a time with a "Load more" button, rather than the whole history at once.
- **Retention**: signals/articles older than 1 month are automatically pruned (shorter than the 5-year window for price history — see § Data Retention below for why).

## Cron Schedule & Timezone

GitHub Actions schedules run in **UTC**. Since this app targets Philippine time (UTC+8), the 5-field cron expression in `.github/workflows/cron.yml` is `0 2,6,11,14,18,23 * * *` — those UTC hours land at **7:00, 10:00, 14:00, 19:00, 22:00, and 2:00 Philippine time**. If you're deploying for a different timezone, recompute the offsets before reusing the file as-is.

This app doesn't use Vercel's own Cron feature (`vercel.json` was removed) — **GitHub Actions is the sole scheduler**, which has the advantage of working on any Vercel plan (Vercel's Hobby plan only allows daily cron jobs; 6x/day would otherwise need Pro).

A ready-to-use workflow is included at `.github/workflows/cron.yml`. It calls `GET /api/cron` on that schedule, with the `Authorization: Bearer <CRON_SECRET>` header the endpoint expects.

1. **Push this repo to GitHub** (if it isn't already).
2. **Add two repository secrets** — go to your repo → **Settings → Secrets and variables → Actions → New repository secret**:
   - `CRON_SECRET` — the same value you set as `CRON_SECRET` in your deployment's environment variables.
   - `APP_URL` — your deployed app's base URL, no trailing slash (e.g. `https://your-app.vercel.app`).
3. **Confirm the workflow file is on your default branch** (`main`/`master`) — GitHub only runs scheduled workflows from the default branch.
4. That's it. GitHub will start running it on the schedule in the file. To confirm it's wired up correctly without waiting for the next scheduled time: go to your repo → **Actions** tab → **Trigger price cron** (left sidebar) → **Run workflow** button (this uses the `workflow_dispatch` trigger already included in the file) → check the run's logs for the HTTP status and response body.

A couple of things worth knowing about GitHub Actions schedules: they're **best-effort, not exact** — GitHub documents delays of several minutes during high load, and disables schedules on repos with no activity for 60 days (any push/commit resets that). Fine for this use case; not fine if you need second-precision timing.

## Deploying to Vercel

1. **Push this repo to GitHub** — needs to be GitHub specifically (not GitLab/Bitbucket) so the `.github/workflows/cron.yml` Action can run; Vercel itself can still import from any of the three.
2. Import the repo in Vercel.
3. Set environment variables in Vercel: `DATABASE_URL` (Postgres — see § Deployment: Postgres, not SQLite above), `CRON_SECRET`, `AUTH_USERNAME`, `AUTH_PASSWORD`, `AUTH_SECRET` (generate with `openssl rand -hex 32`).
4. The build command already runs migrations: `prisma generate && prisma migrate deploy && next build`.
5. Set up the GitHub Actions cron trigger (see § Cron Schedule & Timezone above) — add `CRON_SECRET` and `APP_URL` as repository secrets. This app doesn't use Vercel's own Cron feature (no `vercel.json`); GitHub Actions is the sole scheduler, which works on any Vercel plan including Hobby.

## Code Standards

- TypeScript strict mode throughout.
- Zod schemas validate all API query params, bodies, and response shapes at the boundary.
- Business logic lives in `/lib` (server) and `/features/*/use*Logic.ts` hooks (client), kept separate from presentational components.
- Tailwind utility classes only — no inline styles.
- `Layout` renders once in `_app.tsx` (not per-page) so client-side navigation doesn't remount the nav/auth state — see CLAUDE.md § Known Gotchas if you're adding a new page.
