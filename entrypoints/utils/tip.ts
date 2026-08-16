import {ElMessage} from "element-plus";
import {h} from "vue";
import {throttle} from "@/entrypoints/utils/common";

function isCredentialMessage(message: string): boolean {
    return /API Key|访问令牌/.test(message);
}

function getNoticeTitle(message: string, type: 'error' | 'success', credential: boolean): string {
    if (credential) return '配置提醒';
    return type === 'success' ? '操作完成' : '翻译提醒';
}

function getNoticeDetail(message: string, credential: boolean): string {
    if (!credential) return message;

    const service = message.match(/^(.+?) 需要 API Key/)?.[1];
    return service
        ? `还差一步：为 ${service} 填写 API Key，就可以开始翻译了。`
        : '还差一步：填写 API Key，就可以继续翻译了。';
}

function createNoticeContent(message: string, type: 'error' | 'success', credential: boolean) {
    const detail = getNoticeDetail(message, credential);
    return h('span', {class: 'fluent-read-notice-copy'}, [
        h('span', {class: 'fluent-read-notice-heading'}, [
            h('strong', {class: 'fluent-read-notice-brand'}, '流畅阅读'),
            h('span', {class: 'fluent-read-notice-divider', 'aria-hidden': 'true'}, '·'),
            h('span', {class: 'fluent-read-notice-title'}, getNoticeTitle(message, type, credential)),
        ]),
        h('span', {class: 'fluent-read-notice-body'}, [
            h('span', {class: 'fluent-read-notice-detail'}, detail),
            credential
                ? h('button', {
                    class: 'fluent-read-notice-action',
                    type: 'button',
                    onClick: () => {
                        void browser.runtime.sendMessage({type: 'openOptionsPage'});
                    },
                }, '去设置')
                : null,
        ]),
    ]);
}

function sendMessage(message: string, type: 'error' | 'success'): void {
    const credential = isCredentialMessage(message);
    const tone = credential ? 'warning' : type;

    ElMessage({
        message: createNoticeContent(message, type, credential),
        type: tone,
        icon: () => h('img', {
            class: 'fluent-read-notice-mark',
            src: browser.runtime.getURL('/icon/48.png'),
            alt: '流畅阅读',
        }),
        customClass: `fluent-read-message${credential ? ' fluent-read-message-credential' : ''}`,
        showClose: true,
        duration: credential ? 6500 : 3500,
        offset: 18,
        plain: true,
    });
}

function _sendErrorMessage(message: string) {
    sendMessage(message, 'error');
}

function _sendSuccessMessage(message: string) {
    sendMessage(message, 'success');
}

// 使用防抖函数包装，1s 内只能发送一次消息
export const sendErrorMessage = throttle(_sendErrorMessage, 1000);
export const sendSuccessMessage = throttle(_sendSuccessMessage, 1000);
