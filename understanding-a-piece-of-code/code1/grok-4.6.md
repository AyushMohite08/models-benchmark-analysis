# NewsCache

This is a small in-memory cache with two jobs: serve news quickly, and avoid firing the same network request twice.

It uses a **stale-while-revalidate** pattern. Fresh data is returned instantly. Slightly old data is also returned instantly, while a background fetch quietly updates the cache. Only fully expired data makes the caller wait.

## Big picture

Think of each cached item as having three ages:

| Age | Window (defaults) | What `get` does |
|---|---|---|
| Fresh | first 5s (`ttl`) | return it, no fetch |
| Stale | next 15s (`staleTtl`) | return it, refresh in the background |
| Dead | after 20s total | wait for a new fetch |

Two maps make this work:

- `cache` — the last good payload, plus two timestamps: `expiresAt` (fresh until) and `staleUntil` (usable until)
- `pending` — in-flight fetches, so overlapping callers share one request instead of stampeding the API

## How it plays out

Imagine a homepage that asks for `"top-stories"` every time someone loads it.

```js
const cache = new NewsCache(5_000, 15_000)
const stories = () => fetch("/api/news").then(r => r.json())

await cache.get("top-stories", stories)
```

**First visitor, empty cache.** Nothing in `cache` or `pending`, so `get` runs `stories()`, stores that promise in `pending`, and waits. If three tabs ask at the same moment, they all await the same promise. On success, the result is stored as fresh for 5s and still-usable until 20s, then `pending` is cleared.

**Someone else loads 2 seconds later.** The entry is still fresh, so they get the cached JSON immediately. No network.

**Someone loads at 8 seconds.** Data is stale but still within `staleUntil`. They get the old headlines right away, and `refresh` kicks off a background fetch. If it succeeds, the next visitor gets new stories. If it fails, the old stories stay — the page does not break.

**Someone loads at 25 seconds.** The entry is dead. `get` will not return the old data. It waits on a new fetch (or joins one that is already in flight).

That last case is where the design gets sharp.

## Bugs worth knowing

**1. A background refresh can make a later `get` return `undefined`.**

`refresh` stores its promise in `pending`, but that promise never `return`s the data — it only writes to `cache`. `get` does not know that. If the cache dies *while* a background refresh is still running, this branch runs:

```js
if (this.pending.has(key)) {
    return this.pending.get(key)
}
```

The caller awaits the refresh promise, which resolves to `undefined`. Fix: make `refresh` return `data`, or have `get` ignore pending promises that came from a background refresh (e.g. a separate `refreshing` set, or a flag on the promise).

**2. A synchronous throw in `fetcher` can poison `pending` forever.**

Both `get` and `refresh` start the async work, then set `pending` *after* the IIFE is created. If `fetcher()` throws immediately, `finally` deletes a key that is not in `pending` yet — then `pending.set` stores an already-settled promise that is never cleaned up. After that, every `get` for that key reuses the dead promise.

Fix: `this.pending.set(key, request)` *before* invoking the fetch, or delete in `finally` only after a successful set. Also `delete` on the rejected path in `get` (it already does, if the throw happens after `pending` is set).

**3. Failed fetches in `get` leave callers with an error, and expired entries never get deleted.**

That is mostly reasonable, but the Map grows forever: old keys are overwritten on success, never evicted on expiry. For a news cache with lots of unique keys, add a sweep or a max size.

**4. `refresh` is `async` but does not return the in-flight work.**

Callers of `refresh` get an immediately-resolved promise, not the fetch. Harmless today because `get` fire-and-forgets it, but it makes bug #1 easier to miss.

## Mental model

`get` is the public door. It either hands you data now (fresh or stale) or a promise you must wait on (miss / dead). `pending` is the bouncer that collapses duplicate requests. `refresh` is the quiet side door that restocks the shelf without making anyone wait — unless the shelf expires before restocking finishes, in which case the bouncer currently hands you an empty bag.
