import { storage } from '@wxt-dev/storage';
import browser from 'webextension-polyfill';
import {
    GOOGLE_DRIVE_SCOPES,
    GOOGLE_DRIVE_TOKEN_STORAGE_KEY,
} from './constants';

const GOOGLE_CLIENT_ID = process.env.WXT_GOOGLE_CLIENT_ID || '';
const TOKEN_EXPIRY_BUFFER_MS = 60_000;

export interface GoogleAuthToken {
    access_token: string;
    expires_at: number;
    token_type: string;
}

export interface GoogleUserInfo {
    id: string;
    email: string;
    verified_email?: boolean;
    picture?: string;
}

interface BrowserIdentityApi {
    getRedirectURL: () => string;
    launchWebAuthFlow: (details: {url: string; interactive: boolean}) => Promise<string | undefined>;
}

function getIdentityApi(): BrowserIdentityApi {
    const identity = (browser as unknown as {identity?: BrowserIdentityApi}).identity;
    if (!identity) {
        throw new Error('当前浏览器不支持扩展身份认证');
    }
    return identity;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function parseStoredToken(value: unknown): GoogleAuthToken | null {
    if (!isRecord(value)) return null;
    if (typeof value.access_token !== 'string' || !value.access_token) return null;
    if (typeof value.expires_at !== 'number' || !Number.isFinite(value.expires_at)) return null;
    return {
        access_token: value.access_token,
        expires_at: value.expires_at,
        token_type: typeof value.token_type === 'string' && value.token_type ? value.token_type : 'Bearer',
    };
}

async function getTokenFromStorage(): Promise<GoogleAuthToken | null> {
    const raw = await storage.getItem<unknown>(GOOGLE_DRIVE_TOKEN_STORAGE_KEY);
    return parseStoredToken(raw);
}

function getOAuthError(params: URLSearchParams): Error | null {
    const error = params.get('error');
    if (!error) return null;
    const description = params.get('error_description');
    return new Error(`Google OAuth 授权失败：${description || error}`);
}

/**
 * Use Google's implicit OAuth flow because extension identity redirects do not
 * provide a safe place to keep a client secret.
 */
export async function authenticateGoogleDriveAndSaveToken(): Promise<string> {
    if (!GOOGLE_CLIENT_ID) {
        throw new Error('Google Drive 同步尚未配置 OAuth Client ID，请设置 WXT_GOOGLE_CLIENT_ID 后重新构建扩展');
    }

    const identity = getIdentityApi();
    const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    authUrl.searchParams.set('client_id', GOOGLE_CLIENT_ID);
    authUrl.searchParams.set('response_type', 'token');
    authUrl.searchParams.set('redirect_uri', identity.getRedirectURL());
    authUrl.searchParams.set('scope', GOOGLE_DRIVE_SCOPES.join(' '));
    authUrl.searchParams.set('prompt', 'select_account');

    const responseUrl = await identity.launchWebAuthFlow({
        url: authUrl.toString(),
        interactive: true,
    });

    if (!responseUrl) {
        throw new Error('Google OAuth 未返回授权结果');
    }

    const parsedUrl = new URL(responseUrl);
    const hashParams = new URLSearchParams(parsedUrl.hash.replace(/^#/, ''));
    const queryParams = parsedUrl.searchParams;
    const oauthError = getOAuthError(hashParams) || getOAuthError(queryParams);
    if (oauthError) throw oauthError;

    const accessToken = hashParams.get('access_token') || queryParams.get('access_token');
    if (!accessToken) {
        throw new Error('Google OAuth 响应中缺少 access token');
    }

    const expiresIn = Number.parseInt(
        hashParams.get('expires_in') || queryParams.get('expires_in') || '3600',
        10,
    );
    const token: GoogleAuthToken = {
        access_token: accessToken,
        expires_at: Date.now() + (Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn * 1000 : 3_600_000),
        token_type: 'Bearer',
    };

    await storage.setItem(GOOGLE_DRIVE_TOKEN_STORAGE_KEY, token);
    return accessToken;
}

export async function getValidAccessToken(): Promise<string> {
    const token = await getTokenFromStorage();
    if (!token || Date.now() >= token.expires_at - TOKEN_EXPIRY_BUFFER_MS) {
        return authenticateGoogleDriveAndSaveToken();
    }
    return token.access_token;
}

export async function getIsAuthenticated(): Promise<boolean> {
    const token = await getTokenFromStorage();
    return Boolean(token && Date.now() < token.expires_at - TOKEN_EXPIRY_BUFFER_MS);
}

export async function clearAccessToken(): Promise<void> {
    await storage.removeItem(GOOGLE_DRIVE_TOKEN_STORAGE_KEY);
}

export async function getGoogleUserInfo(accessToken: string): Promise<GoogleUserInfo> {
    const response = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
        headers: {Authorization: `Bearer ${accessToken}`},
    });

    if (!response.ok) {
        if (response.status === 401) await clearAccessToken();
        throw new Error(`获取 Google 账号信息失败：HTTP ${response.status}`);
    }

    const data: unknown = await response.json();
    if (!isRecord(data) || typeof data.id !== 'string' || typeof data.email !== 'string') {
        throw new Error('Google 账号信息响应格式无效');
    }

    return {
        id: data.id,
        email: data.email,
        verified_email: typeof data.verified_email === 'boolean' ? data.verified_email : undefined,
        picture: typeof data.picture === 'string' ? data.picture : undefined,
    };
}

export async function getAuthenticatedGoogleUser(): Promise<GoogleUserInfo | null> {
    if (!(await getIsAuthenticated())) return null;
    const accessToken = await getValidAccessToken();
    return getGoogleUserInfo(accessToken);
}
