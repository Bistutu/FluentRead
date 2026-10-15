import {createHash} from 'node:crypto';

export const sha256 = value => createHash('sha256').update(value).digest('hex');
const categories = new Set(['omission', 'mistranslation', 'negation', 'numbers-units', 'reference', 'terminology', 'format']);

/** Fail closed: online samples must have explicit synthetic provenance and honest review metadata. */
export function validateCorpus(corpus) {
    if (corpus?.schemaVersion !== 1 || !Array.isArray(corpus.samples) || !corpus.samples.length) throw new Error('Invalid corpus schema');
    const ids = new Set();
    for (const sample of corpus.samples) {
        if (!sample.id || ids.has(sample.id) || typeof sample.source !== 'string' || !sample.source.trim()
            || !sample.sourceLanguage || !sample.targetLanguage || !sample.domain) throw new Error('Invalid or duplicate sample');
        ids.add(sample.id);
        if (sample.provenance?.kind !== 'synthetic' || !sample.provenance.author || !sample.provenance.createdAt) throw new Error(`Unapproved online provenance: ${sample.id}`);
        if (!['pending', 'approved', 'needs-revision'].includes(sample.humanReview?.status)) throw new Error('Missing human review status');
        if (sample.humanReview.status !== 'pending' && (!sample.humanReview.reviewer || !sample.humanReview.reviewedAt || !sample.humanReview.note)) throw new Error('Human review needs identity, date and evidence');
        if (sample.humanReview.status === 'pending' && (sample.humanReview.reviewer || sample.humanReview.reviewedAt)) throw new Error('Pending review cannot claim a human identity');
        if (!Array.isArray(sample.requirements) || !sample.requirements.length) throw new Error('Missing requirements');
        const requirementIds = new Set();
        for (const requirement of sample.requirements) {
            if (!requirement.id || requirementIds.has(requirement.id) || !categories.has(requirement.category)
                || !requirement.description || typeof requirement.requiresHumanReview !== 'boolean') throw new Error('Invalid requirement');
            requirementIds.add(requirement.id);
            if (requirement.requiresHumanReview) {
                if (requirement.check) throw new Error('Human semantic requirement cannot also claim automatic verdict');
            } else {
                const check = requirement.check;
                if (!check || !['contains', 'regex', 'exact-preservation'].includes(check.type) || typeof check.value !== 'string' || !check.value) throw new Error('Invalid automatic check');
                if (check.type === 'regex') {
                    if (check.flags && !/^[imsu]*$/u.test(check.flags)) throw new Error('Only stateless regex flags allowed');
                    new RegExp(check.value, check.flags ?? 'u');
                }
                if (check.type === 'exact-preservation' && !sample.source.includes(check.value)) throw new Error('Preservation value missing from source');
            }
        }
    }
    return corpus;
}

export function evaluateTranslation(sample, translation) {
    if (typeof translation !== 'string') throw new TypeError('Translation must be a string');
    return sample.requirements.map(requirement => {
        let status = 'needs-human-review';
        if (!requirement.requiresHumanReview) {
            const check = requirement.check;
            const clear = check.type === 'contains' ? translation.includes(check.value)
                : check.type === 'regex' ? new RegExp(check.value, check.flags ?? 'u').test(translation)
                : translation.split(check.value).length === sample.source.split(check.value).length;
            status = clear ? 'signal-clear' : 'flagged';
        }
        return {requirementId: requirement.id, category: requirement.category, status, description: requirement.description};
    });
}

export function classifyFailure(error, events = [], timedOut = false, cancelled = false) {
    const observedHttpStatus = events.findLast(event => event.status >= 400)?.status ?? events.at(-1)?.status;
    const providerStatus = error?.statusCode ?? error?.status;
    const status = providerStatus ?? observedHttpStatus;
    const explicit = ({request: 'request', 'rate-limit': 'rate-limit', quota: 'quota', blocked: 'blocked', unavailable: 'service'})[error?.freeFailure];
    const category = cancelled ? 'cancelled' : timedOut || events.at(-1)?.aborted ? 'timeout' : events.at(-1)?.networkError ? 'network' : explicit ? explicit
        : status === 429 ? 'rate-limit' : status === 402 || status === 456 ? 'quota'
        : status === 401 || status === 403 ? 'blocked'
        : status >= 500 ? 'service' : status >= 400 ? 'request'
        : observedHttpStatus ? 'response' : 'unavailable';
    // Never persist arbitrary provider errors which can contain signed URLs or token fields.
    return {category, message: `${category}${observedHttpStatus ? ` (HTTP ${observedHttpStatus})` : ''}`,
        ...(providerStatus ? {providerStatus} : {}), ...(observedHttpStatus ? {observedHttpStatus} : {})};
}

/** An observed provider refusal still applies when the response body later times out. */
export function providerDeferral(error, events = [], now = Date.now()) {
    const categoryForStatus = status => status === 429 ? 'rate-limit' : status === 402 || status === 456 ? 'quota'
        : status === 401 || status === 403 ? 'blocked' : undefined;
    const refusal = events.findLast(event => categoryForStatus(event.status));
    const explicit = ['blocked', 'rate-limit', 'quota'].includes(error?.freeFailure) ? error.freeFailure : undefined;
    const category = categoryForStatus(refusal?.status) ?? explicit ?? categoryForStatus(error?.statusCode ?? error?.status);
    if (!category) return undefined;
    const retryTimes = events.map(event => event.retryAt).filter(value => Number.isFinite(value) && Number.isFinite(new Date(value).getTime()));
    return {category, retryAt: Math.max(now + (category === 'rate-limit' ? 300_000 : 86_400_000), ...retryTimes)};
}

