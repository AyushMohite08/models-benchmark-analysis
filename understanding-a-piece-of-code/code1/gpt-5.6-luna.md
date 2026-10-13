# NewsCache: Big picture

`NewsCache` is a small in-memory cache for news data. It avoids making the same network request repeatedly, while still allowing old data to be shown briefly when a refresh is happening.

It has three states for each key:

- **Fresh:** return the cached data immediately.
- **Stale but usable:** return the old data immediately and refresh it in the background.
- **Too old:** wait for a new request before returning anything.

`pending` prevents multiple callers from starting duplicate requests for the same key.

## Practical example

Suppose the cache uses the defaults:

- `ttl = 5 seconds`: data is fresh for 5 seconds.
- `staleTtl = 15 seconds`: after that, old data may still be served for another 15 seconds.

When `get("top-stories", fetchNews)` is called:

1. **First call:** there is no cached value, so `fetchNews()` runs. Its result is stored for 5 seconds.
2. **Calls during those 5 seconds:** the stored news is returned immediately.
3. **Calls from 5 to 20 seconds:** the old news is returned immediately, and one background refresh starts. Users do not wait for the network.
4. **Calls after 20 seconds:** the old value is no longer usable, so callers wait for a new fetch.
5. **Several callers arriving at once:** `pending` makes them share the same in-progress request instead of sending several identical requests.

After a successful fetch, the value is cached again and the timers restart.

## Important bug

There is a problematic interaction between `refresh()` and `get()`:

- A background refresh stores a promise in `pending`.
- If the stale period ends before that refresh finishes, `get()` sees the pending promise and returns it.
- But `refresh()` does not return the fetched data, so its promise resolves to `undefined` even when the refresh succeeds.

That means a caller can receive `undefined` instead of news data. The failure path has the same problem because the refresh catches the error and does not rethrow it.

A robust fix is to make the “expired data” path wait for the refresh and then read the updated cache, or make refresh return the fetched data and handle failures explicitly. For example, after awaiting a pending refresh, `get()` could check the cache again and retry the fetch if no usable value exists.

## Other behavior to be aware of

- A failed background refresh is logged, but the old cached value remains until its stale deadline. This is reasonable, although repeated calls can retry and log repeatedly.
- Cached entries are never removed just because they expired. If many different keys are used, the `Map` can grow indefinitely. A cleanup policy or size limit would prevent that.
- The cache stores the exact object returned by `fetcher()`. If another part of the program mutates that object, later callers see the mutation too. Copying the data would avoid that when immutability matters.
