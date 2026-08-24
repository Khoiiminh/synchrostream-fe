export class RemotePlaybackGuard {
    private active = false;

    get isActive(): boolean {
        return this.active;
    }

    run<T>(operation: () => T): T {
        this.active = true;

        try {
            return operation();
        } finally {
            this.active = false;
        }
    }

    async runAsync<T>(operation: () => Promise<T>): Promise<T> {
        this.active = true;

        try {
            return await operation();
        } finally {
            this.active = false;
        }
    }
}