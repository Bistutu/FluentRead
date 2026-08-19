import {readFileSync} from 'node:fs';

export const exampleRoot = new URL('../examples/document-translation/', import.meta.url);

export const DOCUMENT_EXAMPLES = [
    {fileName: 'sample.html', format: 'html', markers: ['<a href="https://example.com">', 'const untouched = true;']},
    {fileName: 'sample.txt', format: 'txt', markers: ['\n\n', 'Keep the line structure intact.']},
    {fileName: 'sample.md', format: 'markdown', markers: ['```js', '[Reference link](https://example.com)']},
    {fileName: 'sample.srt', format: 'srt', markers: ['00:00:01,000 --> 00:00:03,000', '<i>Hello subtitle</i>']},
    {fileName: 'sample.vtt', format: 'vtt', markers: ['WEBVTT', '00:00:01.000 --> 00:00:03.000']},
    {fileName: 'sample.ass', format: 'ass', markers: ['[Events]', 'Dialogue:', '{\\i1}']},
    {fileName: 'sample.ssa', format: 'ass', markers: ['[Events]', 'Dialogue:', '{\\i1}']},
    {fileName: 'sample.lrc', format: 'lrc', markers: ['[ti:Document translation example]', '[00:01.00]']},
    {fileName: 'sample.json', format: 'json', markers: ['"keepNumber": 42']},
] as const;

export type DocumentExample = (typeof DOCUMENT_EXAMPLES)[number];

export function loadExample(fileName: string): string {
    return readFileSync(new URL(fileName, exampleRoot), 'utf8');
}
