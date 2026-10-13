# What `JobQueue` Does

## Big Picture

`JobQueue` is an in-memory task management system designed for background job processing. It acts as a central coordinator between job producers (apps adding tasks) and workers (processes performing the work).

Key features built into the system include:
* **Priority-Based Dispatch**: High-priority tasks are executed before low-priority ones.
* **Lease Locking**: When a worker takes a job, it gets temporary exclusive ownership (a "lease") so other workers don't work on the same task.
* **Idempotency**: Prevents duplicate jobs from being queued if the same key is submitted twice.
* **Retries with Exponential Backoff**: Failed jobs automatically wait exponentially longer before retrying, eventually moving to a `DEAD` status if maximum attempts are exhausted.
* **Delayed Execution**: Jobs can be scheduled to run at a future timestamp.

---

## Practical Example Walkthrough

Imagine a video processing system handling user uploads.

```
 [ enqueue ] ──► SCHEDULED (if delayed) ──► QUEUED
                                              │
                                           claim()
                                              ▼
 COMPLETED ◄── acknowledge() ─────────── RUNNING
                                              │
                    fail() / reapExpired() ───┴──► DEAD (if max attempts reached)
                               │
                               └────────► SCHEDULED (exponential backoff)
```

Here is how the queue manages the lifecycle:

1. **Enqueueing**: You queue a video encoding job with an idempotency key:
   ```js
   queue.enqueue("TRANSCODE_VIDEO", { fileId: "v_100" }, { priority: 5, idempotencyKey: "upload_v100" });
   ```
   The job is saved with status `"QUEUED"`. If network issues cause your backend to call `enqueue` again with `"upload_v100"`, the queue returns the existing job instead of creating a duplicate.

2. **Worker Claiming**: A worker process calls `claim("worker-1")`.
   `JobQueue` promotes any due scheduled tasks to `"QUEUED"`, sorts candidate tasks by priority (highest first) and age (oldest first), and assigns the top task to `"worker-1"`. Status changes to `"RUNNING"` with a 5-second lease (`leaseMs`) and a unique `leaseToken`.

3. **Processing & Heartbeat**:
   While transcoding, `"worker-1"` periodically calls `heartbeat(jobId, "worker-1", leaseToken)` to extend its lease so the job isn't considered abandoned.

4. **Completion or Failure**:
   * **Success**: Worker calls `acknowledge(...)`. Status moves to `"COMPLETED"`.
   * **Failure**: If processing throws an error, worker calls `fail(...)`. `attempts` is checked against `maxAttempts`. If retries remain, status becomes `"SCHEDULED"` with an exponential delay before it can be claimed again.

---

## How the Main Parts Work Together

The queue state is tracked using two internal maps:
```54:87:understanding-a-piece-of-code/code2/code.js
    claim(workerId) {
        this.promoteDue();

        const now = Date.now();

        const candidates = [...this.jobs.values()]
            .filter(job =>
                job.status === "QUEUED" &&
                job.availableAt <= now
            )
            .sort((a, b) =>
                b.priority - a.priority ||
                a.createdAt - b.createdAt
            );

        const job = candidates[0];

        if (!job) return null;

        job.status = "RUNNING";
        job.workerId = workerId;
        job.attempts++;
        job.leaseUntil = now + this.leaseMs;
        job.leaseToken = this.nextToken++;

        return {
            id: job.id,
            type: job.type,
            payload: job.payload,
            attempt: job.attempts,
            leaseToken: job.leaseToken,
            leaseUntil: job.leaseUntil
        };
    }
```

* **`this.jobs`**: Maps job IDs to job state objects containing metadata, status, attempts, and lease details.
* **`this.idempotency`**: Maps custom keys to job IDs to guarantee deduplication during `enqueue`.

---

## Important Bugs & Unexpected Behaviors

### 1. Expired Leases Are Never Reaped Automatically

**The Problem**:
While `claim()` automatically runs `promoteDue()` to pick up scheduled jobs, it **never** calls `reapExpired()`.

```169:194:understanding-a-piece-of-code/code2/code.js
    reapExpired() {
        const now = Date.now();

        for (const job of this.jobs.values()) {
            if (
                job.status !== "RUNNING" ||
                job.leaseUntil > now
            ) {
                continue;
            }

            job.workerId = null;
            job.leaseUntil = null;
            job.error = "Worker lease expired";

            if (job.attempts >= this.maxAttempts) {
                job.status = "DEAD";
            } else {
                job.status = "SCHEDULED";
                job.availableAt = now + Math.min(
                    this.baseDelayMs * 2 ** (job.attempts - 1),
                    this.maxDelayMs
                );
            }
        }
    }
```

If a worker crashes or freezes mid-task, the job stays stuck in `"RUNNING"` status forever. No active worker will ever claim it unless an external process manually invokes `reapExpired()`.

**How to Fix**:
Call `this.reapExpired()` inside `claim()` before selecting candidates:
```js
claim(workerId) {
    this.promoteDue();
    this.reapExpired(); // Recover abandoned tasks from dead workers
    ...
}
```

---

### 2. Full History Scan Causes $O(N)$ Slowdowns & Memory Leaks

**The Problem**:
`this.jobs` stores every job ever created. In `claim()`, `[...this.jobs.values()]` converts every historical job—including `"COMPLETED"`, `"DEAD"`, and `"CANCELLED"` entries—into an array, filtering and sorting it on every single claim attempt.

As your system processes thousands of tasks over time:
1. `claim()` becomes progressively slower.
2. RAM usage grows indefinitely because old jobs are never deleted or archived.

**How to Fix**:
Maintain a separate `QUEUED` list/array or Priority Queue for active tasks, or prune completed/dead jobs after a retention period.

---

### 3. Dead or Cancelled Jobs Lock Out Idempotency Keys Forever

**The Problem**:
When a job with an `idempotencyKey` fails completely and enters `"DEAD"` status (or is manually `"CANCELLED"`), its key remains locked in `this.idempotency`.

```24:26:understanding-a-piece-of-code/code2/code.js
        if (idempotencyKey && this.idempotency.has(idempotencyKey)) {
            return this.jobs.get(this.idempotency.get(idempotencyKey));
        }
```

Subsequent attempts to `enqueue` a fresh attempt using the same idempotency key will permanently return the dead/cancelled job object rather than allowing a new task to be created.

**How to Fix**:
Delete idempotency records when a job transitions to `"DEAD"` or `"CANCELLED"`, or check if the retrieved job is in a terminal failure state before reusing it.

```js
if (idempotencyKey && this.idempotency.has(idempotencyKey)) {
    const existing = this.jobs.get(this.idempotency.get(idempotencyKey));
    if (existing && !["DEAD", "CANCELLED"].includes(existing.status)) {
        return existing;
    }
}
```

---

### 4. Stale `leaseToken` Left on Reaped Jobs

**The Problem**:
In `reapExpired()`, when a lease expires, `job.workerId` and `job.leaseUntil` are reset to `null`, but `job.leaseToken` is left intact on the object until the job is claimed again.

**How to Fix**:
Clear `job.leaseToken = null;` inside `reapExpired()` to prevent stale lease credentials from lingering on the job state.

---

## Summary Mental Model

Think of `JobQueue` like a **restaurant kitchen pass**:
* `enqueue` adds order tickets to the board.
* `claim` lets a chef grab the highest-priority order ticket and sets a timer.
* `heartbeat` is the chef shouting "still working on it!" to keep the order from being given to someone else.
* `reapExpired` catches orders left on the counter by chefs who walked out, putting them back on the queue.
