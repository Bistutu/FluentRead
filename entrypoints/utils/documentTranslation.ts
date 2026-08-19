export const DOCUMENT_MAX_BYTES = 10 * 1024 * 1024;

export const SUPPORTED_DOCUMENT_EXTENSIONS = [
    'html',
    'htm',
    'txt',
    'md',
    'markdown',
    'srt',
    'vtt',
    'ass',
    'ssa',
    'lrc',
    'json',
] as const;

export type DocumentFormat =
    | 'html'
    | 'txt'
    | 'markdown'
    | 'srt'
    | 'vtt'
    | 'ass'
    | 'lrc'
    | 'json';

export type DocumentRenderMode = 'bilingual' | 'translated';

export interface DocumentSegment {
    id: number;
    source: string;
}

interface LiteralPart {
    kind: 'literal';
    value: string;
}

interface SegmentPart {
    kind: 'segment';
    segmentIndex: number;
    source: string;
    prefix: string;
    suffix: string;
    /** Repeat a structural prefix when a bilingual line needs a second cue. */
    bilingualPrefix?: string;
}

type DocumentPart = LiteralPart | SegmentPart;

interface JsonSegmentEntry {
    path: Array<string | number>;
    segmentIndex: number;
    prefix: string;
    suffix: string;
}

export interface ParsedDocument {
    fileName: string;
    format: DocumentFormat;
    label: string;
    parts: readonly DocumentPart[];
    segments: readonly DocumentSegment[];
    jsonValue?: unknown;
    jsonEntries?: readonly JsonSegmentEntry[];
}

const FORMAT_LABELS: Record<DocumentFormat, string> = {
    html: 'HTML 文件',
    txt: 'TXT 文件',
    markdown: 'Markdown 文件',
    srt: 'SRT 字幕',
    vtt: 'VTT 字幕',
    ass: 'ASS 字幕',
    lrc: 'LRC 歌词',
    json: 'JSON 文件',
};

