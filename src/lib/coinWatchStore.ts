import prisma from "@/lib/prisma";
import {
  extractCoinWatchEventsFromNotes,
  type CoinWatchEvent,
  type CoinWatchLabel,
} from "@/lib/coinWatchDates";

export const COIN_WATCH_PROMPT_ID = "coin-watch-calendar";
export const COIN_WATCH_CATEGORY = "CoinWatch";

export type StoredCoinWatch = CoinWatchEvent & {
  id: string;
  createdAt: string;
};

type Store = { version: 1; events: StoredCoinWatch[] };

function parseStore(raw: string | null | undefined): Store {
  if (!raw) return { version: 1, events: [] };
  try {
    const j = JSON.parse(raw);
    if (Array.isArray(j?.events)) return { version: 1, events: j.events };
    if (Array.isArray(j)) return { version: 1, events: j };
  } catch {
    /* ignore */
  }
  return { version: 1, events: [] };
}

async function readStore(): Promise<Store> {
  try {
    const log = await prisma.catalystLog.findUnique({
      where: { promptId: COIN_WATCH_PROMPT_ID },
    });
    return parseStore(log?.response);
  } catch {
    return { version: 1, events: [] };
  }
}

async function writeStore(store: Store): Promise<void> {
  await prisma.catalystLog.upsert({
    where: { promptId: COIN_WATCH_PROMPT_ID },
    create: {
      promptId: COIN_WATCH_PROMPT_ID,
      category: COIN_WATCH_CATEGORY,
      response: JSON.stringify(store),
    },
    update: {
      category: COIN_WATCH_CATEGORY,
      response: JSON.stringify(store),
    },
  });
}

function newId(): string {
  return `cw_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
}

/** List all stored coin-watch rows (calendar). */
export async function listCoinWatchEvents(): Promise<StoredCoinWatch[]> {
  const s = await readStore();
  return [...s.events].sort((a, b) => a.date.localeCompare(b.date) || (a.symbol || "").localeCompare(b.symbol || ""));
}

/**
 * After journal create/update: drop prior scrapes from this journal id, then append fresh extracts.
 * Appends only — no cross-journal dedupe.
 */
export async function ingestJournalForCoinWatch(args: {
  journalEntryId: number;
  notes: string;
  title?: string | null;
  symbol?: string | null;
  coinId?: number | null;
}): Promise<number> {
  const extracted = extractCoinWatchEventsFromNotes(args.notes || "", {
    journalEntryId: args.journalEntryId,
    journalTitle: args.title,
    symbol: args.symbol ?? null,
    coinId: args.coinId ?? null,
  });
  const store = await readStore();
  const kept = store.events.filter((e) => e.journalEntryId !== args.journalEntryId);
  const now = new Date().toISOString();
  const added: StoredCoinWatch[] = extracted.map((e) => ({
    ...e,
    id: newId(),
    createdAt: now,
  }));
  await writeStore({ version: 1, events: [...kept, ...added] });
  return added.length;
}

/** Remove scrapes tied to a deleted journal entry. */
export async function removeCoinWatchForJournal(journalEntryId: number): Promise<number> {
  const store = await readStore();
  const next = store.events.filter((e) => e.journalEntryId !== journalEntryId);
  const removed = store.events.length - next.length;
  if (removed > 0) await writeStore({ version: 1, events: next });
  return removed;
}

export async function deleteCoinWatchById(id: string): Promise<boolean> {
  const store = await readStore();
  const next = store.events.filter((e) => e.id !== id);
  if (next.length === store.events.length) return false;
  await writeStore({ version: 1, events: next });
  return true;
}

/** Delete every event on a calendar date (YYYY-MM-DD). */
export async function deleteCoinWatchByDate(date: string): Promise<number> {
  const day = String(date).slice(0, 10);
  const store = await readStore();
  const next = store.events.filter((e) => e.date !== day);
  const n = store.events.length - next.length;
  if (n > 0) await writeStore({ version: 1, events: next });
  return n;
}

/** Delete one coin's rows on a date (optional label). */
export async function deleteCoinWatchByDateSymbol(
  date: string,
  symbol: string,
  label?: string
): Promise<number> {
  const day = String(date).slice(0, 10);
  const sym = String(symbol || "").toUpperCase();
  const store = await readStore();
  const next = store.events.filter((e) => {
    if (e.date !== day) return true;
    if ((e.symbol || "").toUpperCase() !== sym) return true;
    if (label && e.label !== label) return true;
    return false;
  });
  const n = store.events.length - next.length;
  if (n > 0) await writeStore({ version: 1, events: next });
  return n;
}

export type { CoinWatchLabel };
