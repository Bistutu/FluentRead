/**
 * @file src/app/background/handlers/configAutoBackup.ts
 * 文件职责：定义自动配置备份恢复的后台消息协议，并在进入服务层前校验用户请求的备份版本号。
 * 主要内容：声明消息类型和成功失败响应，创建可注入恢复函数的 handler，将合法正整数版本转换为一次受协调的恢复调用。
 * 模块边界：本文件不读取备份列表、不合并凭据也不写浏览器存储；这些安全恢复语义由 services/config/autoBackupStore 与共享修改队列负责。
 */
import type {BackgroundMessageHandler} from '@/src/services/messaging/backgroundRouter';

export const CONFIG_AUTO_BACKUP_RESTORE_MESSAGE_TYPE = 'configAutoBackupRestore' as const;

export interface ConfigAutoBackupRestoreMessage {
    type: typeof CONFIG_AUTO_BACKUP_RESTORE_MESSAGE_TYPE;
    version?: unknown;
}

export type ConfigAutoBackupRestoreResponse<T> =
    | {success: true; result: T}
    | {success: false; error: string};

/** 创建自动配置备份恢复 handler；快照查找与安全字段合并由 service 负责。 */
export function createConfigAutoBackupRestoreHandler<T>(
    restoreConfigAutoBackup: (version: number) => Promise<T>,
): BackgroundMessageHandler<unknown, ConfigAutoBackupRestoreMessage, ConfigAutoBackupRestoreResponse<T>> {
    return {
        type: CONFIG_AUTO_BACKUP_RESTORE_MESSAGE_TYPE,
        async handle(message) {
            const version = message.version;
            if (typeof version !== 'number'
                || !Number.isSafeInteger(version)
                || version < 1) {
                return {success: false, error: '无效的自动配置备份版本'};
            }
            return {
                success: true,
                result: await restoreConfigAutoBackup(version),
            };
        },
    };
}
