export function sha256(value: string | Uint8Array): string;
export function validateCorpus<T>(corpus: T): T;
export function evaluateTranslation(sample: any, translation: string): any[];
export function classifyFailure(error: any, events?: any[], timedOut?: boolean, cancelled?: boolean): any;
export function providerDeferral(error: any, events?: any[], now?: number): {category: string; retryAt: number} | undefined;
export interface QualityEvaluationPlan {
    sampleIds: string[];
    providerIds: string[];
    configurationId: string;
    repeats: number;
}
export interface QualityEvaluationSummary {
    countingVersion: 2;
    providerId: string;
    configurationId: string;
    planned: number | null;
    recordedRuns: number;
    attempted: number;
    requested: number;
    returned: number;
    deferred: number;
    cancelled: number;
    failed: number;
    flagged: number;
    pendingHuman: number;
    /** Legacy distribution of all non-success records, including cancelled/deferred. */
    failures: Record<string, number>;
    httpRequests: number;
    medianLatencyMs: number | null;
    note: string;
}
export function summarize(runs: any[], plan?: QualityEvaluationPlan | null): QualityEvaluationSummary[];
export function compareReports(before: any, after: any): any[];
