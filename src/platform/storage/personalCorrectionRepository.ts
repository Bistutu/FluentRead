/**
 * @file src/platform/storage/personalCorrectionRepository.ts
 * 文件职责：在后台现有加密 IndexedDB 端口中单独保存个人校订及有限撤销信息。
 * 主要内容：使用专有本地键和原子条件提交，重新读取后校验白名单与版本；不会加入配置、配置备份、同步或阅读历史。
 * 模块边界：只适配持久化端口，不发送消息、不读取网页、不写供应商结果缓存。
 */
import type {ConfigStoragePort} from './configStorage';
import {emptyCorrectionSnapshot, validateCorrectionSnapshot, type PersonalCorrectionSnapshot, type PersonalCorrectionStore} from '@/src/services/personal-corrections/store';
import {PERSONAL_CORRECTION_BYTES_LIMIT, PersonalCorrectionError} from '@/src/core/personal-corrections/public';
export const PERSONAL_CORRECTION_STORAGE_KEY = 'local:personalCorrections' as const;
export class PersonalCorrectionRepository implements PersonalCorrectionStore {
    constructor(private readonly storage: ConfigStoragePort) {}
    async read(): Promise<{value: PersonalCorrectionSnapshot; expected: unknown}> {
        if (this.storage.writeOwner !== true) throw new PersonalCorrectionError('个人校订只能由后台读取');
        const expected = await this.storage.getItem<unknown>(PERSONAL_CORRECTION_STORAGE_KEY);
        return {value: expected === null ? emptyCorrectionSnapshot() : validateCorrectionSnapshot(expected), expected};
    }
    async write(expected: unknown, value: PersonalCorrectionSnapshot): Promise<boolean> {
        if (this.storage.writeOwner !== true || !this.storage.setItemIfUnchanged) throw new PersonalCorrectionError('个人校订存储不支持原子提交');
        const valid = validateCorrectionSnapshot(value);
        const bytes = () => new TextEncoder().encode(JSON.stringify(valid)).length;
        // 撤销保留受容量约束；优先移除较旧撤销，不让完整删除因附加快照挤满而失败。
        while (bytes() > PERSONAL_CORRECTION_BYTES_LIMIT && valid.undo.length > 1) valid.undo.shift();
        if (bytes() > PERSONAL_CORRECTION_BYTES_LIMIT) throw new PersonalCorrectionError('个人校订已达到 4 MiB，请先删除不需要的内容');
        return this.storage.setItemIfUnchanged(PERSONAL_CORRECTION_STORAGE_KEY, expected, valid);
    }
}
