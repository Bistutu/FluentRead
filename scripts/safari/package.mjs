#!/usr/bin/env node

/**
 * Safari 交付边界：校验 WXT Safari 产物，检测本机 Apple 打包工具，并生成不打开、不签名的 Xcode 包装。
 * 不构建网页代码、不申请账号、不改写已有工程。实际安装、签名与 App Store 分发仍由维护者执行。
 */
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {existsSync} from 'node:fs';
import {mkdir, readFile, readdir, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const root = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const toolNames = ['safari-web-extension-packager', 'safari-web-extension-converter'];

function assert(condition, message) {
    if (!condition) throw new Error(message);
}

/** 检查最终清单而非源配置，避免 WXT 的 MV 转换或入口配置造成静默漂移。 */
export function verifySafariManifest(manifest) {
    assert(manifest.manifest_version === 2, 'Safari 包装需要 build:safari 生成的 MV2 产物');
    assert(manifest.background?.persistent === false, 'iOS Safari 后台必须为非持久模式');
    assert(manifest.background?.scripts?.length > 0, 'Safari 产物缺少后台脚本');
    assert(manifest.browser_specific_settings?.safari?.strict_min_version === '26.0', 'Safari 最低版本必须为 26.0');
    assert(!manifest.browser_specific_settings?.gecko && !manifest.oauth2 && !manifest.key, 'Safari 清单不能包含 Firefox/Chrome 身份字段');
    const permissions = manifest.permissions ?? [];
    for (const permission of ['storage', 'alarms', 'declarativeNetRequestWithHostAccess', '<all_urls>']) {
        assert(permissions.includes(permission), `Safari 产物缺少权限 ${permission}`);
    }
    for (const permission of ['offscreen', 'identity']) {
        assert(!permissions.includes(permission), `Safari 产物包含不支持的权限 ${permission}`);
    }
    assert(manifest.content_scripts?.length > 0, 'Safari 产物缺少网页内容脚本');
    assert(manifest.browser_action?.default_popup, 'Safari 产物缺少扩展菜单入口');
    return manifest;
}

function artifactPath(directory, relative) {
    assert(typeof relative === 'string', '产物引用必须是文件路径');
    const absolute = path.resolve(directory, relative);
    assert(absolute.startsWith(`${directory}${path.sep}`), `产物引用越界：${relative}`);
    return absolute;
}

async function hashBuild(directory) {
    const hash = createHash('sha256');
    let artifactCount = 0;
    const visit = async (relative = '') => {
        const entries = await readdir(path.join(directory, relative), {withFileTypes: true});
        entries.sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0);
        for (const entry of entries) {
            const file = path.posix.join(relative, entry.name);
            if (entry.isDirectory()) await visit(file);
            else {
                assert(entry.isFile(), `Safari 产物不能包含符号链接或特殊文件：${file}`);
                const bytes = await readFile(path.join(directory, file));
                hash.update(`${file}\0${bytes.length}\0`);
                hash.update(bytes);
                artifactCount++;
            }
        }
    };
    await visit();
    return {buildSha256: hash.digest('hex'), artifactCount};
}

export async function verifySafariBuild(directory) {
    const absolute = path.resolve(directory);
    const manifestBytes = await readFile(path.join(absolute, 'manifest.json'));
    const manifest = verifySafariManifest(JSON.parse(manifestBytes));
    const scripts = manifest.background.scripts;
    const references = [
        ...scripts,
        manifest.browser_action.default_popup,
        manifest.options_ui?.page,
        ...manifest.content_scripts.flatMap(entry => [...(entry.js ?? []), ...(entry.css ?? [])]),
    ].filter(Boolean);
    for (const file of references) await readFile(artifactPath(absolute, file));
    const background = (await Promise.all(scripts.map(file => readFile(artifactPath(absolute, file), 'utf8')))).join('\n');
    assert(background.includes('__FLUENTREAD_BROWSER_CAPABILITY_BUILD__:safari:mv2__'), '后台缺少 Safari/MV2 能力标记，请勿复制 Chrome 或 Firefox 产物');
    assert(!existsSync(path.join(absolute, 'offscreen.html')), 'Safari 产物不能包含 Chromium/Firefox 专用 Offscreen 页面');
    return {
        extension: absolute,
        version: manifest.version,
        manifestSha256: createHash('sha256').update(manifestBytes).digest('hex'),
        checkedReferences: references.length,
        ...await hashBuild(absolute),
    };
}

/** 使用 xcrun 查找新旧工具名，兼容仍只提供 converter 的 Xcode。 */
export function findPackager(run = spawnSync, env = process.env) {
    for (const name of toolNames) {
        const result = run('xcrun', ['--find', name], {encoding: 'utf8', env});
        if (result.status === 0 && result.stdout?.trim()) return {name, executable: result.stdout.trim()};
    }
    throw new Error('未找到 Safari packager/converter。请安装完整 Xcode 并设置 DEVELOPER_DIR，Command Line Tools 单独安装不含此工具。');
}

export function packagingArguments({extension, projectLocation, bundleId, platform}) {
    assert(typeof bundleId === 'string' && /^[A-Za-z][A-Za-z0-9-]*(?:\.[A-Za-z][A-Za-z0-9-]*){2,}$/u.test(bundleId), '请用 --bundle-id 指定维护者自己的反向域名标识，例如 org.example.FluentRead');
    assert(['both', 'ios', 'macos'].includes(platform), '--platform 只能为 both、ios 或 macos');
    return [extension, '--project-location', projectLocation, '--app-name', 'FluentRead',
        '--bundle-identifier', bundleId, '--swift', '--copy-resources', '--no-open', '--no-prompt',
        ...(platform === 'both' ? [] : [`--${platform}-only`])];
}

