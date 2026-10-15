/**
 * @file src/features/vocabulary/material/text/public.ts
 * 文件职责：向划词等页面功能公开有界原文投影，不附带材料持久化能力。
 * 主要内容：重导出单块原文及原生选区偏移的只读提取接口。
 * 模块边界：不加载材料客户端、数据库、界面或恢复调度，使用方自行决定上下文展示与保存时机。
 */
export {projectMaterialOriginalText} from '../../materialOriginalText';
