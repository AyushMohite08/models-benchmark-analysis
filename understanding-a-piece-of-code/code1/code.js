class NewsCache {
    constructor(ttl = 5000, staleTtl = 15000) {
        this.ttl = ttl;
        this.staleTtl = staleTtl;
        this.cache = new Map();
        this.pending = new Map();
    }

    async get(key, fetcher) {
        const now = Date.now();
        const entry = this.cache.get(key);

        if (entry && now < entry.expiresAt) {
            return entry.data;
        }

        if (entry && now < entry.staleUntil) {
            this.refresh(key, fetcher);
            return entry.data;
        }

        if (this.pending.has(key)) {
            return this.pending.get(key);
        }

        const request = (async () => {
            try {
                const data = await fetcher();

                this.cache.set(key, {
                    data,
                    expiresAt: Date.now() + this.ttl,
                    staleUntil: Date.now() + this.ttl + this.staleTtl
                });

                return data;
            } finally {
                this.pending.delete(key);
            }
        })();

        this.pending.set(key, request);
        return request;
    }

    async refresh(key, fetcher) {
        if (this.pending.has(key)) return;

        const request = (async () => {
            try {
                const data = await fetcher();

                this.cache.set(key, {
                    data,
                    expiresAt: Date.now() + this.ttl,
                    staleUntil: Date.now() + this.ttl + this.staleTtl
                });
            } catch (error) {
                console.error("Background refresh failed:", error);
            } finally {
                this.pending.delete(key);
            }
        })();

        this.pending.set(key, request);
    }
}