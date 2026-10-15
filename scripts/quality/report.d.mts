/** 可离线呈现的质量评测证据；人工状态始终独立于自动检查。 */
import type {QualityEvaluationPlan} from './evaluate.mjs';
export interface QualityRequirement {
    id: string;
    category: string;
    severity: string;
    description: string;
    requiresHumanReview: boolean;
    check?: unknown;
}

export interface QualitySample {
    id: string;
    domain: string;
    sourceLanguage: string;
    targetLanguage: string;
    source: string;
    sourceContext?: unknown;
    provenance?: unknown;
    humanReview: unknown;
    requirements: QualityRequirement[];
    [key: string]: unknown;
}

export interface QualityCheck {
    requirementId: string;
    category: string;
    status: 'signal-clear' | 'flagged' | 'needs-human-review';
    description: string;
}

export interface QualityRun {
    sampleId: string;
    providerId: string;
    configurationId: string;
    repeat: number;
    status: 'success' | 'failure' | 'cancelled';
    translation?: string;
    durationMs: number;
    cost: {
        httpRequests: number;
        inputCharacters: number;
        requestBytes: number | null;
        responseBytes: number | null;
        monetaryCost: number | null;
        unit: string;
        note: string;
    };
    failure?: {category: string; message: string};
    checks: QualityCheck[];
    review: {status: string};
    [key: string]: unknown;
}

export interface QualityReport {
    schemaVersion: 1;
    id: string;
    createdAt: string;
    corpus: {id: string; sha256: string; samples: QualitySample[]; [key: string]: unknown};
    environment: Record<string, unknown>;
    runs: QualityRun[];
    plan?: QualityEvaluationPlan;
    comparison?: unknown;
    [key: string]: unknown;
}

export interface QualityReviewTemplate {
    schemaVersion: 1;
    reportId: string;
    corpusId: string;
    corpusSha256: string;
    instructions: string;
    reviewer: null;
    reviewedAt: null;
    status: 'pending';
    entries: Array<{
        runIndex: number;
        sampleId: string;
        providerId: string;
        configurationId: string;
        repeat: number;
        source: string | null;
        sourceContext: unknown;
        sourceProvenance: unknown;
        sourceHumanReview: unknown;
        translation: string | null;
        executionStatus: QualityRun['status'];
        failure: QualityRun['failure'] | null;
        automaticChecks: QualityCheck[];
        review: {status: 'pending'; notes: string; requirements: Array<{
            id: string;
            category: string;
            severity: string;
            description: string;
            verdict: null;
            evidence: string;
        }>};
    }>;
}

export function createReviewTemplate(report: QualityReport, runIndexes?: number[]): QualityReviewTemplate;
export function renderQualityReport(report: QualityReport): string;
