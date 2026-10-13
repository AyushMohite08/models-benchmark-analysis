# JobQueue in One Go

**Big picture:** `JobQueue` is a tiny in-memory task manager for background work.

Think of each job as having a life: `QUEUED` -> `RUNNING` -> `COMPLETED`, with detours to `SCHEDULED` (wait a bit), `DEAD` (gave up), or `CANCELLED`.

It has three tricks to stay safe:
1. **Lease:** when a worker `claim()`s a job, it only owns it for 5s. It must `heartbeat()` to keep it or `acknowledge()` / `fail()` to finish it.
2. **Retry with backoff:** on `fail()` it waits 1s, then 2s, then 4s... up to 4 tries before going `DEAD`.
3. **Idempotency key:** `enqueue()` with the same key returns the same job instead of making a duplicate.

## How it plays out

Say you do `enqueue("send-email", {...}, { priority: 1 })`:

1. Job is `QUEUED`. Worker A calls `claim("A")`, gets the job + a `leaseToken`, job becomes `RUNNING`.
2. Happy path: A finishes, calls `acknowledge(id, "A", token, result)` -> `COMPLETED`.
3. Sad path: A crashes. The job *should* become `QUEUED` again after the lease expires, then Worker B claims it. If B calls `fail()`, job goes to `SCHEDULED` for 1s, then `QUEUED` again.
4. After 4 attempts, it goes `DEAD` and no one retries it.

That's the whole dance: claim with a lease, finish or retry, die after too many tries.

## The sneaky bugs

**1. Crashed jobs get stuck forever — the big one.**
`reapExpired()` is what rescues jobs whose lease ran out, but nothing ever calls it automatically. `claim()` only calls `promoteDue()`. So if a worker dies, its job sits in `RUNNING` forever.

*Fix:* call `this.reapExpired()` at the top of `claim()` (and before `getStats()`).

**2. Idempotency never forgets.**
If you `enqueue()` with key `"order-123"`, then that job completes, calling `enqueue()` again with the same key just returns the old `COMPLETED` job. You can never re-do that work.

*Fix:* only dedupe while the job is active, delete the key when it hits `COMPLETED` / `DEAD` / `CANCELLED`, or add a TTL.

**3. `enqueue()` leaks a live reference.**
`getJob()` returns a copy `{...job}`, but `enqueue()` returns the actual internal object. The caller can accidentally do `job.status = "COMPLETED"` and corrupt the queue.

*Fix:* return `{...job}` from `enqueue()` too, like `getJob()` does.

**4. Lease isn't actually enforced.**
`heartbeat()`, `acknowledge()`, and `fail()` check `workerId` and `leaseToken`, but never check if `leaseUntil` already passed. A super-late worker can still ack long after its lease expired.

*Fix:* reject if `Date.now() > job.leaseUntil`, and null out `leaseToken` on `reapExpired()` / `acknowledge()` / `cancel()` so old tokens can't linger.

In short: nice lifecycle model, but right now the safety net has holes — leases need auto-reaping + expiry checks, and idempotency needs an exit.
