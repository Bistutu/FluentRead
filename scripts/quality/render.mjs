#!/usr/bin/env node
// Regenerate a standalone view from immutable JSON without contacting providers.
import {readFile, writeFile} from 'node:fs/promises';
import {renderQualityReport} from './report.mjs';
const [input, output] = process.argv.slice(2);
if (!input || !output) throw new Error('Usage: node scripts/quality/render.mjs <report.json> <report.html>');
const report = JSON.parse(await readFile(input, 'utf8'));
if (report.schemaVersion !== 1 || !Array.isArray(report.runs) || !Array.isArray(report.corpus?.samples)) throw new Error('Invalid quality report');
await writeFile(output, renderQualityReport(report));
