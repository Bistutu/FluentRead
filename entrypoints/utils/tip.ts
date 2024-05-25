import {ElMessage} from "element-plus";
import {throttle} from "@/entrypoints/utils/common";

const prefix = "流畅阅读：";

function _sendErrorMessage(message: string) {
    ElMessage({message: prefix + message, type: 'error'});
}

function _sendSuccessMessage(message: string) {
    ElMessage({message: prefix + message, type: 'success'});
}

// 使用防抖函数包装，1s 内只能发送一次消息
export const sendErrorMessage = throttle(_sendErrorMessage, 1000);
export const sendSuccessMessage = throttle(_sendSuccessMessage, 1000);
