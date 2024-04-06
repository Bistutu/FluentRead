import {ElMessage} from "element-plus";

const prefix = "流畅阅读：";

function _sendErrorMessage(message: string) {
    ElMessage({message: prefix + message, type: 'error'});
}

function _sendSuccessMessage(message: string) {
    ElMessage({message: prefix + message, type: 'success'});
}

// 修改防抖限流函数（允许传递参数）
export function throttle(fn: Function, interval: number) {
    let last = 0;   // 维护上次执行的时间
    return function (...args: any[]) {  // 使用 rest 参数来传递所有参数
        const now = Date.now();
        if (now - last >= interval) {
            last = now;
            fn.apply(this, args);  // 使用 apply 来传递参数数组
        }
    };
}

// 使用防抖函数包装，1s 内只能发送一次消息
export const sendErrorMessage = throttle(_sendErrorMessage, 1000);
export const sendSuccessMessage = throttle(_sendSuccessMessage, 1000);
