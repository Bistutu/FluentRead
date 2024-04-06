import {franc} from "franc-min";

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