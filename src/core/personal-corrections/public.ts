/**
 * @file src/core/personal-corrections/public.ts
 * 文件职责：公开个人校订的纯类型、校验与匹配合同。
 * 主要内容：导出材料摘要、严格精确查询、可审阅近似候选及容量边界。
 * 模块边界：不加载持久化、消息运行时或用户界面；调用方通过独立服务保存经读者确认的记录，不得把近似候选当作已确认译法。
 */
export * from './model';
export {createMaterialId, lookupPersonalCorrection} from './matching';
