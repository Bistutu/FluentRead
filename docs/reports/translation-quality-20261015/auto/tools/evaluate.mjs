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
    const category = cancelled ? 'cancelled' : timedOut ? 'timeout' : events.at(-1)?.networkError ? 'network' : explicit ? explicit
        : status === 429 ? 'rate-limit' : status === 402 || status === 456 ? 'quota'
        : status === 401 || status === 403 ? 'blocked'
        : status >= 500 ? 'service' : status >= 400 ? 'request'
        : 'response';
    // Never persist arbitrary provider errors which can contain signed URLs or token fields.
    return {category, message: `${category}${observedHttpStatus ? ` (HTTP ${observedHttpStatus})` : ''}`,
        ...(providerStatus ? {providerStatus} : {}), ...(observedHttpStatus ? {observedHttpStatus} : {})};
}

export function summarize(runs) {
    const groups = new Map();
    for (const run of runs) {
        const key = `${run.providerId}/${run.configurationId}`;
        const group = groups.get(key) ?? {providerId: run.providerId, configurationId: run.configurationId, attempted: 0, returned: 0, flagged: 0, pendingHuman: 0, failures: {}, httpRequests: 0, latencies: []};
        group.attempted++;
        group.httpRequests += run.cost.httpRequests;
        if (run.status === 'success') {
            group.returned++;
            group.flagged += Number(run.checks.some(check => check.status === 'flagged'));
            group.pendingHuman += Number(run.checks.some(check => check.status === 'needs-human-review'));
            group.latencies.push(run.durationMs);
        } else group.failures[run.failure.category] = (group.failures[run.failure.category] ?? 0) + 1;
        groups.set(key, group);
    }
    return [...groups.values()].map(({latencies, ...group}) => ({...group,
        medianLatencyMs: latencies.length ? [...latencies].sort((a, b) => a - b).slice(Math.floor((latencies.length - 1) / 2), Math.floor(latencies.length / 2) + 1).reduce((sum, value, _, values) => sum + value / values.length, 0) : null,
        note: 'Automatic signals are not semantic accuracy; latency describes successful returns only.'}));
}

/** Paired evidence, never compare different source text or invent a score for network failures. */
export function compareReports(before, after) {
    const samples = new Map(before.corpus.samples.map(sample => [sample.id, sample]));
    const previous = new Map(before.runs.map(run => [[run.sampleId, run.providerId, run.configurationId, run.repeat].join('/'), run]));
    return after.runs.flatMap(run => {
        const sample = after.corpus.samples.find(item => item.id === run.sampleId);
        if (JSON.stringify(sample) !== JSON.stringify(samples.get(run.sampleId))) return [];
        const prior = previous.get([run.sampleId, run.providerId, run.configurationId, run.repeat].join('/'));
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
