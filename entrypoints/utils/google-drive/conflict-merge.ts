import { normalizeConfig, type Config } from '@/entrypoints/utils/model';

export interface FieldConflict {
    path: string[];
    baseValue: unknown;
    localValue: unknown;
    remoteValue: unknown;
}

export interface DiffConflictsResult {
    draft: Config;
    conflicts: FieldConflict[];
}

export type ConflictResolution = 'local' | 'remote';

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function configValuesEqual(left: unknown, right: unknown): boolean {
    if (Object.is(left, right)) return true;
    if (Array.isArray(left) || Array.isArray(right)) {
        if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
        return left.every((value, index) => configValuesEqual(value, right[index]));
    }
    if (isRecord(left) || isRecord(right)) {
        if (!isRecord(left) || !isRecord(right)) return false;
        const leftKeys = Object.keys(left);
        const rightKeys = Object.keys(right);
        if (leftKeys.length !== rightKeys.length) return false;
        return leftKeys.every((key) => Object.prototype.hasOwnProperty.call(right, key)
            && configValuesEqual(left[key], right[key]));
    }
    return false;
}

function isAtomicValue(value: unknown): boolean {
    return value === null || value === undefined || typeof value !== 'object' || Array.isArray(value);
}

/**
 * Build a three-way merge draft. A changed leaf is kept at the base value
 * until the user explicitly chooses local or remote, matching read-frog's
 * conservative conflict UI.
 */
export function detectConflicts(base: Config, local: Config, remote: Config): DiffConflictsResult {
    const conflicts: FieldConflict[] = [];

    function traverse(path: string[], baseValue: unknown, localValue: unknown, remoteValue: unknown): unknown {
        if (isAtomicValue(baseValue) || isAtomicValue(localValue) || isAtomicValue(remoteValue)) {
            const localChanged = !configValuesEqual(localValue, baseValue);
            const remoteChanged = !configValuesEqual(remoteValue, baseValue);
            if (localChanged && remoteChanged && configValuesEqual(localValue, remoteValue)) return localValue;
            if (localChanged || remoteChanged) {
                conflicts.push({path, baseValue, localValue, remoteValue});
            }
            return baseValue;
        }

        if (!isRecord(baseValue) || !isRecord(localValue) || !isRecord(remoteValue)) {
            return baseValue;
        }

        const result: Record<string, unknown> = {};
        const keys = new Set([
            ...Object.keys(baseValue),
            ...Object.keys(localValue),
            ...Object.keys(remoteValue),
        ]);
        for (const key of keys) {
            result[key] = traverse(
                [...path, key],
                baseValue[key],
                localValue[key],
                remoteValue[key],
            );
        }
        return result;
    }

    return {
        draft: normalizeConfig(traverse([], base, local, remote)),
        conflicts,
    };
}

function applyFieldResolution(
    result: Record<string, unknown>,
    conflict: FieldConflict,
    resolution: ConflictResolution,
): void {
    if (conflict.path.length === 0) return;
    let current: Record<string, unknown> = result;
    for (let index = 0; index < conflict.path.length - 1; index += 1) {
        const next = current[conflict.path[index]!];
        if (!isRecord(next)) return;
        current = next;
    }
    current[conflict.path.at(-1)!] = resolution === 'local' ? conflict.localValue : conflict.remoteValue;
}

export interface ApplyResolutionsResult {
    config: Config;
    validationError: string | null;
}

export function applyResolutions(
    diffConflictsResult: DiffConflictsResult,
    resolutions: Record<string, ConflictResolution>,
): ApplyResolutionsResult {
    const result = structuredClone(diffConflictsResult.draft) as unknown as Record<string, unknown>;
    for (const conflict of diffConflictsResult.conflicts) {
        const resolution = resolutions[conflict.path.join('.')];
        if (resolution) applyFieldResolution(result, conflict, resolution);
    }

    const config = normalizeConfig(result);
    if (!configValuesEqual(config.on, true) && !configValuesEqual(config.on, false)) {
        return {config, validationError: '插件状态字段无效'};
    }
    return {config, validationError: null};
}
