# JobQueue

This is an in-memory work queue. Producers drop jobs in; workers pull one, do the work, then say they finished or failed. If a worker dies mid-job, a lease lets someone else pick it up — but only if you remember to reap.

It is **at-least-once**, not exactly-once. A slow worker and a retry can both process the same job.

## Big picture

Each job is a record in `jobs` with a status:

| Status | Meaning |
|---|---|
| `QUEUED` | Ready to be claimed |
| `SCHEDULED` | Waiting until `availableAt` (delay or retry backoff) |
| `RUNNING` | A worker holds it, with a time-limited lease |
| `COMPLETED` / `DEAD` / `CANCELLED` | Terminal |

Two extra maps/counters sit beside that:

- `idempotency` — “if you’ve seen this key, return the old job instead of creating a new one”
- `leaseToken` — a one-time ticket so only the worker who currently owns the job can heartbeat, ack, or fail it

`claim` is the front door for workers. `promoteDue` quietly turns due `SCHEDULED` jobs into `QUEUED` before that. `reapExpired` is the janitor for dead workers — and **nothing calls it for you**.

## How it plays out

Imagine order notifications:

```js
const queue = new JobQueue({ maxAttempts: 4, leaseMs: 5000 })

queue.enqueue("notify", { orderId: 99 }, {
    priority: 10,
    idempotencyKey: "order-99-notify"
})
```

**Worker A claims it.** Highest priority first, then oldest. The job becomes `RUNNING`, `attempts` goes to 1, and A gets a `leaseToken` plus a 5s `leaseUntil`.

**Happy path.** A sends the email, maybe `heartbeat`s if it is slow (that just pushes `leaseUntil` forward), then `acknowledge`s with the token. Status becomes `COMPLETED`.

**Send fails.** `fail` records the error. If attempts are still under 4, the job goes `SCHEDULED` with exponential backoff: 1s, then 2s, then 4s, capped at 30s. After 4 claims that all fail, it is `DEAD`.

**Delayed job.** `enqueue(..., { delayMs: 60_000 })` starts as `SCHEDULED`. It is invisible to `claim` until time is up and `promoteDue` runs (which only happens at the start of `claim`).

**Duplicate enqueue.** A second call with the same `idempotencyKey` does not create a job. It returns the original, whatever state it is in.

**Worker A crashes.** The job stays `RUNNING` until something calls `reapExpired()`. Then it is retried like a `fail` (same backoff), or marked `DEAD` if it is out of attempts.

## Bugs worth knowing

**1. Expired leases do not recover on their own.**

`claim` promotes delayed jobs, but it never reaps. If a worker dies and nobody calls `reapExpired()`, that job sits in `RUNNING` forever and `claim` will skip it. Fix: call `reapExpired()` at the top of `claim` (and/or on a timer).

**2. Idempotency keys last forever.**

Cancelled, completed, and dead jobs still occupy the key. You cannot enqueue that work again. Also, `enqueue` returns the **live** job object, so a caller can mutate status/payload and corrupt the queue. Fix: drop the key on terminal states if you want “don’t double-fire in-flight work,” return a copy like `getJob` does, and only reuse keys for `QUEUED` / `SCHEDULED` / `RUNNING`.

**3. A later success still shows the old error.**

`fail` and `reapExpired` set `error`, but `acknowledge` never clears it. A job that fails once then succeeds looks completed *and* still failed. Fix: set `error = null` in `acknowledge`.

**4. There is no “put it back” and no claim-by-type.**

Workers always get the global highest-priority job. If they cannot handle that `type`, their only options are to sit on it or `fail` it — and fail burns an attempt. Fix: add `claim(workerId, { types })` and a `release` that returns the job to `QUEUED` without incrementing attempts.

**5. Jobs are never deleted.**

`COMPLETED` / `DEAD` / `CANCELLED` stay in the Map forever. Fine for a demo; a leak in a long-running process. Fix: evict terminal jobs, or at least drop them from `idempotency` after a TTL.

**6. Duplicate processing is possible (by design, but easy to miss).**

If you *do* reap, a late worker can still be doing the work while another worker has already claimed the retry. The old `acknowledge` will fail (token/status mismatch), but the side effect (email sent, charge charged) may have already happened. Heartbeat on a timer shorter than `leaseMs`, and make handlers idempotent.

## Mental model

`enqueue` puts a ticket on the board. `claim` hands the best ticket to a worker and starts a 5-second clock. `heartbeat` snoozes that clock. `acknowledge` / `fail` are how the worker checks in. `reapExpired` is the only thing that notices a worker vanished — if you never run it, the board has tickets stuck in “someone’s working on this” with nobody there.
