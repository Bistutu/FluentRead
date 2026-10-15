/**
 * @file userscript/materialCapture.ts
 * 文件职责：在没有材料后台的 userscript 中关闭材料附加采集。
 * 主要内容：沿共享调用签名返回未捕获和未关联，不读取选区、来源、存储或发出材料消息。
 * 模块边界：只替代 material/public 的采集生命周期；原文 text/public、既有词书与阅读问答保存保持真实实现，不提供假材料记录。
 */
type MaterialCapturePorts = typeof import('@/src/features/vocabulary/material/public');

export const captureMaterialSelection: MaterialCapturePorts['captureMaterialSelection'] = () => undefined;
export const beginMaterialCapture: MaterialCapturePorts['beginMaterialCapture'] = async () => undefined;
export const completeMaterialCapture: MaterialCapturePorts['completeMaterialCapture'] = async () => false;
