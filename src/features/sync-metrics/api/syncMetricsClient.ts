import type {
    SyncRunMeta,
    SyncRunPayload,
    SyncRunSummary,
} from "../types/syncMetrics";

/** Same-origin path; next.config rewrites /v1/* to the backend. */
const BASE = "/v1/sync-metrics";

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const token =
        typeof window !== "undefined"
            ? localStorage.getItem("access_token")
            : null;
    const response = await fetch(`${BASE}${path}`, {
        ...init,
        headers: {
            ...(init.body ? { "content-type": "application/json" } : {}),
            ...(token ? { authorization: `Bearer ${token}` } : {}),
            ...init.headers,
        },
    });

    const body = await response.json().catch(() => null);
    if (!response.ok) {
        const message = body?.message ?? body?.error ?? response.statusText;
        throw new Error(
            `${response.status}: ${Array.isArray(message) ? message.join(", ") : message}`,
        );
    }
    // Unwrap the backend TransformationInterceptor envelope.
    return (body?.data ?? body) as T;
}

export const syncMetricsClient = {
    async listRuns(): Promise<SyncRunSummary[]> {
        return (await request<{ runs: SyncRunSummary[] }>("/runs")).runs;
    },

    getRun(runId: string, since?: number): Promise<SyncRunPayload> {
        const query = since !== undefined ? `?since=${since}` : "";
        return request<SyncRunPayload>(
            `/runs/${encodeURIComponent(runId)}${query}`,
        );
    },

    async updateRun(
        runId: string,
        patch: { notes?: string; tags?: string[] },
    ): Promise<SyncRunMeta> {
        return (
            await request<{ meta: SyncRunMeta }>(
                `/runs/${encodeURIComponent(runId)}`,
                {
                    method: "PATCH",
                    body: JSON.stringify(patch),
                },
            )
        ).meta;
    },

    deleteRun(runId: string): Promise<{ deleted: string }> {
        return request(`/runs/${encodeURIComponent(runId)}`, {
            method: "DELETE",
        });
    },
};

/** A run is "live" while clients are still uploading (batches every 5 s). */
export const LIVE_WINDOW_MS = 15_000;
