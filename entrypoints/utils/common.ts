// 防抖限流函数，可传递参数
import {franc} from "franc-min";

export function throttle(fn: (...args: any[]) => void, interval: number) {
    let last = 0;   // 维护上次执行的时间
    return function(this: any, ...args: any[]) {
        const now = Date.now();
        if (now - last >= interval) {
            last = now;
            fn.apply(this, args);  // 使用 apply 来传递参数数组
        }
    };
}

// 输出标准的语言类型，franc 只返回最可信的结果，francAll 返回所有结果并包含确信度
export function detectlang(origin: any): string {
    let find = franc(origin, {minLength: 0});
    if (find === "cmn") return "zh-Hans"
    else if (find === "eng") return "en"
    else if (find === "jpn") return "ja"
    else if (find === "kor") return "ko"
    else if (find === "fra") return "fr"
    else if (find === "rus") return "ru"
    else return find
}

// 获取触摸点的中心位置
export function getCenterPoint(touches: TouchList, point: number) {
    // 检查触摸点数量是否等于指定的数量
    if (touches.length !== point) return;

    let centerX = 0;
    let centerY = 0;
    for (let i = 0; i < touches.length; i++) {
        centerX += touches[i].clientX; // 累加所有触摸点的X坐标
        centerY += touches[i].clientY; // 累加所有触摸点的Y坐标
    }
    centerX /= touches.length; // 计算中心点的X坐标
    centerY /= touches.length; // 计算中心点的Y坐标
    return {x: centerX, y: centerY};
}