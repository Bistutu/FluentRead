import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import vue from '@vitejs/plugin-vue';
import {createServer, type ViteDevServer} from 'vite';
import {afterEach, describe, expect, it} from 'vitest';
import type {VocabularyContext} from '@/src/features/vocabulary/learningModel';

let server: ViteDevServer | undefined;
afterEach(async () => {await server?.close(); server = undefined;});

describe('learning center video source UI', () => {
    it('renders real fragment anchors, recoverable source states and ordinary article links', async () => {
        const require = createRequire(import.meta.url);
        const runtime = require('vue') as typeof import('vue');
        const {renderToString} = require('vue/server-renderer') as {renderToString(app: ReturnType<typeof runtime.createSSRApp>): Promise<string>};
        server = await createServer({configFile: false, appType: 'custom', logLevel: 'silent', root: process.cwd(), plugins: [vue()], resolve: {alias: {'@': resolve(process.cwd())}}, server: {hmr: false, middlewareMode: true}});
        const component = (await server.ssrLoadModule('/src/features/vocabulary/ui/VocabularySource.vue')).default;
        const render = (context?: VocabularyContext) => renderToString(runtime.createSSRApp(component, {context}));
        const context: VocabularyContext = {text: 'A complete sentence.', pageTitle: 'Learning video', capturedAt: 10, sourceUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', video: {platform: 'youtube', startMs: 1_250, endMs: 4_600}};
        const youtube = await render(context);
        expect(youtube).toContain('href="https://www.youtube.com/watch?v=dQw4w9WgXcQ&amp;t=1.25s"');
        expect(youtube).toContain('Learning video'); expect(youtube).toContain('00:01–00:04');
        expect(youtube).toContain('rel="noopener noreferrer"');
        expect(youtube).not.toContain('需要启用 FluentRead 视频字幕');
        const x = await render({...context, sourceUrl: 'https://x.com/reader/status/123/video/2', video: {...context.video!, platform: 'x'}});
        expect(x).toContain('href="https://x.com/reader/status/123/video/2#fluentread-video=1250,4600"');
        expect(x).toContain('片段定位需要启用 FluentRead 视频字幕');
        const local = await render({...context, sourceUrl: 'blob:local'});
        expect(local).not.toContain('<a'); expect(local).toContain('00:01–00:04'); expect(local).toContain('可按材料标题找回视频');
        const unnamed = await render({...context, sourceUrl: undefined, pageTitle: undefined});
        expect(unnamed).toContain('视频来源暂不可用');
        const article = await render({text: 'Article context.', sourceUrl: 'https://example.test/article#section', capturedAt: 1});
        expect(article).toContain('href="https://example.test/article#section"'); expect(article).toContain('查看收藏来源');
        const unnamedVideo = await render({...context, pageTitle: undefined});
        expect(unnamedVideo).toContain('回到视频片段');
        expect(await render()).not.toContain('vocabulary-source');
        expect(await render({text: 'No source.', capturedAt: 1})).not.toContain('vocabulary-source');
    });
});
