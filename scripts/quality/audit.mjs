#!/usr/bin/env node
// Preserve the raw report; annotate only classifications contradicted by its own transport evidence.
import {readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {sha256, summarize} from './evaluate.mjs';
import {renderQualityReport} from './report.mjs';
const [input, output] = process.argv.slice(2);
if (!input || !output || path.resolve(input) === path.resolve(output)) throw new Error('Usage: node scripts/quality/audit.mjs <raw-report.json> <new-audited-report.json>');
const raw = await readFile(input, 'utf8');
const report = JSON.parse(raw);
const corrections = [];
for (const [index, run] of report.runs.entries()) {
    if (run.status === 'failure' && run.failure.category === 'response' && Array.isArray(run.transport)
        && run.transport.every(event => event.status === null && !event.networkError)) {
        corrections.push({runIndex: index, sampleId: run.sampleId, providerId: run.providerId,
            previous: run.failure, replacement: 'unavailable',
            reason: 'No HTTP response headers were observed. Earlier observer did not record adapter-local aborts; timeout versus local cooldown cannot be inferred retrospectively. This is not a semantic response failure.'});
        run.failure = {category: 'unavailable', message: 'No response headers; adapter-local abort or unavailable route. Exact cause was not recorded by the original observer.'};
    }
}
report.audit = {rawReportId: report.id, rawReportSha256: sha256(raw), corrections,
    auditToolSha256: sha256(await readFile(new URL(import.meta.url))),
    rendererSha256: sha256(await readFile(new URL('./report.mjs', import.meta.url))),
    method: 'Evidence-only correction; translations, requests, byte counts, durations and raw source/tool hashes are unchanged.'};
report.id += '-audited';
report.summary = summarize(report.runs, report.plan);
await writeFile(output, JSON.stringify(report, null, 2) + '\n');
await writeFile(output.replace(/\.json$/u, '') + '.html', renderQualityReport(report));