const PROTECTED_HTML_TAGS = new Set(['script', 'style', 'pre', 'code', 'textarea']);
const HTML_TOKEN_PATTERN = /<!--[\s\S]*?-->|<![^>]*>|<[^>]+>/gu;
const MARKDOWN_PROTECTED_PATTERN = /(`{1,3}[^`\n]+`{1,3}|!\[[^\]]*\]\([^)]+\)|\[[^\]]+\]\((?:https?:\/\/|#)[^)]+\)|<https?:\/\/[^>]+>|https?:\/\/[^\s)]+)/gu;
const TIMED_SUBTITLE_PATTERN = /^\s*(?:\d{1,3}:)?\d{2}:\d{2}[,.]\d{3}\s*-->\s*(?:\d{1,3}:)?\d{2}:\d{2}[,.]\d{3}(?:\s+.*)?$/u;
const LRC_TIME_PATTERN = /^(\s*(?:\[[^\]\r\n]+\])+)/u;

function extensionOf(fileName: string): string {
    const match = fileName.toLowerCase().match(/\.([a-z0-9]+)$/u);
    return match?.[1] || '';
}

export function getDocumentFormat(fileName: string): DocumentFormat | null {
    const extension = extensionOf(fileName);
    if (extension === 'html' || extension === 'htm') return 'html';
    if (extension === 'txt') return 'txt';
    if (extension === 'md' || extension === 'markdown') return 'markdown';
    if (extension === 'srt') return 'srt';
    if (extension === 'vtt') return 'vtt';
    if (extension === 'ass' || extension === 'ssa') return 'ass';
    if (extension === 'lrc') return 'lrc';
    if (extension === 'json') return 'json';
    return null;
}

export function getDocumentAcceptAttribute(): string {
    return SUPPORTED_DOCUMENT_EXTENSIONS.map((extension) => `.${extension}`).join(',');
}

export function getDocumentFormatLabel(format: DocumentFormat): string {
    return FORMAT_LABELS[format];
}

export function getDocumentMimeType(format: DocumentFormat): string {
    if (format === 'html') return 'text/html;charset=utf-8';
    if (format === 'json') return 'application/json;charset=utf-8';
    return 'text/plain;charset=utf-8';
}

function trimSource(value: string): {prefix: string; source: string; suffix: string} | null {
    const match = value.match(/^(\s*)([\s\S]*?\S)(\s*)$/u);
    if (!match) return null;
    return {prefix: match[1], source: match[2], suffix: match[3]};
}

function addLiteral(parts: DocumentPart[], value: string): void {
    if (!value) return;
    const last = parts[parts.length - 1];
    if (last?.kind === 'literal') {
        last.value += value;
        return;
    }
    parts.push({kind: 'literal', value});
}

function addSegment(
    parts: DocumentPart[],
    segments: DocumentSegment[],
    value: string,
    options: Pick<SegmentPart, 'bilingualPrefix'> = {},
): void {
    const trimmed = trimSource(value);
    if (!trimmed) {
        addLiteral(parts, value);
        return;
    }

    const segmentIndex = segments.length;
    segments.push({id: segmentIndex, source: trimmed.source});
    parts.push({
        kind: 'segment',
        segmentIndex,
        source: trimmed.source,
        prefix: trimmed.prefix,
        suffix: trimmed.suffix,
        ...options,
    });
}

function addProtectedText(
    parts: DocumentPart[],
    segments: DocumentSegment[],
    value: string,
    pattern: RegExp,
    options: Pick<SegmentPart, 'bilingualPrefix'> = {},
): void {
    pattern.lastIndex = 0;
    let cursor = 0;
    let match = pattern.exec(value);
    while (match) {
        addSegment(parts, segments, value.slice(cursor, match.index), options);
        addLiteral(parts, match[0]);
        cursor = match.index + match[0].length;
        match = pattern.exec(value);
    }
    addSegment(parts, segments, value.slice(cursor), options);
}

function splitWithEndings(value: string): Array<{start: number; end: number; textEnd: number; text: string}> {
    const lines: Array<{start: number; end: number; textEnd: number; text: string}> = [];
    const pattern = /[^\r\n]*(?:\r\n|\n|\r|$)/gu;
    let match = pattern.exec(value);
    while (match) {
        if (match[0] === '' && match.index === value.length) break;
        const raw = match[0];
        const endingLength = raw.endsWith('\r\n') ? 2 : raw.endsWith('\n') || raw.endsWith('\r') ? 1 : 0;
        const start = match.index;
        const end = start + raw.length;
        lines.push({
            start,
            end,
            textEnd: end - endingLength,
            text: raw.slice(0, raw.length - endingLength),
        });
        match = pattern.exec(value);
    }
    return lines;
}

function parseTextDocument(content: string, format: 'txt' | 'markdown'): Pick<ParsedDocument, 'parts' | 'segments'> {
    const parts: DocumentPart[] = [];
    const segments: DocumentSegment[] = [];
    const lines = splitWithEndings(content);
    let inFence = false;

    lines.forEach((line) => {
        const fence = /^\s*(`{3,}|~{3,})/u.test(line.text);
        const horizontalRule = /^\s*(?:[-*_]\s*){3,}$/u.test(line.text);
        if (format === 'markdown' && (fence || inFence || horizontalRule)) {
            addLiteral(parts, content.slice(line.start, line.end));
            if (fence) inFence = !inFence;
            return;
        }

        if (format === 'markdown') {
            addProtectedText(parts, segments, line.text, MARKDOWN_PROTECTED_PATTERN);
        } else {
            addSegment(parts, segments, line.text);
        }
        addLiteral(parts, content.slice(line.textEnd, line.end));
    });

    return {parts, segments};
}

function parseHtmlDocument(content: string): Pick<ParsedDocument, 'parts' | 'segments'> {
    const parts: DocumentPart[] = [];
    const segments: DocumentSegment[] = [];
    let cursor = 0;
    let protectedTag = '';

    HTML_TOKEN_PATTERN.lastIndex = 0;
    let match = HTML_TOKEN_PATTERN.exec(content);
    while (match) {
        const tag = match[0];
        if (!protectedTag) addSegment(parts, segments, content.slice(cursor, match.index));
        else addLiteral(parts, content.slice(cursor, match.index));
        addLiteral(parts, tag);

        const closing = tag.match(/^<\s*\/\s*([a-z0-9-]+)/iu)?.[1]?.toLowerCase();
        if (closing && closing === protectedTag) {
            protectedTag = '';
        } else if (!closing) {
            const opening = tag.match(/^<\s*([a-z0-9-]+)/iu)?.[1]?.toLowerCase();
            if (opening && PROTECTED_HTML_TAGS.has(opening) && !/\/\s*>$/u.test(tag)) {
                protectedTag = opening;
            }
        }

        cursor = match.index + tag.length;
        match = HTML_TOKEN_PATTERN.exec(content);
    }

    if (cursor < content.length) {
        if (protectedTag) addLiteral(parts, content.slice(cursor));
        else addSegment(parts, segments, content.slice(cursor));
    }
    return {parts, segments};
}

