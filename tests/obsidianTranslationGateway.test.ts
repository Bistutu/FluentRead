import {execFileSync} from 'node:child_process';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {build} from 'vite';
import {describe, expect, it, vi} from 'vitest';
import {createObsidianTranslator, type ObsidianRequestUrl} from '../integrations/obsidian/translation';

describe('Obsidian translation gateway', () => {
    const segments = [
        {id: 0, source: 'First paragraph'},
        {id: 1, source: 'Second paragraph'},
    ];

    it('uses requestUrl and publishes a complete translated batch', async () => {
        const request = vi.fn(async () => ({
            status: 200,
            headers: {'content-type': 'application/json'},
            text: JSON.stringify([
                {translations: [{text: '第一段'}]},
                {translations: [{text: '第二段'}]},
            ]),
        })) as unknown as ObsidianRequestUrl;
        const onSegment = vi.fn();
        const result = await createObsidianTranslator(request)(segments, {
            fileName: 'note.md',
            sourceLanguage: 'en',
            targetLanguage: 'zh-Hans',
            onSegment,
        });
        expect(result).toEqual(['第一段', '第二段']);
        expect(onSegment).toHaveBeenCalledTimes(2);
        expect(vi.mocked(request).mock.calls[0][0]).toMatchObject({
            method: 'POST',
            throw: false,
            body: '["First paragraph","Second paragraph"]',
        });
    });

    it('does not publish partial results from an incomplete provider response', async () => {
        const request = vi.fn(async () => ({
            status: 200,
            headers: {},
            text: JSON.stringify([{translations: [{text: '第一段'}]}]),
        })) as unknown as ObsidianRequestUrl;
        const onSegment = vi.fn();
        await expect(createObsidianTranslator(request)(segments, {fileName: 'note.md', onSegment}))
            .rejects.toThrow('第 1 段文档翻译失败：微软翻译返回的批量结果不完整');
        expect(onSegment).not.toHaveBeenCalled();
    });

    it('stops waiting and cannot publish late results after cancellation', async () => {
        let complete!: (value: {status: number; headers: Record<string, string>; text: string}) => void;
        const request = vi.fn(() => new Promise((resolve) => { complete = resolve; })) as unknown as ObsidianRequestUrl;
        const controller = new AbortController();
        const onSegment = vi.fn();
        const pending = createObsidianTranslator(request)(segments, {
            fileName: 'note.md',
            signal: controller.signal,
            onSegment,
        });
        await vi.waitFor(() => expect(vi.mocked(request)).toHaveBeenCalled());
        controller.abort();
        await expect(pending).rejects.toMatchObject({name: 'AbortError'});
        complete({status: 200, headers: {}, text: '[]'});
        expect(onSegment).not.toHaveBeenCalled();
    });

    it('handles a late network failure when cancellation happens while starting the native request', async () => {
        // Vitest worker 会拦截进程级错误；在独立 Node 中观察原生 unhandledRejection。
        const output = mkdtempSync(join(tmpdir(), 'fluentread-obsidian-gateway-'));
        try {
            await build({
                configFile: false,
                publicDir: false,
                logLevel: 'silent',
                resolve: {alias: {'@': fileURLToPath(new URL('../', import.meta.url))}},
                build: {
                    outDir: output,
                    target: 'es2022',
                    lib: {
                        entry: fileURLToPath(new URL('../integrations/obsidian/translation.ts', import.meta.url)),
                        formats: ['es'],
                        fileName: () => 'gateway.mjs',
                    },
                },
            });
            const observed = execFileSync(process.execPath, ['--input-type=module', '-e', `
                const {createObsidianTranslator} = await import(${JSON.stringify(pathToFileURL(join(output, 'gateway.mjs')).href)});
                const controller = new AbortController();
                const unhandled = [];
                let fail;
                let committed = 0;
                let errorName;
                process.on('unhandledRejection', error => unhandled.push(error.message));
                const request = () => {
                    controller.abort();
                    return new Promise((_resolve, reject) => { fail = reject; });
                };
                try {
                    await createObsidianTranslator(request)([{id: 0, source: 'Source'}], {
                        fileName: 'note.md', signal: controller.signal,
                        onSegment: () => { committed += 1; },
                    });
                } catch (error) { errorName = error.name; }
                fail(new Error('Late native network failure'));
                await new Promise(resolve => setTimeout(resolve, 25));
                console.log(JSON.stringify({errorName, committed, unhandled}));
            `], {encoding: 'utf8', timeout: 5_000});
            expect(JSON.parse(observed)).toEqual({errorName: 'AbortError', committed: 0, unhandled: []});
        } finally {
            rmSync(output, {recursive: true, force: true});
        }
    });

    it('makes no native request for empty documents or already-cancelled work', async () => {
        const request = vi.fn() as unknown as ObsidianRequestUrl;
        const translator = createObsidianTranslator(request);
        expect(await translator([], {fileName: 'empty.md'})).toEqual([]);
        const controller = new AbortController();
        controller.abort();
        await expect(translator(segments, {fileName: 'note.md', signal: controller.signal}))
            .rejects.toMatchObject({name: 'AbortError'});
        expect(request).not.toHaveBeenCalled();
    });

    it('times out native requests and disposes waiting resources before a late response', async () => {
        vi.useFakeTimers();
        let complete!: (value: {status: number; headers: Record<string, string>; text: string}) => void;
        const request = vi.fn(() => new Promise((resolve) => { complete = resolve; })) as unknown as ObsidianRequestUrl;
        const onSegment = vi.fn();
        try {
            const outcome = createObsidianTranslator(request)(segments, {fileName: 'note.md', onSegment})
                .catch((error: Error) => error);
            await vi.advanceTimersByTimeAsync(20_000);
            expect(await outcome).toMatchObject({message: expect.stringContaining('翻译请求超时')});
            expect(vi.getTimerCount()).toBe(0);
            complete({status: 200, headers: {}, text: JSON.stringify(segments.map(() => ({translations: [{text: 'Late translation'}]})))});
            await vi.advanceTimersByTimeAsync(0);
            expect(onSegment).not.toHaveBeenCalled();
            expect(vi.getTimerCount()).toBe(0);
        } finally {
            vi.useRealTimers();
        }
    });

    it.each([
        [429, 'Secret provider diagnostic', '翻译失败: 429'],
        [200, 'Secret non-JSON diagnostic', '不是有效 JSON'],
        [200, '[{}, {}]', '第 1 段文档翻译失败：微软翻译返回的批量结果不完整'],
        [200, '[{"translations":[{"text":" "}]},{"translations":[{"text":"valid"}]}]', '第 1 段文档翻译失败：微软翻译返回的批量结果不完整'],
    ])('rejects invalid provider responses without publishing partial translations: %s %s', async (status, text, message) => {
        const request = vi.fn(async () => ({status, headers: {}, text})) as unknown as ObsidianRequestUrl;
        const onSegment = vi.fn();
        const result = createObsidianTranslator(request)(segments, {fileName: 'note.md', onSegment});
        await expect(result).rejects.toThrow(message);
        await expect(result).rejects.not.toThrow('Secret');
        expect(onSegment).not.toHaveBeenCalled();
    });

    it('uses bounded batches and reports progress for a document spanning requests', async () => {
        const input = Array.from({length: 17}, (_, id) => ({id, source: `Paragraph ${id}`}));
        const request = vi.fn(async ({body}: Parameters<ObsidianRequestUrl>[0]) => ({
            status: 200,
            headers: {},
            text: JSON.stringify((JSON.parse(body as string) as string[]).map((source) => ({translations: [{text: `Translated ${source}`}]}))),
        })) as unknown as ObsidianRequestUrl;
        const onProgress = vi.fn();
        const result = await createObsidianTranslator(request)(input, {fileName: 'large.md', onProgress});
        expect(result).toEqual(input.map(({source}) => `Translated ${source}`));
        expect(vi.mocked(request).mock.calls.map(([{body}]) => JSON.parse(body as string).length)).toEqual([16, 1]);
        expect(onProgress.mock.calls.map(([progress]) => progress)).toEqual([
            {completed: 0, total: 17}, {completed: 16, total: 17}, {completed: 17, total: 17},
        ]);
    });
});
