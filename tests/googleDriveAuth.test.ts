import {afterEach, describe, expect, it, vi} from 'vitest';
import {createDriveAuth, DriveError, type DriveAuthPorts} from '@/src/platform/google-drive/auth';
import {GOOGLE_DRIVE_DEFAULT_CLIENT_ID, GOOGLE_DRIVE_EXTENSION_ID, GOOGLE_DRIVE_SCOPES} from '@/src/platform/google-drive/constants';

function fixture() {
    const ports: DriveAuthPorts = {
        userAgent: () => 'Chrome/142.0.0.0',
        identity: {getAuthToken: vi.fn(async () => ({token: 'fixture-access', grantedScopes: [...GOOGLE_DRIVE_SCOPES]})), removeCachedAuthToken: vi.fn(async () => undefined), clearAllCachedAuthTokens: vi.fn(async () => undefined)},
        runtime: {id: GOOGLE_DRIVE_EXTENSION_ID, getManifest: () => ({oauth2: {client_id: GOOGLE_DRIVE_DEFAULT_CLIENT_ID, scopes: [...GOOGLE_DRIVE_SCOPES]}})},
        fetch: vi.fn(async () => new Response(JSON.stringify({user: {permissionId: 'fixture-account', emailAddress: 'tester@fixture.invalid'}}))),
    };
    return {ports, auth: createDriveAuth(ports)};
}
afterEach(() => vi.useRealTimers());
describe('Chrome Google 身份边界', () => {
    it('账号响应失败时不等未读正文取消握手，并及时释放超时计时器', async () => {
        vi.useFakeTimers();
        const f = fixture(), cancel = vi.fn(() => new Promise<void>(() => {}));
        vi.mocked(f.ports.fetch).mockResolvedValueOnce(new Response(new ReadableStream({cancel}), {status: 403}));
        await expect(f.auth.open()).rejects.toMatchObject({status: 403});
        expect(cancel).toHaveBeenCalledOnce();
        expect(vi.getTimerCount()).toBe(0);
    });

    it('只请求一项 Drive 权限并建立账号固定会话，令牌只出现在请求头和回调内', async () => {
        const f = fixture();
        expect(f.auth.availability()).toEqual({available: true, reason: ''});
        const session = await f.auth.open(true);
        expect(session.account).toEqual({id: 'drive:fixture-account', email: 'tester@fixture.invalid'});
        expect(f.ports.identity!.getAuthToken).toHaveBeenCalledWith({interactive: true, enableGranularPermissions: true, scopes: ['https://www.googleapis.com/auth/drive.appdata']});
        expect(f.ports.fetch).toHaveBeenCalledWith('https://www.googleapis.com/drive/v3/about?fields=user(permissionId,emailAddress)', expect.objectContaining({headers: {Authorization: 'Bearer fixture-access'}, signal: expect.any(AbortSignal)}));
        expect(await session.request(async token => token)).toBe('fixture-access');
        expect(JSON.stringify(session)).not.toContain('fixture-access');
        await f.auth.disconnect();
        expect(f.ports.identity!.clearAllCachedAuthTokens).toHaveBeenCalledOnce();
    });
    it('未配置、浏览器不支持、扩展 ID 错误和范围不全均不能发起认证', async () => {
        for (const userAgent of ['Firefox/140.0', 'Chrome/142.0 Edg/142.0', 'Chrome/142.0 OPR/142.0']) {
            const unsupported = fixture(); unsupported.ports.userAgent = () => userAgent;
            expect(unsupported.auth.availability().available).toBe(false);
        }
        const f = fixture();
        f.ports.identity = undefined;
        expect(f.auth.availability().available).toBe(false);
        await expect(f.auth.open()).rejects.toThrow('Chrome');
        await f.auth.disconnect();
        const mismatch = fixture(); mismatch.ports.runtime.id = 'fixture-wrong-id';
        expect(mismatch.auth.availability().reason).toContain('ID');
        const unconfigured = fixture(); unconfigured.ports.runtime.getManifest = () => ({});
        expect(unconfigured.auth.availability().available).toBe(false);
        const emptyClient = fixture(); emptyClient.ports.runtime.getManifest = () => ({oauth2: {client_id: ''}});
        expect(emptyClient.auth.availability().available).toBe(false);
        const missingScopes = fixture(); missingScopes.ports.runtime.getManifest = () => ({oauth2: {client_id: 'fixture-custom-client'}});
        expect(missingScopes.auth.availability().reason).toContain('范围');
        const custom = fixture(); custom.ports.runtime.id = 'fixture-custom-id'; custom.ports.runtime.getManifest = () => ({oauth2: {client_id: 'fixture-custom-client', scopes: [...GOOGLE_DRIVE_SCOPES]}});
        expect(custom.auth.availability().available).toBe(true);
    });
    it('拒绝取消、空 token 和未授予 Drive 范围；旧邮箱授权不能代替 Drive，兼容 Chrome 未返回 grantedScopes', async () => {
        const f = fixture();
        vi.mocked(f.ports.identity!.getAuthToken).mockRejectedValueOnce(new Error('fixture provider private error'));
        await expect(f.auth.open()).rejects.toThrow('授权未完成');
        vi.mocked(f.ports.identity!.getAuthToken).mockResolvedValueOnce({});
        await expect(f.auth.open()).rejects.toThrow('有效授权');
        vi.mocked(f.ports.identity!.getAuthToken).mockResolvedValueOnce({token: 'fixture-access', grantedScopes: []});
        await expect(f.auth.open()).rejects.toThrow('配置数据权限');
        expect(f.ports.fetch).not.toHaveBeenCalled();
        vi.mocked(f.ports.identity!.getAuthToken).mockResolvedValueOnce({token: 'fixture-access', grantedScopes: ['https://www.googleapis.com/auth/userinfo.email']});
        await expect(f.auth.open()).rejects.toThrow('配置数据权限');
        vi.mocked(f.ports.identity!.getAuthToken).mockResolvedValueOnce({token: 'fixture-access', grantedScopes: [GOOGLE_DRIVE_SCOPES[0]]});
        expect((await f.auth.open()).account.id).toBe('drive:fixture-account');
        vi.mocked(f.ports.identity!.getAuthToken).mockResolvedValueOnce({token: 'fixture-access', grantedScopes: [GOOGLE_DRIVE_SCOPES[0], 'email']});
        expect((await f.auth.open()).account.id).toBe('drive:fixture-account');
        vi.mocked(f.ports.identity!.getAuthToken).mockResolvedValueOnce({token: 'fixture-access', grantedScopes: ['email']});
        await expect(f.auth.open()).rejects.toThrow('配置数据权限');
        vi.mocked(f.ports.identity!.getAuthToken).mockResolvedValueOnce({token: 'fixture-access'});
        expect((await f.auth.open()).account.id).toBe('drive:fixture-account');
    });
    it('Drive 不返回邮箱时仍以 permissionId 绑定账号，不追加邮箱权限且邮箱变化不触发换账号', async () => {
        const f = fixture();
        for (const user of [{permissionId: 'fixture-account'}, {permissionId: 'fixture-account', emailAddress: 1}, {permissionId: 'fixture-account', emailAddress: ''}]) {
            vi.mocked(f.ports.fetch).mockResolvedValueOnce(new Response(JSON.stringify({user})));
            expect((await f.auth.open()).account).toEqual({id: 'drive:fixture-account', email: ''});
        }
        const session = await f.auth.open();
        vi.mocked(f.ports.fetch).mockResolvedValueOnce(new Response(JSON.stringify({user: {permissionId: 'fixture-account', emailAddress: 'changed@fixture.invalid'}})));
        const operation = vi.fn().mockRejectedValueOnce(new DriveError('expired', 401)).mockResolvedValueOnce('ok');
        expect(await session.request(operation)).toBe('ok');
        expect(f.ports.identity!.getAuthToken).toHaveBeenLastCalledWith(expect.objectContaining({scopes: ['https://www.googleapis.com/auth/drive.appdata']}));
    });
    it('401 刷新一次且不弹授权；刷新后账号变化则拒绝继续操作', async () => {
        const f = fixture();
        const session = await f.auth.open();
        const operation = vi.fn().mockRejectedValueOnce(new DriveError('expired', 401)).mockResolvedValueOnce('ok');
        expect(await session.request(operation)).toBe('ok');
        expect(operation).toHaveBeenCalledTimes(2);
        expect(f.ports.identity!.removeCachedAuthToken).toHaveBeenCalledWith({token: 'fixture-access'});
        expect(f.ports.identity!.getAuthToken).toHaveBeenLastCalledWith(expect.objectContaining({interactive: false}));
        vi.mocked(f.ports.fetch).mockResolvedValueOnce(new Response(JSON.stringify({user: {permissionId: 'fixture-other', emailAddress: 'tester@fixture.invalid'}})));
        await expect(session.request(async () => {throw new DriveError('expired', 401);})).rejects.toThrow('账号已切换');
        await expect(session.request(async () => {throw new Error('ordinary failure');})).rejects.toThrow('ordinary failure');
        await expect(session.request(async () => {throw new DriveError('forbidden', 403);})).rejects.toThrow('forbidden');
    });
    it('Drive 账号信息 401 也仅刷新一次；其他失败不触发循环并拒绝缺少账号 ID 的响应', async () => {
        const f = fixture();
        vi.mocked(f.ports.fetch).mockResolvedValueOnce(new Response('', {status: 401}));
        expect((await f.auth.open()).account.id).toBe('drive:fixture-account');
        expect(f.ports.identity!.removeCachedAuthToken).toHaveBeenCalledOnce();
        vi.mocked(f.ports.fetch).mockResolvedValueOnce(new Response('', {status: 403}));
        await expect(f.auth.open()).rejects.toThrow('403');
        vi.mocked(f.ports.fetch).mockRejectedValueOnce(new Error('fixture network private error'));
        await expect(f.auth.open()).rejects.toThrow('检查网络');
        for (const data of [null, 1, {}, {id: 'obsolete-oauth-id', email: 'tester@fixture.invalid'}, {user: null}, {user: 1}, {user: {}}, {user: {permissionId: 1}}, {user: {permissionId: ''}}]) {
            vi.mocked(f.ports.fetch).mockResolvedValueOnce(new Response(JSON.stringify(data)));
            await expect(f.auth.open()).rejects.toThrow('响应无效');
        }
        vi.mocked(f.ports.fetch).mockResolvedValueOnce(new Response('broken'));
        await expect(f.auth.open()).rejects.toThrow('检查网络');
    });
    it('账号请求超时会中止并返回固定错误', async () => {
        const f = fixture();
        vi.useFakeTimers();
        vi.mocked(f.ports.fetch).mockImplementationOnce((_url, init) => new Promise((_resolve, reject) => init!.signal!.addEventListener('abort', () => reject(new Error('timeout')))));
        const request = f.auth.open().catch(error => error);
        await vi.advanceTimersByTimeAsync(30_000);
        expect((await request).message).toContain('检查网络');
    });
});
