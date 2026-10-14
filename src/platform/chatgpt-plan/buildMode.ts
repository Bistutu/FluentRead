/**
 * @file src/platform/chatgpt-plan/buildMode.ts
 * 文件职责：界定 ChatGPT 本机 OAuth 实验的开发构建边界，避免把开发者安装流程交给公共产品用户。
 * 主要内容：只有 Vite/WXT 开发模式与维护者显式实验开关同时满足时启用本机助手；公开生产构建不受此开关影响，申请公共接入权限不等于完成可用能力。
 * 模块边界：只读取构建元信息，不读取账号、凭据或 Config，不发现本机进程，不实现公共 OAuth 或网络请求。
 */
interface ChatGPTPlanDevelopmentEnv {
    readonly DEV?: unknown;
    readonly WXT_CHATGPT_PLAN_LOCAL_DEVELOPMENT?: unknown;
}

export function isChatGPTPlanDevelopmentEnabled(env?: ChatGPTPlanDevelopmentEnv): boolean {
    return env?.DEV === true && env.WXT_CHATGPT_PLAN_LOCAL_DEVELOPMENT === 'true';
}

export const chatGPTPlanDevelopmentEnabled = isChatGPTPlanDevelopmentEnabled(import.meta.env);