function parseTimedSubtitleDocument(content: string): Pick<ParsedDocument, 'parts' | 'segments'> {
    const parts: DocumentPart[] = [];
    const segments: DocumentSegment[] = [];
    const lines = splitWithEndings(content);
    let cursorLine = 0;

    while (cursorLine < lines.length) {
        const timestampLine = lines[cursorLine];
        if (!timestampLine || !TIMED_SUBTITLE_PATTERN.test(timestampLine.text)) {
            addLiteral(parts, content.slice(timestampLine.start, timestampLine.end));
            cursorLine += 1;
            continue;
        }

        addLiteral(parts, content.slice(timestampLine.start, timestampLine.end));
        cursorLine += 1;
        const textStartLine = cursorLine;
        while (cursorLine < lines.length && lines[cursorLine].text.trim() && !TIMED_SUBTITLE_PATTERN.test(lines[cursorLine].text)) {
            cursorLine += 1;
        }

        if (cursorLine === textStartLine) continue;
        const textStart = lines[textStartLine].start;
        const textEnd = lines[cursorLine - 1].textEnd;
        const source = content.slice(textStart, textEnd);
        // Keep a complete cue in one translation unit. This lets the provider
        // preserve inline subtitle tags such as <i>...</i> or ASS override
        // codes while keeping timestamps and cue boundaries outside the request.
        addSegment(parts, segments, source);

        if (cursorLine < lines.length) {
            addLiteral(parts, content.slice(textEnd, lines[cursorLine].start));
        } else {
            addLiteral(parts, content.slice(textEnd));
        }
    }

    return {parts, segments};
}

function parseAssDocument(content: string): Pick<ParsedDocument, 'parts' | 'segments'> {
    const parts: DocumentPart[] = [];
    const segments: DocumentSegment[] = [];
    const lines = splitWithEndings(content);

    lines.forEach((line) => {
        if (!/^\s*Dialogue\s*:/iu.test(line.text)) {
            addLiteral(parts, content.slice(line.start, line.end));
            return;
        }

        const colon = line.text.indexOf(':');
        const prefix = line.text.slice(0, colon + 1);
        const dialogue = line.text.slice(colon + 1);
        let commaCount = 0;
        let textStart = -1;
        for (let index = 0; index < dialogue.length; index += 1) {
            if (dialogue[index] !== ',') continue;
            commaCount += 1;
            if (commaCount === 9) {
                textStart = index + 1;
                break;
            }
        }

        if (textStart < 0) {
            addLiteral(parts, content.slice(line.start, line.end));
            return;
        }

        addLiteral(parts, prefix + dialogue.slice(0, textStart));
        addSegment(parts, segments, dialogue.slice(textStart));
        addLiteral(parts, content.slice(line.textEnd, line.end));
    });

    return {parts, segments};
}

function parseLrcDocument(content: string): Pick<ParsedDocument, 'parts' | 'segments'> {
    const parts: DocumentPart[] = [];
    const segments: DocumentSegment[] = [];
    const lines = splitWithEndings(content);

    lines.forEach((line) => {
        const match = line.text.match(LRC_TIME_PATTERN);
        if (!match) {
            addLiteral(parts, content.slice(line.start, line.end));
            return;
        }

        const prefix = match[1];
        addLiteral(parts, prefix);
        addSegment(parts, segments, line.text.slice(prefix.length), {bilingualPrefix: prefix});
        addLiteral(parts, content.slice(line.textEnd, line.end));
    });

    return {parts, segments};
}

function cloneJsonValue(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(cloneJsonValue);
    if (value && typeof value === 'object') {
        return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, cloneJsonValue(item)]));
    }
    return value;
}

function parseJsonDocument(content: string): Pick<ParsedDocument, 'segments' | 'jsonValue' | 'jsonEntries'> {
    let jsonValue: unknown;
    try {
        jsonValue = JSON.parse(content);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`JSON 文件格式无效：${message}`);
    }

    const segments: DocumentSegment[] = [];
    const jsonEntries: JsonSegmentEntry[] = [];
    const walk = (value: unknown, path: Array<string | number>) => {
        if (typeof value === 'string') {
            const trimmed = trimSource(value);
            if (!trimmed) return;
            const segmentIndex = segments.length;
            segments.push({id: segmentIndex, source: trimmed.source});
            jsonEntries.push({path: [...path], segmentIndex, prefix: trimmed.prefix, suffix: trimmed.suffix});
            return;
        }
        if (Array.isArray(value)) {
            value.forEach((item, index) => walk(item, [...path, index]));
            return;
        }
        if (value && typeof value === 'object') {
            Object.entries(value).forEach(([key, item]) => walk(item, [...path, key]));
        }
    };
    walk(jsonValue, []);
    return {segments, jsonValue, jsonEntries};
}

