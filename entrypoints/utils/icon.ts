// 失败时展示的图标
import {sendErrorMessage} from "./tip";
import 'element-plus/es/components/message/style/css'
import {singleTranslate} from "@/entrypoints/main/trans";

const icon = {
    retry: `<svg fill="none" viewBox="0 0 40 40" height="40" width="40" style="display: inline; align-items: center; justify-content: center; width: 1em; height: 1em; margin-left: 1em; pointer-events: none;">
    <path fill="#428ADF" d="M35.9387 5.48805C35.9166 4.60421 35.2434 4.04719 34.279 4.0675C33.3131 4.0878 32.8154 4.67712 32.6567 5.56132C32.5745 6.01985 32.601 6.49957 32.5962 6.96997C32.5881 7.77251 32.594 8.5752 32.594 9.3779C32.4685 9.43478 32.343 9.4917 32.2175 9.54866C31.7961 9.14366 31.3817 8.73102 30.9521 8.33488C27.0799 4.76502 22.4856 3.43605 17.3405 4.22591C10.0761 5.34107 4.69388 11.3891 4.06231 18.939C3.46983 26.0213 8.03881 32.8643 14.897 35.1663C21.8348 37.495 29.5543 34.7845 33.4563 28.6429C33.7074 28.2475 33.9685 27.8417 34.1218 27.4045C34.4194 26.5555 34.2699 25.765 33.4312 25.3113C32.6231 24.8743 31.8573 25.0498 31.2835 25.7915C30.9966 26.1625 30.7785 26.5856 30.5106 26.9724C28.0914 30.4658 24.7682 32.3693 20.5158 32.5766C14.8218 32.8541 9.60215 29.1608 7.94272 23.717C6.22884 18.0946 8.59939 12.0366 13.6698 9.08126C18.5986 6.20837 24.9262 7.03281 28.9148 11.0837C29.2069 11.3803 29.4036 11.7708 29.8772 12.4519C28.32 12.4519 27.1212 12.3885 25.9323 12.4704C24.8345 12.5461 24.253 13.1995 24.262 14.1166C24.2708 15.0096 24.8931 15.7485 25.9495 15.7745C28.7068 15.8424 31.4671 15.8177 34.2259 15.7884C35.1348 15.7787 35.8872 15.2584 35.9148 14.3603C36.0054 11.4048 36.0127 8.44397 35.9387 5.48805Z"></path>
</svg>`,
    warn: `<svg fill="none" viewBox="0 0 40 40" height="40" width="40" style="display: inline; align-items: center; justify-content: center; width: 1em; height: 1em; margin-left: 1em; pointer-events: none;">
    <path fill="#428ADF" d="M20.5607 2.5191C10.735 2.05516 2.46528 10.1045 2.50011 20.0984C2.54469 32.8837 15.9794 41.3025 27.521 35.772C28.0597 35.5138 28.6042 35.2357 29.0745 34.8742C29.9064 34.2347 30.0797 33.3404 29.5712 32.5989C29.0382 31.8217 28.2936 31.6838 27.4596 32.0227C27.2265 32.1174 27.0066 32.2437 26.7865 32.3701C26.6008 32.4767 26.415 32.5833 26.2211 32.6712C20.8005 35.1282 15.6165 34.6504 11.0342 30.8857C6.38506 27.0662 4.83815 21.9885 6.36608 16.1605C8.23236 9.04216 15.6457 4.59129 22.7912 6.13629C30.3201 7.76418 35.1917 14.6886 33.9006 22.1467C33.6763 23.4426 33.1697 24.693 32.665 25.9388C32.4936 26.3618 32.3223 26.7846 32.1625 27.2081C31.7321 28.3488 31.8755 29.1499 32.727 29.6338C33.5625 30.1085 34.3839 29.8271 35.0848 28.8121C35.2031 28.6407 35.3005 28.4544 35.3977 28.2685C35.4242 28.2179 35.4507 28.1672 35.4776 28.1169C36.5263 26.154 37.166 24.0544 37.3992 21.8528C38.4715 11.7296 30.8594 3.00541 20.5607 2.5191ZM22.2324 19.4482C22.6221 17.6294 21.6934 16.7853 19.8682 17.1885C19.4795 17.2744 19.0887 17.3789 18.7223 17.531C17.5055 18.036 17.1067 18.9307 17.8422 20.0563C18.3665 20.8586 18.2472 21.5161 18.0255 22.2965L17.9039 22.7239C17.5079 24.1148 17.1115 25.5072 16.7935 26.9165C16.4841 28.2873 17.2241 29.1723 18.6198 29.1593C18.6749 29.1502 18.7366 29.1408 18.8028 29.1307C18.9623 29.1063 19.1482 29.078 19.332 29.0394C21.5543 28.5732 21.9094 27.8227 20.9844 25.759C20.8192 25.3904 20.8406 24.873 20.9389 24.4633C21.1123 23.7404 21.3092 23.0227 21.5061 22.3052C21.7664 21.3567 22.0267 20.4083 22.2324 19.4482ZM21.2918 10.7674C22.3383 10.7322 23.3464 11.7297 23.3245 12.7787C23.3035 13.7817 22.4311 14.6541 21.4139 14.6892C20.3685 14.7252 19.5018 13.9485 19.4202 12.9025C19.3341 11.798 20.2055 10.8041 21.2918 10.7674Z"></path>
</svg>`
}