/**
 * Keep the execution plan, recorded outcomes and HTTP activity separate. A resumed
 * unit may produce several records; a cooling-down record never calls the adapter.
 * Counting version 2 corrects attempted (formerly all records, including deferrals).
 * Historical reports without a saved plan have unknown planned counts.
 */
export function summarize(runs, plan) {
    if (plan !== undefined && plan !== null && (!Array.isArray(plan.sampleIds) || !plan.sampleIds.length
        || !Array.isArray(plan.providerIds) || !plan.providerIds.length || typeof plan.configurationId !== 'string' || !plan.configurationId
        || !Number.isInteger(plan.repeats) || plan.repeats < 1
        || [...plan.sampleIds, ...plan.providerIds].some(id => typeof id !== 'string' || !id)
        || new Set(plan.sampleIds).size !== plan.sampleIds.length || new Set(plan.providerIds).size !== plan.providerIds.length)) {
        throw new Error('Invalid evaluation plan');
    }
    const groups = new Map();
    const makeGroup = (providerId, configurationId) => ({countingVersion: 2, providerId, configurationId,
        planned: plan?.providerIds.includes(providerId) && plan.configurationId === configurationId ? plan.sampleIds.length * plan.repeats : null,
        recordedRuns: 0, attempted: 0, requested: 0, returned: 0, deferred: 0, cancelled: 0, failed: 0,
        flagged: 0, pendingHuman: 0, failures: Object.create(null), httpRequests: 0, latencies: []});
    // Preserve planned providers even if cancellation happens before their first turn.
    for (const providerId of plan?.providerIds ?? []) {
        groups.set(JSON.stringify([providerId, plan.configurationId]), makeGroup(providerId, plan.configurationId));
    }
    for (const run of runs) {
        const key = JSON.stringify([run.providerId, run.configurationId]);
        const group = groups.get(key) ?? makeGroup(run.providerId, run.configurationId);
        const failureCategory = typeof run.failure?.category === 'string' && run.failure.category.trim()
            ? run.failure.category : run.status === 'cancelled' ? 'cancelled' : 'unknown';
        const deferred = run.status === 'failure' && failureCategory === 'deferred';
        group.recordedRuns++;
        group.attempted += Number(!deferred);
        group.requested += Number(run.cost.httpRequests > 0);
        group.deferred += Number(deferred);
        group.cancelled += Number(run.status === 'cancelled');
        group.failed += Number(run.status === 'failure' && !deferred);
        group.httpRequests += run.cost.httpRequests;
        if (run.status === 'success') {
            group.returned++;
            group.flagged += Number(run.checks.some(check => check.status === 'flagged'));
            group.pendingHuman += Number(run.checks.some(check => check.status === 'needs-human-review'));
            group.latencies.push(run.durationMs);
        } else group.failures[failureCategory] = (group.failures[failureCategory] ?? 0) + 1;
        groups.set(key, group);
    }
    return [...groups.values()].map(({latencies, ...group}) => ({...group,
        medianLatencyMs: latencies.length ? [...latencies].sort((a, b) => a - b).slice(Math.floor((latencies.length - 1) / 2), Math.floor(latencies.length / 2) + 1).reduce((sum, value, _, values) => sum + value / values.length, 0) : null,
        note: 'Planned counts unique sample/repeat units; null means no saved plan. Recorded runs include resumed attempts and deferrals. Attempted counts adapter executions and excludes deferrals; requested counts runs with at least one HTTP attempt, while httpRequests includes retries and authentication. Returned counts successful runs. Deferred, cancelled and failed are separate outcomes; failures retains the legacy classification of all non-success records. No success rate or semantic accuracy is inferred; latency describes successful returns only.'}));
}

/** Paired evidence, never compare different source text or invent a score for network failures. */
export function compareReports(before, after) {
    const samples = new Map(before.corpus.samples.map(sample => [sample.id, sample]));
    const runKey = run => JSON.stringify([run.sampleId, run.providerId, run.configurationId, run.repeat]);
    const previous = new Map(before.runs.map(run => [runKey(run), run]));
    return after.runs.flatMap(run => {
        const sample = after.corpus.samples.find(item => item.id === run.sampleId);
        if (JSON.stringify(sample) !== JSON.stringify(samples.get(run.sampleId))) return [];
        const prior = previous.get(runKey(run));
        if (!prior) return [];
        const beforeFlags = prior.checks.filter(check => check.status === 'flagged').map(check => check.requirementId);
        const afterFlags = run.checks.filter(check => check.status === 'flagged').map(check => check.requirementId);
        const compatibleSettings = before.environment?.mode === after.environment?.mode
            && before.environment?.configuration === after.environment?.configuration
            && before.environment?.timeoutMs === after.environment?.timeoutMs;
        const comparable = compatibleSettings && prior.status === 'success' && run.status === 'success';
        return [{sampleId: run.sampleId, providerId: run.providerId, configurationId: run.configurationId, repeat: run.repeat,
            beforeStatus: prior.status, afterStatus: run.status, comparable, compatibleSettings,
            resolvedSignals: comparable ? beforeFlags.filter(id => !afterFlags.includes(id)) : [],
            newSignals: comparable ? afterFlags.filter(id => !beforeFlags.includes(id)) : [],
            outputChanged: comparable ? prior.translation !== run.translation : null,
            latencyDeltaMs: comparable ? run.durationMs - prior.durationMs : null,
            semanticReview: 'pending'}];
    });
}
