/**
 * Advertiser coupon codes ("Mã KM") are per advertiser site and rotate slowly.
 * Cache them so a single 60 s trip to the advertiser serves every later link4m
 * visit until the code expires.
 */
const STORE_KEY = 'sw:link4m:codes';
const MAX_AGE_MS = 12 * 60 * 60 * 1000;

export type CodeEntry = { code: string; at: number };
export type CodeMap = Record<string, CodeEntry>;

const USERNAME_RE = /[^A-Za-z0-9._-]/g;

export function normalizeCodeKey(key: string): string {
  let host = key.trim().toLowerCase();
  try {
    if (host.includes('//')) host = new URL(host).hostname;
  } catch {
    /* keep as-is */
  }
  host = host.replace(/^www\./, '').replace(USERNAME_RE, '');
  return host.slice(0, 120);
}

async function readAll(): Promise<CodeMap> {
  try {
    const got = await chrome.storage.local.get(STORE_KEY);
    const raw = got?.[STORE_KEY];
    return raw && typeof raw === 'object' ? (raw as CodeMap) : {};
  } catch {
    return {};
  }
}

function isFresh(entry: CodeEntry | undefined): entry is CodeEntry {
  return !!entry && typeof entry.code === 'string' && Date.now() - entry.at < MAX_AGE_MS;
}

/** Look up a cached code; `keys` are tried in order (most specific first). */
export async function loadCachedCode(keys: string[]): Promise<{ key: string; code: string } | null> {
  const all = await readAll();
  for (const raw of keys) {
    const key = normalizeCodeKey(raw);
    if (!key) continue;
    const entry = all[key];
    if (isFresh(entry)) return { key, code: entry.code };
  }
  return null;
}

export async function saveCachedCode(key: string, code: string): Promise<void> {
  const normalized = normalizeCodeKey(key);
  const value = code.trim();
  if (!normalized || value.length < 4) return;
  const all = await readAll();
  const pruned: CodeMap = {};
  for (const [k, entry] of Object.entries(all)) {
    if (isFresh(entry)) pruned[k] = entry;
  }
  pruned[normalized] = { code: value, at: Date.now() };
  try {
    await chrome.storage.local.set({ [STORE_KEY]: pruned });
  } catch {
    /* storage full or unavailable */
  }
}

/** Fire `cb` whenever a code is written from another tab (e.g. the advertiser tab). */
export function onCachedCodeChanged(cb: (key: string, code: string) => void): () => void {
  const listener = (
    changes: Record<string, chrome.storage.StorageChange>,
    area: string,
  ): void => {
    if (area !== 'local' || !changes[STORE_KEY]) return;
    const next = changes[STORE_KEY].newValue as CodeMap | undefined;
    if (!next) return;
    for (const [key, entry] of Object.entries(next)) {
      if (isFresh(entry)) cb(key, entry.code);
    }
  };
  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}
