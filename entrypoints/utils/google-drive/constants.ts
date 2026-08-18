export const GOOGLE_DRIVE_CONFIG_FILENAME = 'fluentread-config.json' as const;
export const GOOGLE_DRIVE_TOKEN_STORAGE_KEY = 'local:googleDriveToken' as const;
export const GOOGLE_DRIVE_LAST_SYNC_STORAGE_KEY = 'local:googleDriveLastSync' as const;
export const GOOGLE_DRIVE_SYNC_SCHEMA_VERSION = 1 as const;

export const GOOGLE_DRIVE_SCOPES = [
    'https://www.googleapis.com/auth/drive.appdata',
    'https://www.googleapis.com/auth/userinfo.email',
] as const;
