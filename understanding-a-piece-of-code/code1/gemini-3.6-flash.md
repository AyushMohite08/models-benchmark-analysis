# What `NewsCache` Does

## Big Picture

`NewsCache` is an in-memory caching utility designed for asynchronous operations (like fetching articles from an API). It combines two popular data-fetching patterns:

1. **Stale-While-Revalidate**: Serves cached data instantly if it exists. If the data is slightly outdated ("stale"), it still returns it immediately to keep the UI fast, while quietly triggering a background fetch to update the cache for next time.
2. **Request Deduplication (Coalescing)**: If multiple requests for the same key happen while a fetch is already in progress, they all share that single pending request instead of spamming the backend API.

It uses two time windows to control freshness:
* **`ttl` (Time to Live)**: How long data is considered **fresh**.
* **`staleTtl`**: The extra grace period after `ttl` expires during which **stale data can still be served** while refreshing in the background.

---

## Practical Example Walkthrough

Imagine setting `ttl = 5000ms` (5s) and `staleTtl = 15000ms` (15s), and fetching news under the key `"headlines"`:

```
[0s] ────────── [5s] ────────────────────────── [20s] ──────────► Time
 └─ Fresh Window ─┴───── Stale Grace Period ──────┴─ Expired ───
```

* **`T = 0s` (Cold Start)**: 
  No cache exists. `get("headlines", fetcher)` starts a network request, stores the promise in `pending`, and awaits it. When resolved, it stores the result in `cache` with `expiresAt = 5s` and `staleUntil = 20s`.
* **`T = 3s` (Fresh Hit)**: 
  The request comes in within 5s (`now < expiresAt`). It immediately returns the cached data without touching the network.
* **`T = 8s` (Stale Hit)**: 
  `expiresAt` has passed, but it's before `staleUntil` (20s). The cache returns the stale data instantly so the caller doesn't wait. In the background, `refresh()` kicks off a new fetcher call to update the cache.
* **`T = 4s` (Duplicate Request while fetching)**: 
  If two components call `get("headlines", fetcher)` at `T = 0s` simultaneously, the second call sees the first call's promise in `pending` and reuses it. Only **one** network request is made.
* **`T = 25s` (Fully Expired)**: 
  `staleUntil` has passed. The cached data is too old to serve. It acts like a cold start and performs a fresh blocking fetch.

---

## How the Parts Work Together

```
                  ┌─────────────────────────────────────────┐
                  │          get(key, fetcher)              │
                  └────────────────────┬────────────────────┘
                                       │
                    Is key in cache & now < expiresAt?
                     ├── YES ──► Return cached data (Fresh)
                     │
                    Is key in cache & now < staleUntil?
                     ├── YES ──► Return cached data + trigger refresh() in background
                     │
                    Is request already in progress?
                     ├── YES ──► Return pending promise (Deduplicated)
                     │
                     └── NO ───► Fetch data, save to cache, return data
```

The system relies on two `Map` objects:
* `this.cache`: Stores `{ data, expiresAt, staleUntil }`.
* `this.pending`: Tracks in-flight `Promise` objects to coalesce concurrent requests.

---

## Important Bugs & Unexpected Behaviors

### 1. `refresh()` Promise Returns `undefined` (Critical Bug)

**The Problem**:
When `refresh()` triggers, it puts its background promise into `this.pending`. However, `refresh()`'s internal async function does **not** return `data`—it only updates `this.cache`.

If a caller hits `get()` while a `refresh()` is still in flight **and** the cache has passed `staleUntil` (or on subsequent fallback checks), `get()` reuses the promise in `this.pending`. Because `refresh()` doesn't return anything, `get()` resolves to **`undefined`**!

**How to Fix**:
Make `refresh()` return `data` from its internal promise:
```javascript
const request = (async () => {
    try {
        const data = await fetcher();
        this.cache.set(key, { ... });
        return data; // Return data so callers reusing this pending promise get the result
    } catch (error) { ... }
})();
```

### 2. Unbounded Memory Growth (No Eviction)

**The Problem**:
`this.cache` is a standard JavaScript `Map` that never deletes entries. If your app generates dynamic keys (e.g., `user-123`, `article-999`), memory will grow indefinitely.

**How to Fix**:
Implement an eviction policy like LRU (Least Recently Used) or add a periodic cleanup job to purge entries where `now > staleUntil`.

### 3. Silent Failures on Background Refresh

**The Problem**:
If a background `refresh()` fails (e.g., network error), it logs to `console.error` and swallows the error. While this prevents unhandled promise rejections, the cache entry retains its old `expiresAt` and `staleUntil` values. Once `staleUntil` passes, the next caller experiences a hard failure without any retry indicator or error hook.

**How to Fix**:
Pass an optional error handler callback or record failure state on the cache entry so callers or monitoring tools are aware of background refresh failures.

---

## Summary Mental Model

Think of `NewsCache` as a **smart storekeeper**: if goods are fresh, hand them over instantly; if they're a bit old, hand them over anyway while ordering a fresh batch in the back; and if a crowd asks for the same item at once, place just one order for all of them.