export function parseDocument(fileName: string, content: string): ParsedDocument {
    const format = getDocumentFormat(fileName);
    if (!format) {
        throw new Error('暂不支持该文件格式，请选择 HTML、TXT、Markdown、字幕或 JSON 文件');
    }

    if (format === 'json') {
        return {
            fileName,
            format,
            label: getDocumentFormatLabel(format),
            parts: [],
            ...parseJsonDocument(content),
        };
    }

    const parsed = format === 'html'
        ? parseHtmlDocument(content)
        : format === 'txt' || format === 'markdown'
            ? parseTextDocument(content, format)
            : format === 'ass'
                ? parseAssDocument(content)
                : format === 'lrc'
                    ? parseLrcDocument(content)
                    : parseTimedSubtitleDocument(content);

    return {fileName, format, label: getDocumentFormatLabel(format), ...parsed};
}

function escapeHtml(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function preserveSubtitleMarkup(source: string, translation: string): string {
    if (!translation.trim()) return translation;

    const assPrefix = source.match(/^(?:\{[^}]*\})+/u)?.[0];
    if (assPrefix && !translation.startsWith(assPrefix)) return `${assPrefix}${translation}`;

    const htmlOpen = source.match(/^(?:<([a-z][a-z0-9-]*)\b[^>]*>)+/iu)?.[0];
    const htmlClose = source.match(/(?:<\/([a-z][a-z0-9-]*)>)+(?=\s|$)/iu)?.[0];
    if (htmlOpen && htmlClose && !translation.includes(htmlOpen)) {
        return `${htmlOpen}${translation}${htmlClose}`;
    }
    return translation;
}

function formatBilingualTranslation(document: ParsedDocument, part: SegmentPart, translation: string): string {
    const formattedTranslation = ['srt', 'vtt', 'ass'].includes(document.format)
        ? preserveSubtitleMarkup(part.source, translation)
        : translation;
    if (document.format === 'html') {
        return `${part.prefix}${part.source}${part.suffix}<br><span data-fluent-read-document-translation="true">${escapeHtml(translation)}</span>`;
    }
    if (document.format === 'markdown') {
        return `${part.prefix}${part.source}${part.suffix}\n> ${translation}`;
    }
    if (document.format === 'ass') {
        return `${part.prefix}${part.source}${part.suffix}\\N${formattedTranslation.replace(/\r?\n/gu, '\\N')}`;
    }
    if (part.bilingualPrefix) {
        return `${part.prefix}${part.source}${part.suffix}\n${part.bilingualPrefix}${formattedTranslation}`;
    }
    return `${part.prefix}${part.source}${part.suffix}\n${formattedTranslation}`;
}

function renderParts(document: ParsedDocument, translations: readonly string[], mode: DocumentRenderMode): string {
    return document.parts.map((part) => {
        if (part.kind === 'literal') return part.value;
        const translation = translations[part.segmentIndex] ?? part.source;
        if (mode === 'bilingual') return formatBilingualTranslation(document, part, translation);
        const formattedTranslation = ['srt', 'vtt', 'ass'].includes(document.format)
            ? preserveSubtitleMarkup(part.source, translation)
            : translation;
        return `${part.prefix}${formattedTranslation}${part.suffix}`;
    }).join('');
}

function getAtPath(value: unknown, path: Array<string | number>): unknown {
    let current = value;
    for (const key of path) {
        if (!current || typeof current !== 'object') return undefined;
        current = (current as Record<string | number, unknown>)[key];
    }
    return current;
}

function setAtPath(root: unknown, path: Array<string | number>, value: unknown): unknown {
    if (path.length === 0) return value;
    let current = root as Record<string | number, unknown>;
    path.slice(0, -1).forEach((key) => {
        current = current[key] as Record<string | number, unknown>;
    });
    current[path[path.length - 1]] = value;
    return root;
}

export function renderDocument(
    document: ParsedDocument,
    translations: readonly string[],
    mode: DocumentRenderMode = 'bilingual',
): string {
    if (document.format !== 'json') return renderParts(document, translations, mode);

    let output = cloneJsonValue(document.jsonValue);
    document.jsonEntries?.forEach((entry) => {
        const original = getAtPath(output, entry.path);
        if (typeof original !== 'string') return;
        const translation = translations[entry.segmentIndex] ?? original.trim();
        const value = mode === 'bilingual'
            ? `${entry.prefix}${original.trim()}\n${translation}${entry.suffix}`
            : `${entry.prefix}${translation}${entry.suffix}`;
        output = setAtPath(output, entry.path, value);
    });
    return JSON.stringify(output, null, 2);
}

export function createDocumentDownloadName(fileName: string, mode: DocumentRenderMode): string {
    const suffix = mode === 'bilingual' ? '.bilingual' : '.translated';
    const match = fileName.match(/^(.*?)(\.[^.]+)?$/u);
    return `${match?.[1] || fileName}${suffix}${match?.[2] || ''}`;
}
