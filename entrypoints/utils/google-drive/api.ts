import { clearAccessToken, getValidAccessToken } from './auth';

const GOOGLE_DRIVE_API_BASE = 'https://www.googleapis.com/drive/v3';
const GOOGLE_DRIVE_UPLOAD_API_BASE = 'https://www.googleapis.com/upload/drive/v3';

export interface GoogleDriveFile {
    id: string;
    name: string;
    mimeType: string;
    modifiedTime: string;
    size?: string;
}
function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function parseDriveFile(value: unknown): GoogleDriveFile {
    if (!isRecord(value)
        || typeof value.id !== 'string'
        || typeof value.name !== 'string'
        || typeof value.mimeType !== 'string'
        || typeof value.modifiedTime !== 'string') {
        throw new Error('Google Drive 文件响应格式无效');
    }

    return {
        id: value.id,
        name: value.name,
        mimeType: value.mimeType,
        modifiedTime: value.modifiedTime,
        size: typeof value.size === 'string' ? value.size : undefined,
    };
}

function parseFileList(value: unknown): GoogleDriveFile[] {
    if (!isRecord(value) || !Array.isArray(value.files)) {
        throw new Error('Google Drive 文件列表响应格式无效');
    }
    return value.files.map(parseDriveFile);
}

async function handleDriveError(response: Response, action: string): Promise<never> {
    if (response.status === 401) {
        await clearAccessToken();
    }

    let detail = '';
    try {
        detail = (await response.text()).trim().slice(0, 240);
    } catch {
        // The status text below is enough when the response body is unavailable.
    }

    throw new Error(`${action}失败：HTTP ${response.status}${detail ? `，${detail}` : ''}`);
}

export async function findFileInAppData(fileName: string): Promise<GoogleDriveFile | null> {
    const accessToken = await getValidAccessToken();
    const url = new URL(`${GOOGLE_DRIVE_API_BASE}/files`);
    const escapedName = fileName.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    url.searchParams.set('spaces', 'appDataFolder');
    url.searchParams.set('q', `name = '${escapedName}' and trashed = false`);
    url.searchParams.set('fields', 'files(id,name,mimeType,modifiedTime,size)');

    const response = await fetch(url.toString(), {
        headers: {Authorization: `Bearer ${accessToken}`},
    });
    if (!response.ok) await handleDriveError(response, '搜索 Google Drive 配置文件');

    const files = parseFileList(await response.json());
    return files[0] || null;
}

export async function downloadFile(fileId: string): Promise<string> {
    const accessToken = await getValidAccessToken();
    const response = await fetch(`${GOOGLE_DRIVE_API_BASE}/files/${encodeURIComponent(fileId)}?alt=media`, {
        headers: {Authorization: `Bearer ${accessToken}`},
    });
    if (!response.ok) await handleDriveError(response, '下载 Google Drive 配置');
    return response.text();
}

export async function uploadFile(
    fileName: string,
    content: string,
    fileId?: string,
): Promise<GoogleDriveFile> {
    const accessToken = await getValidAccessToken();
    const metadata = {
        name: fileName,
        mimeType: 'application/json',
        ...(!fileId ? {parents: ['appDataFolder']} : {}),
    };
    const boundary = '-------fluentread-google-drive-boundary';
    const delimiter = `\r\n--${boundary}\r\n`;
    const closeDelimiter = `\r\n--${boundary}--`;
    const body = `${delimiter}Content-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}${delimiter}Content-Type: application/json; charset=UTF-8\r\n\r\n${content}${closeDelimiter}`;
    const method = fileId ? 'PATCH' : 'POST';
    const endpoint = fileId
        ? `${GOOGLE_DRIVE_UPLOAD_API_BASE}/files/${encodeURIComponent(fileId)}`
        : `${GOOGLE_DRIVE_UPLOAD_API_BASE}/files`;
    const url = `${endpoint}?uploadType=multipart&fields=id,name,mimeType,modifiedTime,size`;

    const response = await fetch(url, {
        method,
        headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': `multipart/related; boundary=${boundary}`,
        },
        body,
    });
    if (!response.ok) await handleDriveError(response, '上传 Google Drive 配置');
    return parseDriveFile(await response.json());
}
