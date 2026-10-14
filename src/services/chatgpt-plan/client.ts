/**
 * @file src/services/chatgpt-plan/client.ts
 * 文件职责：提供设置页的 ChatGPT 套餐连接操作，不向界面暴露本机配对凭证。
 * 主要内容：经唯一后台消息路由获取状态和模型、配对、授权、取消及退出，恢复安全错误代码。
 * 模块边界：仅编排设置页到 background 的调用，不实施 OAuth、不直接访问助手网络或持久化令牌。
 */
import {ChatGPTPlanError, type ChatGPTPlanStatus, type ChatGPTPlanModel} from '@/src/platform/chatgpt-plan/bridge';
export const CHATGPT_PLAN_MESSAGE_TYPE = 'chatgptPlanConnection';
export type ChatGPTPlanAction = 'status' | 'pair' | 'signIn' | 'cancel' | 'disconnect' | 'models' | 'usage';
async function invoke<T>(action: ChatGPTPlanAction, code?: string, newAccount?: boolean): Promise<T> {
    const response = await browser.runtime.sendMessage({type: CHATGPT_PLAN_MESSAGE_TYPE, action, ...(code ? {code} : {}), ...(newAccount === undefined ? {} : {newAccount})}) as {success?: boolean; data?: T; code?: string} | undefined;
    if (!response?.success) throw new ChatGPTPlanError(response?.code || 'helper_unavailable');
    return response.data as T;
}
export const getChatGPTPlanStatus = () => invoke<ChatGPTPlanStatus>('status');
export const pairChatGPTPlan = (code: string) => invoke<ChatGPTPlanStatus>('pair', code);
export const startChatGPTPlanSignIn = (newAccount = false) => invoke<ChatGPTPlanStatus>('signIn', undefined, newAccount);
export const cancelChatGPTPlanSignIn = () => invoke<ChatGPTPlanStatus>('cancel');
export const disconnectChatGPTPlan = () => invoke<ChatGPTPlanStatus>('disconnect');
export const listChatGPTPlanModels = () => invoke<ChatGPTPlanModel[]>('models');
export const openChatGPTPlanUsage = () => invoke<void>('usage');
