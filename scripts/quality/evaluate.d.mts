export function sha256(value: string | Uint8Array): string;
export function validateCorpus<T>(corpus: T): T;
export function evaluateTranslation(sample: any, translation: string): any[];
export function classifyFailure(error: any, events?: any[], timedOut?: boolean, cancelled?: boolean): any;
export function providerDeferral(error: any, events?: any[], now?: number): {category: string; retryAt: number} | undefined;
export function summarize(runs: any[]): any[];
export function compareReports(before: any, after: any): any[];
