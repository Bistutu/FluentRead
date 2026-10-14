import {mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync} from 'node:fs';
import {relative, resolve, sep} from 'node:path';
import {tmpdir} from 'node:os';
import {describe, expect, it} from 'vitest';

const PROJECT_ROOT = resolve(__dirname, '../..');
const SRC_ROOT = resolve(PROJECT_ROOT, 'src');
const DOCUMENTED_EXTENSIONS = new Set(['.css', '.cts', '.md', '.mts', '.ts', '.tsx', '.vue']);
const BINARY_ASSET_EXTENSIONS = new Set(['.jpg']);
const REQUIRED_SECTIONS = ['文件职责：', '主要内容：', '模块边界：'] as const;

function relativePath(path: string): string {
    return relative(PROJECT_ROOT, path).split(sep).join('/');
}

function extensionOf(path: string): string {
    const dotIndex = path.lastIndexOf('.');
    return dotIndex >= 0 ? path.slice(dotIndex) : '';
}

function isOperatingSystemMetadata(path: string): boolean {
    // Finder 可以在任何浏览过的目录创建此文件；仅忽略精确文件名，源码和未知资产仍接受原审计。
    return path.replaceAll('\\', '/').split('/').at(-1) === '.DS_Store';
}

function listSourceFiles(root = SRC_ROOT): string[] {
    const files: string[] = [];

    const visit = (directory: string) => {
        for (const entry of readdirSync(directory)) {
            const absolute = resolve(directory, entry);
            if (statSync(absolute).isDirectory()) {
                visit(absolute);
            } else if (!isOperatingSystemMetadata(absolute)) {
                files.push(relativePath(absolute));
            }
        }
    };

    visit(root);
    return files.sort();
}

function readHeader(path: string): string | undefined {
    const source = readFileSync(resolve(PROJECT_ROOT, path), 'utf8');
    const isHtmlComment = path.endsWith('.vue') || path.endsWith('.md');
    const match = isHtmlComment
        ? source.match(/^<!--[\s\S]*?-->/u)
        : source.match(/^\/\*\*[\s\S]*?\*\//u);
    return match?.[0];
}

function normalizedHeaderLines(header: string): string[] {
    return header.split('\n')
        .map((line) => line.trim())
        .map((line) => ['/**', '<!--', '*/', '-->'].includes(line)
            ? ''
            : line.replace(/^\*\s?/u, '').trim())
        .filter(Boolean);
}

describe('src file header documentation', () => {
    const allSourceFiles = listSourceFiles();
    const sourceFiles = allSourceFiles.filter((path) => DOCUMENTED_EXTENSIONS.has(extensionOf(path)));

    it('只排除 Finder 元数据，不放宽隐藏源码和未知资产的审计', () => {
        const directory = mkdtempSync(resolve(tmpdir(), 'fluentread-source-headers-'));
        const retained = ['.hidden.ts', '.DS_Store.ts', '.DS_Store.backup', 'unknown.bin'];
        try {
            for (const name of ['.DS_Store', ...retained]) writeFileSync(resolve(directory, name), 'fixture');
            expect(listSourceFiles(directory).map(path => path.split('/').at(-1))).toEqual(retained.sort());
            expect(isOperatingSystemMetadata('src\\core\\.DS_Store')).toBe(true);
            expect(DOCUMENTED_EXTENSIONS.has(extensionOf('unknown.bin'))).toBe(false);
        } finally {
            rmSync(directory, {recursive: true, force: true});
        }
    });

    it('源码提供文件头，声明式 JSON 数据使用标准 JSON 语法', () => {
        // JSON 不支持注释；数据目录由对应 catalog 测试校验语义，不能强塞源码注释破坏导入格式。
        const dataFiles = allSourceFiles.filter((path) => extensionOf(path) === '.json');
        for (const path of dataFiles) {
            expect(() => JSON.parse(readFileSync(resolve(PROJECT_ROOT, path), 'utf8')), path).not.toThrow();
        }
        // main 新增的 JPEG 联系图片是构建资产；验证位置和格式，不能给二进制添加源码注释。
        const binaryAssets = allSourceFiles.filter((path) => BINARY_ASSET_EXTENSIONS.has(extensionOf(path)));
        for (const path of binaryAssets) {
            expect(path).toMatch(/^src\/app\/options\/assets\/[^/]+\.jpg$/u);
            const bytes = readFileSync(resolve(PROJECT_ROOT, path));
            expect(bytes.length, path).toBeGreaterThan(4);
            expect([...bytes.subarray(0, 3)], path).toEqual([0xff, 0xd8, 0xff]);
            // JPEG 的结束标记后可以保留附加数据，不能要求它占据文件最后两个字节。
            expect(bytes.lastIndexOf(Buffer.from([0xff, 0xd9])), path).toBeGreaterThan(2);
        }
        const unsupported = allSourceFiles.filter((path) => !DOCUMENTED_EXTENSIONS.has(extensionOf(path))
            && extensionOf(path) !== '.json' && !BINARY_ASSET_EXTENSIONS.has(extensionOf(path)));
        expect(unsupported).toEqual([]);
        expect(sourceFiles.length).toBeGreaterThan(0);
    });

    it.each(sourceFiles)('%s 以语义化长注释说明职责、内容与边界', (path) => {
        const header = readHeader(path);

        expect(header, path + ' 必须从第一个字符开始书写文件说明').toBeDefined();
        const lines = normalizedHeaderLines(header!);
        const fileLines = lines.filter((line) => line.startsWith('@file '));
        expect(fileLines).toEqual(['@file ' + path]);

        for (const label of REQUIRED_SECTIONS) {
            const sectionLines = lines.filter((line) => line.startsWith(label));
            expect(sectionLines, path + ' 的“' + label + '”必须是唯一独立行').toHaveLength(1);
            const value = sectionLines[0].slice(label.length).trim();
            expect(value.length, path + ' 的“' + label + '”不能是空泛占位').toBeGreaterThanOrEqual(12);
            expect(value, path + ' 的“' + label + '”应使用中文解释').toMatch(/\p{Script=Han}/u);
        }

        expect(header!.length, path + ' 的文件说明应是可独立阅读的长注释').toBeGreaterThanOrEqual(160);
        expect(header).not.toMatch(/(?:TODO|待补充|此文件负责相关功能|文件职责：\s*(?:无|未知|待定))/u);
    });

    it('不同文件不能复制相同的职责或主要内容说明', () => {
        const owners = new Map<string, string>();
        const duplicates: Array<{first: string; second: string; section: string}> = [];

        for (const path of sourceFiles) {
            const header = readHeader(path);
            if (!header) continue;
            const lines = normalizedHeaderLines(header);
            for (const label of REQUIRED_SECTIONS.slice(0, 2)) {
                const value = lines.find((line) => line.startsWith(label))?.slice(label.length).trim() ?? '';
                const key = label + value;
                const first = owners.get(key);
                if (first) duplicates.push({first, second: path, section: label});
                else owners.set(key, path);
            }
        }

        expect(duplicates).toEqual([]);
    });
});