/** Apple 默认模板仍允许 iOS 15/macOS 10.14；使 App 安装范围与 Safari 26 能力门槛一致。 */
export function applyDeploymentTargets(project, platform) {
    const seen = new Set();
    const minimums = {IPHONEOS_DEPLOYMENT_TARGET: 26, MACOSX_DEPLOYMENT_TARGET: 14};
    const updated = project.replace(/\b(IPHONEOS_DEPLOYMENT_TARGET|MACOSX_DEPLOYMENT_TARGET) = ([0-9.]+);/gu, (line, key, version) => {
        seen.add(key);
        return Number(version.split('.')[0]) < minimums[key] ? `${key} = ${minimums[key]}.0;` : line;
    });
    if (platform !== 'macos') assert(seen.has('IPHONEOS_DEPLOYMENT_TARGET'), 'Apple 工程缺少 iOS deployment target，请检查模板变化');
    if (platform !== 'ios') assert(seen.has('MACOSX_DEPLOYMENT_TARGET'), 'Apple 工程缺少 macOS deployment target，请检查模板变化');
    return updated;
}

function options(args) {
    const result = {extension: path.join(root, '.output/safari-mv2'), projectLocation: path.join(root, '.output/safari-xcode'), platform: 'both'};
    for (let index = 0; index < args.length; index++) {
        const arg = args[index];
        if (['--check', '--verify', '--help'].includes(arg)) result[arg.slice(2)] = true;
        else {
            const key = {'--extension': 'extension', '--project-location': 'projectLocation', '--bundle-id': 'bundleId', '--platform': 'platform'}[arg];
            assert(key && args[index + 1] && !args[index + 1].startsWith('--'), `未知参数或缺少值：${arg}`);
            result[key] = args[++index];
        }
    }
    result.extension = path.resolve(result.extension);
    result.projectLocation = path.resolve(result.projectLocation);
    return result;
}

async function findProjects(directory) {
    const projects = [];
    for (const entry of await readdir(directory, {withFileTypes: true})) {
        if (!entry.isDirectory()) continue;
        const absolute = path.join(directory, entry.name);
        if (entry.name.endsWith('.xcodeproj')) projects.push(absolute);
        else projects.push(...await findProjects(absolute));
    }
    return projects;
}

async function main() {
    const config = options(process.argv.slice(2));
    if (config.help) {
        console.log('Safari 本地交付（不签名、不发布）\n  pnpm build:safari\n  pnpm safari:verify [--extension DIR]\n  pnpm safari:check\n  pnpm safari:package --bundle-id org.example.FluentRead [--platform both|macos|ios] [--project-location NEW_DIR]');
        return;
    }
    if (config.verify) {
        console.log(JSON.stringify(await verifySafariBuild(config.extension), null, 2));
        return;
    }
    assert(process.platform === 'darwin', '生成 Safari Xcode 包装需要安装 Xcode 的 macOS；产物清单可在其他系统用 safari:verify 检查');
    const packager = findPackager();
    if (config.check) {
        const xcode = spawnSync('xcrun', ['xcodebuild', '-version'], {encoding: 'utf8'});
        assert(xcode.status === 0, xcode.stderr || '无法读取 Xcode 版本');
        const sdks = Object.fromEntries(['macosx', 'iphoneos', 'iphonesimulator'].map(sdk => {
            const result = spawnSync('xcrun', ['--sdk', sdk, '--show-sdk-path'], {encoding: 'utf8'});
            return [sdk, {available: result.status === 0, path: result.status === 0 ? result.stdout.trim() : null}];
        }));
        console.log(JSON.stringify({packager, xcode: xcode.stdout.trim(), sdks,
            developerDir: process.env.DEVELOPER_DIR ?? null, deviceAcceptance: 'not-run'}, null, 2));
        return;
    }
    const build = await verifySafariBuild(config.extension);
    const args = packagingArguments(config);
    assert(!existsSync(config.projectLocation), `目标已存在，请保留现有工程并指定新的 --project-location：${config.projectLocation}`);
    assert(!config.extension.startsWith(`${config.projectLocation}${path.sep}`), '包装目录不能包含源产物目录');
    await mkdir(path.dirname(config.projectLocation), {recursive: true});
    const result = spawnSync(packager.executable, args, {stdio: 'inherit'});
    assert(result.status === 0, result.error?.message ?? 'Apple 打包工具未成功，保留部分输出以便检查；请使用新的目录重试');
    const projects = await findProjects(config.projectLocation);
    assert(projects.length > 0, 'Apple 工具未生成 Xcode 工程，请检查上方输出');
    const copiedExtensions = [];
    for (const project of projects) {
        const copied = await verifySafariBuild(path.join(path.dirname(project), 'Shared (Extension)', 'Resources'));
        assert(copied.buildSha256 === build.buildSha256, 'Apple 包装内的资源与已校验的 Safari 构建不一致');
        copiedExtensions.push(copied.extension);
        const file = path.join(project, 'project.pbxproj');
        await writeFile(file, applyDeploymentTargets(await readFile(file, 'utf8'), config.platform));
    }
    const report = {...build, packager, projects, copiedExtensions, bundleId: config.bundleId, platform: config.platform,
        minimumOS: {ios: '26.0', macos: '14.0'}, minimumSafari: '26.0', signed: false, installed: false};
    await writeFile(path.join(config.projectLocation, 'fluentread-package-report.json'), `${JSON.stringify(report, null, 2)}\n`);
    console.log(JSON.stringify(report, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    main().catch(error => {
        console.error(`[safari-package] ${error instanceof Error ? error.message : String(error)}`);
        process.exitCode = 1;
    });
}
