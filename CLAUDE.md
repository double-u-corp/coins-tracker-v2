# CLAUDE.md — Coins Tracker Reference

This file is the technical reference for this codebase — architecture, data model, conventions, and known gotchas. Read this before making non-trivial changes; it captures decisions that aren't obvious from the code alone.

## What this app is

A personal crypto tracker built on the [Coins.ph public ticker API](https://api.pro.coins.ph/openapi/quote/v1/ticker/price) (`api.pro.coins.ph`, no API key required). It does four things:

1. **Tracks prices on a schedule** (cron), recording each monitored coin's price and running all-time high/low.
2. **Logs real buys/sells** the user makes, converted to PHP, with a live portfolio view (holdings, cost basis, gain/loss).
3. **Visualizes price history** as a line chart (weekly/monthly/yearly, 1–5 years), with a journal for dated notes/events alongside it.
4. **Surfaces bullish/bearish signals** on Home — from price movement and free RSS news, both always on with zero configuration (see § News / Market Signals).

Single-user, no signup flow, minimal auth. Not built for multi-tenant or public use.

## Stack

Next.js 15 (**Pages Router**, not App Router) · React 19 · Tailwind CSS 3 · Zod 3 · Prisma ORM 6 · PostgreSQL · GitHub Actions (cron) · Recharts (price chart) · fast-xml-parser (RSS news feeds).

## Folder structure

```
/src
  /pages
    index.tsx            # Home — public
    calendar.tsx          # Calendar — public
    chart.tsx               # Chart (line graph + journal sidebar) — public; replaces the old Grid page
    trade.tsx                 # Buy/Sell — login required (getServerSideProps guard)
    manage.tsx                  # Manage Coins — login required (getServerSideProps guard)
    login.tsx                     # Login form
    _app.tsx                        # Wraps every page in <Layout> ONCE — see Gotcha #1
    _document.tsx
    /api
      cron.ts                         # Scheduled cron — CRON_SECRET bearer auth
      cron-manual.ts                    # "Run Cron Now" button — session-cookie auth
      coins.ts                            # GET summary/calendar/chart/alerts; POST add coin; DELETE remove coin
      available-coins.ts                    # GET — search all Coins.ph symbols (session-cookie auth)
      transactions.ts                         # GET list+portfolio; POST buy/sell; PATCH correct; DELETE (session-cookie auth)
      targets.ts                                # POST — set a coin's target high/low (no auth — see Gotcha #4)
      records.ts                                  # POST — set a coin's starting price, no live fetch (session-cookie auth)
      journal.ts                                    # GET list; POST create; DELETE (session-cookie auth on writes)
      news.ts                                         # GET — list auto-generated signals (no auth)
      /auth
        login.ts / logout.ts / me.ts                # Session cookie lifecycle
  /features                    # UI component + logic hook per page, one folder each:
    /home     — HomeTable.tsx, NewRecordModal.tsx, NewsSection.tsx, useHomeLogic.ts, useNewsLogic.ts
    /calendar — CalendarView.tsx, useCalendarLogic.ts
    /chart    — ChartView.tsx, PriceLineChart.tsx (recharts, dynamic-imported ssr:false),
                JournalForm.tsx, JournalSidebar.tsx, useChartLogic.ts
    /trade    — TradeView.tsx, useTradeLogic.ts       (buy AND sell — one page, one toggle)
    /manage   — ManageCoinsView.tsx, useManageCoinsLogic.ts
    /auth     — LoginForm.tsx, useAuth.ts
  /components      # Shared UI: AlertBanner (dismissible), Dropdown, Modal (no backdrop-close),
                     Layout (nav + hamburger), TargetEditor (inline number input, save-on-blur)
  /lib             # Server logic: prisma.ts, coinsApi.ts (Coins.ph fetcher), cronLogic.ts, auth.ts,
                     # retention.ts, newsApi.ts (heuristic signals + free RSS news, see § News / Market Signals)
                     # + format.ts (shared formatPhp/formatCoinAmount) + chartBucket.ts (isomorphic —
                     # imported by both the chart API route and the client, see Key design decisions)
  /validators      # Zod schemas: coinSchema, recordSchema (+ chart point shape), transactionSchema,
                     # authSchema, journalSchema, newsSchema
  /styles          # Tailwind globals + theme overrides
/prisma
  schema.prisma    # Coin, Record, Transaction, PriceTarget, CronLog, JournalEntry, NewsItem
  seed.ts          # Seeds DEFAULT_SEED_COINS on a brand-new DB only
.github/workflows/cron.yml   # GitHub Actions — sole cron trigger (see § Cron)
```

## Data model (`prisma/schema.prisma`)

- **`Coin`** — one row per monitored coin (`symbol` unique, e.g. `BTCPHP`). The `Coin` table itself IS the monitored list — the cron job just does `prisma.coin.findMany()`. Adding/removing a coin from Manage Coins is the only way to change what's tracked; there's no hardcoded list in code (`DEFAULT_SEED_COINS` in `coinsApi.ts` only seeds a brand-new empty DB).
- **`Record`** — one row per price observation from a cron run. Carries the running `high`/`low` at that point, `isNewHigh`/`isNewLow` flags (only true if there was a prior record to beat), and `cronLogId` linking it to the run that produced it.
- **`Transaction`** — one row per buy or sell (`type: "buy" | "sell"`). Buys store `phpAmount` spent; sells store `phpAmount` received. `coinAmount` is always positive; direction comes from `type`, not sign. `isManual` flags a historically-logged or user-corrected trade (no live lookup involved).
- **`PriceTarget`** — one row per coin (unique `coinId`), holding optional `targetHigh`/`targetLow`. Edited from Manage Coins; displayed read-only on Home.
- **`CronLog`** — one row per cron execution (`status: "success" | "partial" | "error"`), with `Record[]` and `NewsItem[]` back-relations. Drives the "last cron run" banner and the new-record alert lookup.
- **`JournalEntry`** — a user-authored note about a date (`entryDate`, `title`, `notes`), optionally tied to a coin (`coinId` nullable — null means a general/market-wide entry, shown regardless of which coin's chart is open). Never pruned by retention; user content, kept forever.
- **`NewsItem`** — a signal about a coin, from one of two sources (see § News / Market Signals): a computed price-movement heuristic (`source: "System"`, `externalId: null`), or a real RSS-sourced article (`source`: the outlet name, e.g. "Cointelegraph"; `externalId`: `"rss:" + link`, used to dedupe re-fetched articles across runs via upsert). Tied to a coin and the `CronLog` run that produced/last-touched it.

## Auth model (`src/lib/auth.ts`)

Deliberately minimal — single username/password from `AUTH_USERNAME`/`AUTH_PASSWORD` env vars, no user table. On login, a signed (HMAC-SHA256 via `AUTH_SECRET`) session token is set as an `httpOnly` cookie (7-day expiry, no server-side session store — verification is just re-checking the signature + expiry).

- **Server-side page guard**: `requireAuthSSR(context)` in `getServerSideProps`, used by `/trade` and `/manage` — redirects to `/login?redirect=<path>` before any protected content renders (no client-side flash).
- **API guard**: `isAuthenticatedRequest(req)`, checked inside route handlers for `POST/DELETE /api/coins`, `/api/transactions`, `/api/cron-manual`, `/api/available-coins`, and `POST/DELETE /api/journal` (reading journal/news stays public, matching the rest of the app's read-public/write-gated pattern).
- **Client hook**: `useAuth()` (`features/auth/useAuth.ts`) fetches `/api/auth/me` once (on `Layout` mount — see Gotcha #1), used to conditionally show the Buy/Sell + Manage Coins nav links and the Home page's "Run Cron Now" button.
- This is NOT hardened for public deployment: no rate limiting, no lockout, no CSRF token (relies on `SameSite=Lax`). Fine for personal/private use.

## API reference

| Route | Methods | Auth | Purpose |
|---|---|---|---|
| `/api/cron` | GET/POST | `CRON_SECRET` bearer | Scheduled entry point (GitHub Actions calls this) |
| `/api/cron-manual` | POST | session | "Run Cron Now" button |
| `/api/coins` | GET | none | `?type=` unset (summary+targets), `calendar`, `chart`, `alerts` |
| `/api/coins` | POST/DELETE | session | Add/remove a monitored coin |
| `/api/available-coins` | GET | session | Search all Coins.ph symbols (dedup'd, see Gotcha #3) |
| `/api/transactions` | GET | session | List transactions + computed portfolio |
| `/api/transactions` | POST | session | Record a buy or sell (live or manual) |
| `/api/transactions` | PATCH | session | Correct an existing entry's coin amount/price |
| `/api/transactions` | DELETE | session | Remove a transaction |
| `/api/targets` | POST | **none** | Set a coin's target high/low (see Gotcha #4) |
| `/api/records` | POST | session | Set a coin's starting price, no live fetch — see Gotcha #9 |
| `/api/journal` | GET | none | List entries, optional `symbol`/`from`/`to` filters |
| `/api/journal` | POST/DELETE | session | Create/remove an entry |
| `/api/news` | GET | none | List signals, cursor-paginated, optional `symbol`/`limit`/`cursor` |
| `/api/auth/login` \| `logout` \| `me` | POST/POST/GET | — | Session lifecycle |

## Key design decisions

- **PHP-first tracking**: monitored coins are PHP-quoted pairs (`BTCPHP`, not `BTCUSDT`) — the whole app tracks peso prices directly, since that's what the person using this cares about, not a USD-equivalent. `coinsApi.ts` → `toPhpSymbol()` still exists as a safety net for `/trade`: if a coin was ever added with a non-PHP symbol, it derives the PHP pair for transaction pricing rather than transacting in the wrong currency. All price displays across Home/Calendar/Manage/Trade go through `src/lib/format.ts` → `formatPhp()` (peso currency formatting) — except Manage Coins' *search results* list, which shows raw numbers since search results can be any quote asset (USDT, BTC, etc.), not just PHP.
- **Adding a coin — search or manual, same underlying flow**: `POST /api/coins` doesn't require the symbol to have come from `/api/available-coins` first — Manage Coins has both a search-and-pick flow and a manual "type the exact symbol" form (for coins that don't surface in the bulk ticker search, e.g. `TXPHP`), and both call the same `addCoin()` → same endpoint. The endpoint never attempts a live price check (see Gotcha #9) — manual add exists specifically for coins the live ticker can't reach, so `POST /api/records` (a separate, no-fetch endpoint) lets you set a starting price right after adding, re-runnable anytime to update it again.
- **Record retention**: `src/lib/retention.ts` deletes `Record` rows older than `RECORD_RETENTION_DAYS` (5 years), called at the end of every `runCronJob()` — cheap enough to run unconditionally rather than needing its own schedule. Crucially, it always keeps each coin's single most recent row regardless of age (via a `groupBy` on `coinId` for `MAX(id)`, excluded from the delete) — a coin's running high/low lives in whatever its newest `Record` is, so pruning that away would silently erase it for any coin that's gone quiet. `Transaction` rows are never pruned — that's financial history, not disposable price-snapshot noise, and the two are deliberately kept on separate retention policies (in practice, no policy at all for `Transaction`).
- **Chart high/low ≠ Home's Recorded High/Low**: `Record.high`/`Record.low` are *cumulative all-time* values (each new row carries the prior max/min forward — that's what Home displays). The chart needs something different: the actual price range *within each bucket* (that week/month/year's own peak and trough), computed fresh in `handleChart` (`/api/coins`) from the raw `price` field, not from `Record.high`/`Record.low`. Plotting the cumulative values on a chart would just show a slowly-changing staircase, not real movement — this distinction is easy to get backwards if you're not careful, so it's called out explicitly in both the API handler and `ChartView.tsx`'s caption text.
- **`chartBucketKey` is isomorphic on purpose**: it lives in `src/lib/chartBucket.ts` with zero DB/Node dependencies specifically so both the server (`/api/coins` → `handleChart`) and the client (`useChartLogic.ts`, aligning journal entries to chart buckets) can import the exact same bucketing logic. If the two ever drift (e.g. someone inlines a slightly different weekly-bucket rule on the client "for convenience"), journal markers stop lining up with the chart's x-axis labels silently — no error, they just never match. Keep bucketing logic in this one file.
- **Journal entries "connect to the chart"** via label matching, not a foreign key: `useChartLogic.ts` runs each journal entry's `entryDate` through the same `chartBucketKey()` the chart data used, and if the resulting label exists in the current `points` array, renders a `ReferenceLine` at that label in `PriceLineChart.tsx`. This is why changing `granularity` can make a marker appear/disappear — the entry's date might land in a bucket that's rendered at "monthly" but whose "weekly" bucket isn't part of the currently-fetched range's discrete points, or vice versa. This is expected, not a bug.
- **Portfolio math** (`/api/transactions` `handleList`): per coin, `totalCoinAmount = totalBought - totalSold` (net holdings). `averageBuyPrice = totalPhpSpent / totalBought`. `unrealizedGainLoss` compares current value of net holdings against their average-cost basis. `realizedGainLoss = totalPhpReceived - averageBuyPrice * totalSold` — profit/loss already locked in from sells, using average-cost accounting (not FIFO/LIFO — deliberately simple for a personal tracker).
- **Sell validation**: `handleCreate` in `transactions.ts` sums existing transactions to compute current holdings and rejects a sell that exceeds them. This check is against *current* total holdings, not a chronological balance — logging a historical sell out of date order isn't validated against the balance at that historical point.
- **New-record alert modal**: only closes via its own button (no backdrop/Escape dismiss — intentional, see `components/Modal.tsx`). Dedup logic: `useHomeLogic` stores the last-dismissed `cronLogId` in `localStorage`; a fresh cron run with new records always reopens it since the id changes.
- **Target-reached banner**: session-only dismiss (not localStorage) — tracked as a derived "key" (sorted `symbol-type` list) in `useHomeLogic`. Dismissing hides that exact set; if a *different* coin newly reaches its target, the key changes and the banner reappears even without a page reload.
- **Correcting a logged trade**: `PATCH /api/transactions` lets you fix the coin amount and/or price of an existing entry (the exact numbers aren't always known at the moment you buy/sell). `phpAmount` is always recomputed from `coinAmount * price` — never edited directly, to keep the three numbers internally consistent. The edit sets `isManual = true` and re-runs the sell-doesn't-exceed-holdings check (excluding the transaction's own prior amount from the current total).

## News / Market Signals — read before touching `newsApi.ts`

Two independent sources feed the Home page's "Market Signals" section, both writing to the same `NewsItem` shape and clearly distinguishable by `source`:

1. **Heuristic signal** (`generateSignalForCoin`) — always runs, zero configuration. Computes a bullish/bearish signal purely from that cron run's own price movement (a new recorded high/low, or a ≥2% move since the last check-in), and returns null (no signal saved) when the movement isn't notable — this avoids flooding the section with a low-signal entry every run. `source: "System"`, `url: null`, `externalId: null`.
2. **Free RSS news** (`fetchAllRssArticles` + `matchRssArticlesForCoin`) — always runs, zero configuration, no API key. `fetchAllRssArticles()` is called ONCE per cron run (not once per coin — see `cronLogic.ts`) against a small list of public crypto-news RSS feeds (`RSS_FEEDS` in `newsApi.ts`: Cointelegraph, CryptoSlate, NewsBTC), parsed with `fast-xml-parser`. `matchRssArticlesForCoin` then filters that single pool per coin (by name/symbol match in title+description) and classifies sentiment with a **plain keyword-count heuristic** (`classifySentiment` — counts hits from `BULLISH_KEYWORDS`/`BEARISH_KEYWORDS` lists; this is explicitly not NLP/ML, and the generated summary says so when the article itself has no description).

A CryptoPanic integration (`fetchCryptoPanicNewsForCoin`) previously lived here as an optional third source. **It was removed** — CryptoPanic retired its free API tier in 2026 (paid plan now required: https://cryptopanic.com/developers/api/plans), and since the RSS source above already covers "real articles" for free, keeping a paid-only integration around added maintenance surface without a corresponding capability gain. If a paid provider is wanted again later, follow the same shape a removed function used: something returning `GeneratedSignal[]`, called from `cronLogic.ts` alongside the two above, with its own try/catch so a failure there never touches price fetching.

Neither source ever fabricates a headline or attributes invented content to a real outlet — this was a deliberate design constraint from when only the heuristic existed (misrepresenting computed data as journalism would be actively misleading in a financial context), and it still holds: both are visually and structurally distinct (`source` tells you which), never blended into a single unlabeled feed.

Both sources run per cron execution (`cronLogic.ts`), on both the scheduled `/api/cron` and the manual "Run Cron Now" button. RSS fetch failures are tracked separately from price-fetch errors (`newsWarnings`, not `errors`) and never affect the cron run's overall success/partial/error status — it's enrichment, not core functionality; a coin's price still gets fetched and recorded even if every RSS feed fails. `saveNewsItem` upserts on `externalId` when present (so a re-surfaced RSS article updates in place rather than duplicating, since feeds resurface recent items on every request) and just creates directly when absent (heuristic signals, nothing to dedupe against). RSS articles use `externalId: "rss:" + link`.

**Retention**: `NewsItem` rows older than `NEWS_RETENTION_DAYS` (180 days / 6 months, in `src/lib/retention.ts`) are pruned at the end of every cron run, same mechanism as `Record` pruning but with no "keep the newest" guard — nothing depends on an old signal surviving. Deliberately shorter than `Record`'s 5-year window: signals are timely/contextual, not enduring reference data, and volume isn't capped by a fixed schedule the way `Record` is (a very newsworthy coin could otherwise accumulate rows indefinitely).

**Pagination & run grouping**: `/api/news` is cursor-paginated (`cursor` = last item's `id`) rather than offset-paginated, to stay correct as new items land between page loads. Ordering is `[{ cronLogId: "desc" }, { id: "desc" }]`, NOT `publishedAt desc` — a real article's `publishedAt` is its actual publish date (could be days old) and doesn't reflect when this app fetched it, so sorting by it would scatter one run's real articles throughout the feed instead of grouping them with that run's other signals. `NewsSection.tsx` renders a `<hr/>` divider whenever consecutive items have different `cronLogId`s, giving a visual "this batch is from the last run, this batch from the one before" grouping. `useNewsLogic.ts` (the client hook) accepts a `refreshSignal` prop — `HomeTable.tsx` passes a counter from `useHomeLogic.ts` that bumps after a successful manual cron run, which resets the feed to page 1 and reloads (since a cron run is what generates new items).

## Known gotchas (read before changing these)

1. **`Layout` renders once in `_app.tsx`, not per-page.** This was a deliberate fix for a nav-flicker bug: when each page rendered its own `<Layout>`, the Pages Router remounted it on every client-side navigation, re-firing `useAuth()`'s fetch and causing the nav links to flash. Do **not** re-add `<Layout>` wrapping inside individual page files — every page in `/src/pages` should return bare content (plus `<Head>`), and `_app.tsx` supplies the chrome.
2. **`getServerSideProps` auth guards run per-request**, independent of `_app.tsx`'s client-side `Layout`. `/trade` and `/manage` are still safe even though `Layout` only mounts once — the SSR guard redirects before the page component ever renders.
3. **Coins.ph's "all tickers" response can contain duplicate symbols.** This caused a React "non-unique key" warning. Fixed by deduping server-side in `/api/available-coins` (`seen` Set); the client list key also appends the array index as defense-in-depth. If you add another list backed by raw external API data, dedupe it too rather than trusting the source.
4. **`/api/targets` has no auth check, on purpose** — target prices are a personal reminder, not a money-moving action, per explicit product decision. Don't "fix" this without reconsidering the tradeoff.
5. **This app runs on Postgres, not SQLite** (see README § Deployment: Postgres, not SQLite for why — Vercel's serverless filesystem is ephemeral, so a SQLite file can't reliably persist there). `datasource db { provider }` in `prisma/schema.prisma` is `postgresql`. If you're reading old context (issues, PR history, an earlier version of this file) that mentions SQLite, that's pre-migration and no longer accurate — don't revert the provider back to `sqlite` without re-solving the persistence problem some other way.
6. **`Transaction.type` is a plain `String`, not a Prisma enum.** This was originally because SQLite's Prisma enum support was limited; the app now runs on Postgres (see § Deployment: Postgres, not SQLite), which supports real Prisma enums fine — converting `type` to a proper `enum TransactionType { buy sell }` is a reasonable improvement if you want it, but wasn't done as part of the Postgres migration to keep that migration minimal. It's validated at the Zod layer (`z.enum(["buy","sell"])`) regardless, so there's no correctness gap today.
7. **Mobile nav**: `Layout` has a hamburger menu below the `md` breakpoint. It closes automatically on route change via a `router.events` listener — if you touch routing logic, make sure that listener isn't dropped (stale menu would stay open across navigations otherwise).
8. **Cron schedule is UTC, the product spec was Philippine time.** `.github/workflows/cron.yml` uses `0 2,6,11,14,18,23 * * *` — those UTC hours are what land at 7:00/10:00/14:00/19:00/22:00/2:00 **Philippine time (UTC+8)**. An earlier version of this file had the raw PHT hours pasted directly into a UTC cron field (`0 7,10,14,19,22,2 * * *`), which actually ran at 3pm/6pm/10pm/3am/6am/10am PHT — silently wrong for over a full round of development. If you change the target timezone or the target local times, redo the UTC conversion. (There used to be a second copy of this schedule in `vercel.json` for Vercel's own Cron feature — that file was removed; GitHub Actions is now the only scheduler, so there's only one place to update.)
9. **`POST /api/coins` (add a coin) deliberately never attempts a live price fetch**, even though it easily could. An earlier version did, to catch typos — but manual add exists specifically for coins the live ticker API *can't* reach, so that probe failed every single time by construction, producing a guaranteed error on the one flow meant to route around exactly that problem. Don't re-add a fetch attempt here; if you want typo protection, validate against a known list instead of calling the live API.
10. **`PriceLineChart.tsx` must stay dynamically imported with `ssr: false`** (see `ChartView.tsx`). Recharts' `ResponsiveContainer` measures real DOM dimensions on mount; rendering it during Next's SSR pass either errors or produces a 0-width chart that never recovers without the dynamic-import boundary. If you refactor `ChartView.tsx`, keep the `dynamic()` wrapper around the recharts-consuming component specifically (not necessarily the whole page).
11. **`NewsItem.source` being `"System"` vs. an RSS outlet name (Cointelegraph, CryptoSlate, NewsBTC) tells you which of the two sources produced a row** — see § News / Market Signals. `source: "System"` is expected for the heuristic, not a sign anything's broken; conversely, don't relabel a heuristic row with a fake outlet name to make it "look real" — the whole point of keeping `source` accurate is that a financial-context product should never misrepresent computed data as journalism. (A third source, CryptoPanic, was removed after it went paid-only in 2026 — see § News / Market Signals for the removal note and how to add a similar paid provider back if ever wanted.)
12. **`/api/news` orders by `cronLogId desc, id desc` — resist the urge to "simplify" this to `publishedAt desc`.** It looks redundant (id and cronLogId both roughly increase over time), but they diverge exactly when `saveNewsItem` upserts a re-surfaced RSS article: `cronLogId` updates to the current run, `id` stays at its original value. Sorting by `publishedAt` is wrong for a different reason — that's the article's real-world publish date, unrelated to when this app fetched it. `cronLogId` is the only field that accurately answers "which run does this belong to," which is what the `<hr/>` run-divider in `NewsSection.tsx` depends on.
13. **`fetchAllRssArticles()` is called ONCE per cron run, outside the per-coin loop — never move it inside.** It fetches all of `RSS_FEEDS` and returns the combined pool; `matchRssArticlesForCoin()` (synchronous, no network) then filters that same in-memory pool once per coin. Moving the fetch inside the loop would re-request every RSS feed once per monitored coin per run — wasteful and impolite to feeds that have no obligation to keep serving a misbehaving client.

## Cron: how it works (GitHub Actions), and why not Vercel Cron

**This app does not use Vercel's own Cron feature.** It did earlier in development (`vercel.json`'s `crons` array), but that was removed — GitHub Actions is now the sole scheduler. Two reasons: it works on any Vercel plan (Vercel Hobby only allows daily cron jobs; this app's 6x/day schedule would otherwise need Pro), and it keeps the scheduling config in the repo rather than split across a Vercel-specific file and the Vercel dashboard.

**`.github/workflows/cron.yml`** is the mechanism: a scheduled workflow that `curl`s `GET /api/cron` with an `Authorization: Bearer <CRON_SECRET>` header, on the schedule `0 2,6,11,14,18,23 * * *` (UTC — see Gotcha #8 for the PHT conversion). Needs two repo secrets: `CRON_SECRET` (matching the same env var in the deployment) and `APP_URL` (the deployed base URL). See README § Cron Schedule & Timezone for setup steps. It also has a `workflow_dispatch` trigger for manual runs from the Actions tab, useful for testing without waiting on the schedule. GitHub Actions schedules are best-effort (documented delays of several minutes possible under load), not exact — fine for this use case.

`/api/cron` itself doesn't know or care who's calling it — it's a thin authenticated HTTP wrapper that just checks the `Authorization` header and calls `runCronJob()`. That means swapping the trigger mechanism again later (e.g. [Upstash QStash](https://upstash.com/docs/qstash), [cron-job.org](https://cron-job.org), a real crontab entry on a self-hosted server) is purely a matter of what calls this URL on a schedule — no app code changes. `runCronJob()` in `src/lib/cronLogic.ts` is the actual logic (fetch prices, persist Records, generate news signals, prune old Records/NewsItem); `/api/cron-manual` (the Home page's "Run Cron Now" button) calls that exact same function, which is also how news signals get generated on demand for testing, per the original product request.

## Environment variables

| Var | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | yes | Postgres connection string (see README § Deployment: Postgres, not SQLite) |
| `CRON_SECRET` | recommended | Bearer auth for the scheduled `/api/cron` endpoint |
| `AUTH_USERNAME` / `AUTH_PASSWORD` | yes (for login) | Single-user credentials |
| `AUTH_SECRET` | yes (for login) | HMAC key signing the session cookie — generate with `openssl rand -hex 32` |

## Common commands

```bash
npm run dev          # local dev server
npm run db:push       # push schema changes without a migration file
npm run db:migrate     # create + apply a migration
npm run db:seed         # seed DEFAULT_SEED_COINS into an empty DB
npm run db:studio        # Prisma Studio (browse/edit DB directly)
npm run build              # prisma generate && prisma migrate deploy && next build
```

## Feature changelog

Rough chronological record of how this app grew — useful context for *why* something is shaped the way it is.

1. Initial build: Home/Calendar/Grid pages, cron job (6x/day schedule), Coin/Record/CronLog models.
2. Manage Coins page — DB-driven monitored-coin list (replacing a hardcoded array), symbol search against Coins.ph's full ticker list.
3. "Run Cron Now" button + Buy page (live PHP purchases) + portfolio summary — first version of `Purchase` model.
4. Login (single-user session cookie) gating Buy/Manage/Run-Cron-Now; new-record alert modal (persistent-until-closed); `PriceTarget` model + inline editable targets on Home; manual/historical purchase entry mode.
5. Nav flicker fix (`Layout` moved into `_app.tsx`); `Purchase` → `Transaction` rename with a `type: buy|sell` field and full sell support (`/trade` page, replacing `/buy`); price targets moved from Home (editable) to Manage Coins (editable) with Home now read-only; target-reached UI changed from per-row badges to a single dismissible banner; Target High/Low column order swapped (High first); mobile hamburger nav added; deduped `/api/available-coins` results to fix a React key-uniqueness warning.
6. Replaced a misdirected "manually set a coin's current price" feature on Manage Coins with what was actually wanted — `PATCH /api/transactions` to correct the coin amount/price of an already-logged buy or sell, editable inline in the transaction history list on `/trade`.
7. Fixed a real bug where the cron schedule used the target Philippine-time hours directly in a UTC cron field (ran ~8 hours off from intended); added `.github/workflows/cron.yml` as a ready-to-use alternative to Vercel Cron.
8. Switched default monitored coins from USDT pairs to PHP pairs (`BTCPHP` not `BTCUSDT`) so Home/Calendar/Grid track peso prices directly; added a shared `lib/format.ts` (`formatPhp`/`formatCoinAmount`) used consistently across every price display instead of each component formatting numbers differently; added a manual "type the exact symbol" add-coin form to Manage Coins (for coins that don't surface in the bulk ticker search), sharing the same `addCoin()` path as the search-and-pick flow, initially with a live-price-check probe on add.
9. Removed that live-price-check probe from manual add — it was guaranteed to fail for exactly the coins manual-add exists for (ones the live ticker can't reach), so it just produced a useless error every time. Replaced with an optional "starting price" field on the manual-add form, wired to a reintroduced `POST /api/records` (a plain, no-fetch price-set endpoint) — scoped specifically to seeding a manually-added coin's initial price, re-runnable with the same symbol to update it again later. Buy/Sell's existing manual-price entry (already supported for both buy and sell, plus post-hoc editing via `PATCH /api/transactions`) was left unchanged — it already covered that half of the request.
10. Reordered Manage Coins sections (Add manually now sits directly below Currently monitored, above Browse); added `Record` retention (`src/lib/retention.ts`, `RECORD_RETENTION_DAYS = 365 * 5`), run at the end of every cron job — deletes price-history rows older than 5 years while always preserving each coin's latest row so running high/low is never lost. `Transaction` rows are explicitly out of scope for any retention policy.
11. Replaced the Grid page with `/chart` — a recharts line graph (period high in green, low in red) with coin/range(1–5yr)/granularity(weekly/monthly/yearly) controls, reading period-actual price ranges from `Record` (distinct from Home's cumulative all-time high/low, see Key design decisions). Added a Journal feature (`JournalEntry` model, `/api/journal`, right-sidebar form + list on the Chart page) whose entries align to chart buckets via the shared `chartBucket.ts` and render as dashed markers. Added a Home page "Market Signals" section backed by a new `NewsItem` model and `lib/newsApi.ts` — auto-generated bullish/bearish signals computed from price movement during each cron run, explicitly NOT real scraped news at the time (no provider wired in yet). Removed `/grid`, `GridView.tsx`, `useGridLogic.ts`, and the `type=grid` API handler entirely.
12. Added `NEWS_RETENTION_DAYS` (180 days) pruning for `NewsItem`, run alongside `Record` pruning at the end of every cron job. Added real news via CryptoPanic (`CRYPTOPANIC_API_TOKEN`), deriving sentiment from community votes; ran alongside the heuristic signal, deduped via a new `NewsItem.externalId` unique field and upsert. Added cursor pagination to `/api/news` ("Load more" button in `NewsSection.tsx`) and switched its ordering to `cronLogId` (not `publishedAt`, which is unreliable for real articles) so items can be grouped by which cron run produced them — rendered as `<hr/>` dividers between runs. News fetching moved out of `useHomeLogic.ts` into a dedicated `useNewsLogic.ts` (`NewsSection` is now self-contained, driven by a `refreshSignal` prop bumped after a manual cron run).
13. **This round**: removed `vercel.json` entirely — GitHub Actions (`.github/workflows/cron.yml`) is now the sole cron trigger, not an alternative alongside Vercel's own Cron feature. Removed the CryptoPanic integration added in #12 — it went paid-only, and a free alternative was already the better long-term bet: added `fetchAllRssArticles`/`matchRssArticlesForCoin` in `newsApi.ts`, pulling from free public RSS feeds (Cointelegraph, CryptoSlate, NewsBTC) fetched once per cron run and matched per coin, with sentiment from a plain keyword-count heuristic (`classifySentiment`) since RSS carries no sentiment data of its own — this is now the app's real-article news source, needing zero configuration. Switched the whole app from SQLite to PostgreSQL (`datasource db { provider }` in `prisma/schema.prisma`) since Vercel's serverless filesystem can't persist a SQLite file — no in-repo automated data migration from the old SQLite database, just the schema/provider change.
