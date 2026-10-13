# NewsCache in One Go

**Big picture:** `NewsCache` is a tiny memory for news fetches so you don't hit the network every time.

Think of each headline list as having 3 ages:
1. **Fresh (0-5s):** serve instantly from memory.
2. **Stale-but-okay (5-20s):** serve the old copy instantly, but sneakily fetch a new copy in the background. This is called stale-while-revalidate.
3. **Too old (20s+):** don't serve the old copy, make the user wait for a fresh fetch.

It has two Maps: `cache` holds the data + timers, `pending` holds in-flight promises so 10 people asking for the same thing at once only cause 1 network call.

## How it plays out

Say you call `get("top-stories", fetchNews)`:

1. First time: no cache, so it runs `fetchNews()`, saves it, everyone waiting shares that one promise.
2. 2 seconds later: fresh, returns saved data, no network.
3. 7 seconds later: stale, returns old news *right away* and calls `refresh()` in background to update for next time. You don't wait.
4. 25 seconds later: too old, it waits for `fetchNews()` again.

That's the whole dance: fast when possible, slightly old when acceptable, slow only when necessary.

## The sneaky bugs

**1. You can get `undefined` back — the big one.**
`refresh()` saves its promise in `pending`, but that promise never returns the data (it resolves to `undefined`).

If a background refresh is still running when the stale window expires, the next `get()` sees `pending.has(key)` and returns that `undefined` promise. You asked for news, you get nothing.

*Fix:* Don't mix the two kinds of promises. Easiest: check for stale *before* checking `pending` — if you have stale data, just return it. And make `refresh()` `return data` so even if someone does wait on it, they get real data.

**2. Two clocks instead of one.**
On save it does:
```
expiresAt: Date.now() + ttl
staleUntil: Date.now() + ttl + staleTtl
```
Those are two slightly different `now`s. Tiny, but sloppy.

*Fix:* `const now = Date.now()` once, then use it for both.

**3. It never forgets.**
Expired keys stay in the `Map` forever. With lots of different keys, memory just grows.

*Fix:* delete the entry when it's past `staleUntil` and a fetch fails, or add a max-size / LRU eviction.

In short: smart idea, clean fast-path, but the background-refresh + deduplication share the same `pending` slot in a way that can hand you `undefined` right when the cache is oldest.
