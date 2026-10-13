# `JobQueue` — simple explanation

## Big picture

`JobQueue` is a small, in-memory job manager. It stores work that needs to be done, gives jobs to workers, and tracks whether each job is:

- waiting to be processed (`QUEUED` or `SCHEDULED`)
- currently being processed (`RUNNING`)
- finished (`COMPLETED`)
- cancelled (`CANCELLED`)
- permanently failed (`DEAD`)

It does not run jobs itself. A separate worker must repeatedly:

1. add jobs with `enqueue()`
2. ask for work with `claim()`
3. keep ownership alive with `heartbeat()`
4. finish with `acknowledge()` or report failure with `fail()`

The queue uses a short lease to prevent a crashed worker from owning a job forever. It also retries failures with an increasing delay.

## Practical example

Imagine a worker that sends welcome emails:

```js
const job = queue.enqueue("send-welcome-email", {
    email: "ayush@example.com"
}, { priority: 5 });
```

The job starts as `QUEUED`. A worker claims it:

```js
const claimed = queue.claim("worker-1");
```

The returned object contains the job ID and a `leaseToken`. Together, the worker ID and token prove that this worker currently owns the job.

While sending a slow email, the worker can call:

```js
queue.heartbeat(
    claimed.id,
    "worker-1",
    claimed.leaseToken
);
```

If the email succeeds, it calls `acknowledge()`, changing the job to `COMPLETED`.

If sending fails, it calls `fail()`. The first failure schedules a retry after 1 second, the next after 2 seconds, then 4 seconds, and so on, capped at `maxDelayMs`. Once the job reaches `maxAttempts`, it becomes `DEAD`.

If the worker disappears, its lease eventually expires. Calling `reapExpired()` releases the job and schedules it for another attempt.

## How the parts fit together

- `enqueue()` creates a job and optionally delays it. An `idempotencyKey` prevents the same logical job from being added twice.
- `claim()` promotes due scheduled jobs, chooses the highest-priority available job, marks it `RUNNING`, and creates a lease.
- `heartbeat()` extends the lease, but only for the worker holding the matching token.
- `acknowledge()` marks a claimed job as complete.
- `fail()` either schedules a retry or marks the job `DEAD`.
- `promoteDue()` changes scheduled jobs back to `QUEUED` when their delay ends.
- `reapExpired()` finds abandoned running jobs and makes them retryable.
- `cancel()` stops a job unless it is already completed, dead, or cancelled.
- `getJob()` and `getStats()` provide inspection information.

The `Map` objects hold everything in memory, so all jobs disappear when the process stops. This is a useful learning example, but not a durable production queue.

## Most important bugs and unexpected behaviors

1. **Expired jobs are not detected automatically.**  
   `claim()` calls `promoteDue()` but not `reapExpired()`. If nobody explicitly calls `reapExpired()`, a crashed worker leaves its job stuck in `RUNNING` forever.  
   **Fix:** call `reapExpired()` before claiming, or run it from a regular timer/scheduler.

2. **An expired worker can still act before reaping happens.**  
   `heartbeat()`, `acknowledge()`, and `fail()` check the token but do not check whether `leaseUntil` is already in the past. Therefore, an old worker can extend or complete an expired lease if `reapExpired()` has not run yet.  
   **Fix:** reject operations when `Date.now() >= leaseUntil`, or centralize lease-expiration handling in a helper.

3. **Idempotency keys remain attached to cancelled jobs.**  
   Enqueuing again with the same key returns the cancelled job instead of creating a fresh one. The same key also permanently points to completed or dead jobs.  
   **Fix:** decide on the intended policy; commonly, remove the key when cancelling or after a configurable retention period.

4. **The queue exposes mutable internal job objects.**  
   `enqueue()` returns the actual object stored in `this.jobs`. A caller could change its status, attempts, or lease fields directly and bypass the queue rules.  
   **Fix:** return a copy, as `claim()` and `getJob()` already mostly do. Consider copying or validating payloads too.

5. **A successful retry still keeps its old error.**  
   `fail()` writes to `job.error`, but `acknowledge()` never clears it. A completed job can therefore contain both a successful result and an old failure message.  
   **Fix:** set `job.error = null` when acknowledging, or keep a separate retry-history list.

6. **Jobs can starve.**  
   `claim()` always prefers higher priority. If high-priority jobs keep arriving, low-priority jobs may never run.  
   **Fix:** add priority aging, fairness, or a maximum number of consecutive high-priority claims.

7. **There is no cleanup or persistence.**  
   Completed, dead, and cancelled jobs stay in the maps forever, and everything is lost on process restart.  
   **Fix:** add retention/cleanup and use a durable shared store for real multi-worker use.

Overall, the class demonstrates the core lifecycle of a leased, retryable job queue. Its most important operational requirement is that something outside the class regularly calls `reapExpired()`; without that, worker crashes can permanently block jobs.
