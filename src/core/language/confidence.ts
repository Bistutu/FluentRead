/**
 * @file src/core/language/confidence.ts
 *
 * 文件职责：定义 Chrome 现代语言检测结果共用的最低置信度，为设置页固定样例自检与 offscreen 正文检测提供同一个纯数值边界。
 * 主要内容：MIN_CHROME_LANGUAGE_CONFIDENCE 保留既有 0.4 值，低于下界的结果按原调用方规则拒绝；detect.ts 继续公开转出同名常量。
 * 模块边界：本文件不导入正文识别、字符表或统计语料，不读取配置、浏览器、存储或网络；检测结果的形状、上界和错误处理仍由各调用方负责。
 */

/** Chrome LanguageDetector 结果低于此边界时按未知语言处理。 */
export const MIN_CHROME_LANGUAGE_CONFIDENCE = 0.4;
