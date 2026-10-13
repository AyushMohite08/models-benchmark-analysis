# What `JobQueue` Does

## Big picture

`JobQueue` is a **single-process, in-memory job queue**—like a tiny slice of Sidekiq or SQS with no database. Your app **enqueues** units of work (`type` + `payload`). One or more **workers** loop on **`claim`**, do the work, then **`acknowledge`** (done) or **`fail`** (try again later).

On top of basic FIFO, it adds:

- **Priority** — bigger number runs first.
- **Delays** — “run this in 60 seconds.”
- **Leases** — a worker only “owns” a job for `leaseMs`; heartbeats extend that window.
- **Retries** — exponential backoff, then **`DEAD`** after `maxAttempts` **claims**.
- **Idempotency keys** — duplicate submits with the same key return the same job instead of enqueueing twice.

State is just two `Map`s: `jobs` (id → job record) and `idempotency` (key → job id).

---

## Example: one thumbnail job, one worker

Defaults: `leaseMs = 5s`, `maxAttempts = 4`, backoff from `baseDelayMs` capped at `maxDelayMs`.

**1. Producer enqueues**

```js
queue.enqueue("make_thumbnail", { videoId: "v42" }, {
  priority: 2,
  idempotencyKey: "thumb-v42"
});
```

Job is **`QUEUED`** (or **`SCHEDULED`** if `delayMs > 0`). A double-submit with `"thumb-v42"` returns the existing job—no second row in the queue.

**2. Worker polls**

```js
const work = queue.claim("worker-a");
```

Inside `claim`:

- `promoteDue()` moves due **`SCHEDULED`** jobs → **`QUEUED`**.
- Among **`QUEUED`** jobs with `availableAt <= now`, pick highest `priority`, then oldest `createdAt`.
- Mark **`RUNNING`**, set `workerId`, bump **`attempts`**, hand back a **`leaseToken`** and **`leaseUntil`**.

**3. While working**

Long jobs call `heartbeat(id, "worker-a", leaseToken)` so the lease doesn’t look abandoned.

**4. Finish**

- `acknowledge(..., result)` → **`COMPLETED`**, store `result`.
- `fail(..., err)` → if `attempts >= maxAttempts`, **`DEAD`**; else **`SCHEDULED`** with backoff (`baseDelayMs * 2^(attempts-1)`, capped).

**5. Worker disappears**

Nothing in `claim` auto-heals this. You (or a timer) must call **`reapExpired()`**, which finds **`RUNNING`** jobs past `leaseUntil` and reschedules them the same way `fail` would (or marks **`DEAD`**).

Rough lifecycle:

```
enqueue → QUEUED (or SCHEDULED → promoteDue → QUEUED)
              ↓ claim
           RUNNING ──heartbeat──┐
              ↓                │
    acknowledge → COMPLETED     │
    fail / reapExpired → SCHEDULED (wait) → QUEUED again
                         └→ DEAD (out of attempts)
```

**Non-obvious detail:** `attempts` increments on **every `claim`**, not on every `fail`. So `maxAttempts = 4` means “this job may be **started** up to four times,” which is how `fail` and `reapExpired` decide when to give up.

---

## Bugs and weird behavior

**1. Stuck `RUNNING` jobs (the big operational footgun)**  
`claim` calls `promoteDue()` but **never** `reapExpired()`. If a worker crashes, the job sits **`RUNNING`** until something else reaps leases. No poll → no recovery.

*Fix:* Call `reapExpired()` at the start of `claim` and/or on an interval.

**2. Idempotency keys live forever**  
If `"thumb-v42"` already mapped to a job, a new `enqueue` with that key returns that job even when it’s **`COMPLETED`**, **`DEAD`**, or **`CANCELLED`**. You can’t “enqueue again” under the same key without clearing the map.

*Fix:* Drop or ignore the idempotency entry when the job hits a terminal state, or only dedupe while status is non-terminal.

**3. `enqueue` leaks the internal job object**  
Idempotent hits and fresh enqueues return the **same object** stored in `jobs`. Callers can mutate `status` or `payload` and break invariants. `getJob` shallow-copies the top level, but nested `payload` is still shared.

*Fix:* Return `{ ...job }` (and clone `payload` if you care about isolation).

**4. Time only moves when workers poll**  
Delayed jobs flip **`SCHEDULED` → `QUEUED`** only when `claim` runs (`promoteDue`). No workers → delayed jobs stay asleep even after `availableAt`.

*Fix:* Fine if documented; otherwise run `promoteDue` on a timer.

**5. `cancel` vs a live worker**  
You can cancel a **`RUNNING`** job in the map, but the worker wasn’t notified. It may keep working; `acknowledge` / `fail` will then return `false`.

*Fix:* Expected for an in-memory queue—workers should treat `false` as “job no longer mine.”

---

## Mental model in one sentence

**Producers push records into a map; workers pull the best ready job, rent it with a token and a timer, and must finish or lose it—except recovery only happens if something actually calls `reapExpired`.**
