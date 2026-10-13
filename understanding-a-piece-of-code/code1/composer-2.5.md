# What `NewsCache` Does

## Big picture

`NewsCache` is a small in-memory cache for **async** data (think “fetch headlines from an API”). You call `get(key, fetcher)` with a cache key and a function that actually loads the data.

It does three useful things at once:

1. **Fresh cache** — If data is still “young,” return it instantly (no network).
2. **Stale-while-revalidate** — If data is a bit old but not dead, return it anyway and refresh in the background so the next read is fresh.
3. **Request coalescing** — If several callers ask for the same key while one fetch is already running, they all share one in-flight promise instead of hammering the API.

Two time knobs control this:

| Setting | Default | Meaning |
|--------|---------|--------|
| `ttl` | 5s | How long cached data is treated as **fresh** |
| `staleTtl` | 15s | After fresh expires, how much longer you may still **serve** that data while refreshing |

Each cached item stores `data`, `expiresAt` (fresh until), and `staleUntil` (serve-stale until).

---

## Example walkthrough

Imagine `ttl = 5000`, `staleTtl = 15000`, key `"top-stories"`, and `fetcher` calls your news API.

**T = 0 — First request**

- Cache is empty → starts a fetch, stores the promise in `pending`, awaits it.
- API returns articles → cache gets `{ data, expiresAt: now+5s, staleUntil: now+20s }`.
- Caller gets the articles.

**T = 3s — Second request**

- `now < expiresAt` → **fresh path**: return cached articles, no fetch.

**T = 8s — Third request (stale but usable)**

- Past `expiresAt`, but `now < staleUntil`.
- **Stale path**: return the old articles immediately (fast UI).
- `refresh()` runs in the background to update the cache for next time.

**T = 25s — Fourth request (fully expired)**

- Past `staleUntil`, and no valid “serve stale” window.
- Behaves like a cold miss: one shared fetch via `pending`, then fresh data is cached and returned.

The `pending` map is what ties concurrent callers to the same promise during that last step.

---

## How the pieces fit

```
get(key, fetcher)
    │
    ├─ fresh? ──────────────► return cached data
    │
    ├─ stale-but-OK? ───────► return cached data + refresh() in background
    │
    └─ miss / too old
           ├─ fetch already running? ─► return that promise
           └─ else start fetch, cache result, return data

refresh(key, fetcher)  →  same fetch + cache update, but errors are logged, not thrown
```

`refresh` is only for background updates: callers who already got stale data don’t wait on it.

---

## Bugs and sharp edges

### 1. **Returning a background refresh promise can give `undefined` (real bug)**

`get` treats any in-flight `pending` promise as “the fetch you should await”:

```js
if (this.pending.has(key)) {
    return this.pending.get(key);
}
```

But `refresh()` also stores its promise in `pending`, and that async function **does not return** the fetched data—it only writes to the cache. The promise resolves to `undefined`.

**When it bites:** Data goes stale, the first `get` serves old data and starts `refresh()`. Before that refresh finishes, `staleUntil` passes. The next `get` skips the stale branch, sees `pending`, and returns the refresh promise → caller gets **`undefined`**, not articles.

**Fix ideas:**

- Use two maps (e.g. `pendingFetches` vs `pendingRefreshes`), and only coalesce on full fetches.
- Or make `refresh`’s promise resolve to `data` like `get` does.
- Or in `get`, when `pending` exists, await it but then read `this.cache.get(key).data` (and handle missing cache on failure).

### 2. **Failed background refresh is silent to callers**

Refresh failures are only `console.error`. Users keep seeing stale data until `staleUntil`, then they pay for a blocking fetch. That may be fine, but there’s no hook to surface degradation (retry, metrics, fallback).

**Fix:** Optional `onRefreshError` callback, or expose cache metadata (e.g. `lastError`, `lastSuccess`).

### 3. **Cache never evicts keys**

Every distinct `key` stays in the `Map` forever. Fine for a few fixed keys (“top-stories”); risky if keys are unbounded (per user, per URL, etc.).

**Fix:** LRU cap, TTL-based sweep, or explicit `delete(key)` / `clear()`.

### 4. **Minor: `expiresAt` / `staleUntil` use two `Date.now()` calls**

Usually harmless; for pedantic consistency you could use one `const now = Date.now()` when writing an entry.

---

## Mental model in one sentence

**Serve fast from memory when you can; when data is merely old, still serve it but refresh quietly; when it’s too old or missing, fetch once and share that work—except background refreshes currently share the same `pending` slot as real fetches, which can hand callers `undefined` if timing lines up badly.**
