class JobQueue {
    constructor({
        maxAttempts = 4,
        leaseMs = 5000,
        baseDelayMs = 1000,
        maxDelayMs = 30000
    } = {}) {
        this.maxAttempts = maxAttempts;
        this.leaseMs = leaseMs;
        this.baseDelayMs = baseDelayMs;
        this.maxDelayMs = maxDelayMs;

        this.jobs = new Map();
        this.idempotency = new Map();
        this.nextId = 1;
        this.nextToken = 1;
    }

    enqueue(type, payload, {
        priority = 0,
        delayMs = 0,
        idempotencyKey
    } = {}) {
        if (idempotencyKey && this.idempotency.has(idempotencyKey)) {
            return this.jobs.get(this.idempotency.get(idempotencyKey));
        }

        const now = Date.now();
        const job = {
            id: this.nextId++,
            type,
            payload,
            priority,
            status: delayMs > 0 ? "SCHEDULED" : "QUEUED",
            attempts: 0,
            availableAt: now + delayMs,
            createdAt: now,
            workerId: null,
            leaseUntil: null,
            leaseToken: null,
            result: null,
            error: null
        };

        this.jobs.set(job.id, job);

        if (idempotencyKey) {
            this.idempotency.set(idempotencyKey, job.id);
        }

        return job;
    }

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

    heartbeat(jobId, workerId, leaseToken) {
        const job = this.jobs.get(jobId);

        if (
            !job ||
            job.status !== "RUNNING" ||
            job.workerId !== workerId ||
            job.leaseToken !== leaseToken
        ) {
            return false;
        }

        job.leaseUntil = Date.now() + this.leaseMs;
        return true;
    }

    acknowledge(jobId, workerId, leaseToken, result) {
        const job = this.jobs.get(jobId);

        if (
            !job ||
            job.status !== "RUNNING" ||
            job.workerId !== workerId ||
            job.leaseToken !== leaseToken
        ) {
            return false;
        }

        job.status = "COMPLETED";
        job.result = result;
        job.workerId = null;
        job.leaseUntil = null;

        return true;
    }

    fail(jobId, workerId, leaseToken, error) {
        const job = this.jobs.get(jobId);

        if (
            !job ||
            job.status !== "RUNNING" ||
            job.workerId !== workerId ||
            job.leaseToken !== leaseToken
        ) {
            return false;
        }

        job.error = String(error);
        job.workerId = null;
        job.leaseUntil = null;

        if (job.attempts >= this.maxAttempts) {
            job.status = "DEAD";
        } else {
            const delay = Math.min(
                this.baseDelayMs * 2 ** (job.attempts - 1),
                this.maxDelayMs
            );

            job.status = "SCHEDULED";
            job.availableAt = Date.now() + delay;
        }

        return true;
    }

    promoteDue() {
        const now = Date.now();

        for (const job of this.jobs.values()) {
            if (
                job.status === "SCHEDULED" &&
                job.availableAt <= now
            ) {
                job.status = "QUEUED";
            }
        }
    }

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

    cancel(jobId) {
        const job = this.jobs.get(jobId);

        if (
            !job ||
            ["COMPLETED", "DEAD", "CANCELLED"].includes(job.status)
        ) {
            return false;
        }

        job.status = "CANCELLED";
        job.workerId = null;
        job.leaseUntil = null;

        return true;
    }

    getJob(jobId) {
        const job = this.jobs.get(jobId);
        return job ? { ...job } : null;
    }

    getStats() {
        const stats = {};

        for (const job of this.jobs.values()) {
            stats[job.status] = (stats[job.status] || 0) + 1;
        }

        return stats;
    }
}