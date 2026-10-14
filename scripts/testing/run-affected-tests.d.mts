export interface TestMatrix {
    groups: Partial<Record<'architecture' | 'unit' | 'functional' | 'regression', string[]>>;
}
export interface AffectedPlan {
    changed: string[];
    testFiles: string[];
    coverageFiles: string[];
    globalInputs: string[];
    reason: 'shared-test-configuration' | 'changed-dependency-graph';
    extensionChanged: boolean;
    base?: string;
    head?: string;
}
export function changedPaths(root: string, base: string): {base: string; paths: string[]};
export function strictCoveragePaths(source: string): string[];
export function coverageRuntimeSignature(source: string): string;
export function buildDependencyGraph(files: Record<string, string>): Map<string, Set<string>>;
export function selectAffected(input: {files: Record<string, string>; changed: string[]; matrix: TestMatrix; coveragePaths: string[]; coverageAdded?: string[]; coverageRuntimeChanged?: boolean}): AffectedPlan;
export function createPlan(root: string, base: string): AffectedPlan;
export function scopedCoverageConfig(plan: AffectedPlan, baseConfigUrl: string): string;
export function testInvocation(plan: Pick<AffectedPlan, 'testFiles' | 'coverageFiles'>, configPath: string): string[] | null;
export function executePlan(root: string, plan: AffectedPlan, runner?: (root: string, args: string[]) => Promise<{code: number | null; signal: string | null}>): Promise<{skipped: boolean; reason?: string}>;
export function main(argv?: string[], env?: NodeJS.ProcessEnv): Promise<void>;