export function insertFailedTip(node: any, errMsg: string, spinner: HTMLElement) {
    spinner?.remove();  // 取消转圈动画

    // 创建包装元素
    const wrapper = document.createElement('span');
    wrapper.classList.add('fluent-read-retry-wrapper');

    // 创建重试按钮
    const retryBtn = document.createElement('span');
    retryBtn.innerText = '重试';
    retryBtn.classList.add('fluent-read-retry');
    retryBtn.addEventListener('click', (event: any) => {

        event.preventDefault();   // 阻止默认行为，如链接跳转
        event.stopPropagation();  // 阻止事件继续向上传播

        wrapper.remove();   // 移除错误提示元素，重新翻译
        singleTranslate(node);
    });

    // 添加失败标记 failure
    node.classList.add('fluent-read-failure');

    // 创建错误信息提示按钮
    const errorTip = document.createElement('span');
    errorTip.innerText = '错误原因';
    errorTip.classList.add('fluent-read-reason');
    errorTip.addEventListener('click', (event: any) => {

        event.preventDefault();   // 阻止默认行为，如链接跳转
        event.stopPropagation();  // 阻止事件继续向上传播

        if (errMsg.includes("auth failed") || errMsg.includes("API key") || errMsg.includes("api key")) {
            sendErrorMessage("token 令牌设置错误，请前往设置页检查")
        } else if (errMsg.includes("quota") || errMsg.includes("limit")) {
            sendErrorMessage("api 访问频率过快，请稍后再试")
        } else if (errMsg.includes("network error")) {
            sendErrorMessage("网络错误，请检查网络连接")
        } else if (errMsg.includes("model")) {
            sendErrorMessage("model 模型设置错误，请前往设置页检查")
        } else if (errMsg.includes("timeout")) {
            sendErrorMessage("请求超时，请稍后再试")
        } else {
            sendErrorMessage(errMsg || "未知错误，请联系开发者")
        }
    });

    const retryElement = document.createElement('div');
    retryElement.innerHTML = icon.retry;

    const warnElement = document.createElement('div');
    warnElement.innerHTML = icon.warn;

    // 将 SVG 图标和文本添加到包装元素
    wrapper.appendChild(retryElement);    // 这里不是 httpElement，而是字符串
    wrapper.appendChild(retryBtn);
    wrapper.appendChild(warnElement);
    wrapper.appendChild(errorTip);

    node.appendChild(wrapper);
}

// 插入加载动画
export function insertLoadingSpinner(node: any, isCache: boolean = false) {
    const spinner = document.createElement('span');
    spinner.className = 'fluent-read-loading';
    if (isCache) spinner.style.borderTop = '3px solid green'    // 存在缓存时改为绿色
    node.appendChild(spinner);
    return spinner;
}
