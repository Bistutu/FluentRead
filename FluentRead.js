// ==UserScript==
// @name         流畅阅读
// @license      GPL-3.0 license
// @namespace    https://fr.unmeta.cn/
// @version      1.0
// @description  基于上下文语境的人工智能翻译引擎，为部分网站提供精准翻译，让所有人都能够拥有基于母语般的阅读体验。程序Github开源：https://github.com/Bistutu/FluentRead，欢迎 star。
// @author       ThinkStu
// @match        *://*/*
// @icon         data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAIAAAACACAMAAAD04JH5AAAAAXNSR0IB2cksfwAAAAlwSFlzAAALEwAACxMBAJqcGAAAAtlQTFRFAAAA/3ci/4Aq/wAA/24f/3Af/28g/28f/28e/28f/28f/3Ag/3Ma/24f/24g/3Af/28f/2sh/28e/28f/28f/20h/3Ag9oxQ/3Ag/20e/28g5cWx3OLi7amB/28f/28e/28f/3Ag/28f/24f/3Ec/28f/28d/28g/28f/3Yn/28f/3Af/28e/24d/28e/3Af/H0r8qdO7LZz58SY4tO9/3Ee/28e+4IvwIxMjnFKXVZJKztH+oY06ZdetkSprje00G6BrTW3oSHJy2eI7J1W6Jdc5ZJi4oxm3oZr4o5l6Zhb0nJ+qzG5x2COxFySwVeXv1OavE+eukqiuEantUKpsj2usDmyqzG7qC29pSjCpCXE7J1X3YNvz22DwleXtEGspiq/qi67t0am24Jv7JxYsTqxu0uh1np4pyy/pyrAzWqF76FUxl6QqS297qBUoyXE13p3vlGc4Ypo0XCAuEelpinAtUGrtUKrrTW2pSnCyWSKsjywuUmkvU+ewVWYyWKMzGiH1HV813t23IFw34dr55Ng6ppa76BUrjmyvlKcpCjC65tZ5pNg24By3YVt8aZP03N94otnqTC7qzO4u02gx1+QtkKpyWOMwFWZzmuFv1KbzmqFzWqGw1mVxFuTymSLyWONymWKu0ui1XZ676JS7p9V5ZBi4o1m4Ilp3oZsqC682n5zpSjBy2aJ3YRuxl2R5JBjpy295pNhuUeloyTE2X508aVQ76NT8KRQrja055Rf2Ht2vE2gxV2S449k03R8rDS3qjG5tEGr6JVfwliWxFmU6JZdt0Wn4Yto7Z5X3YRtsz+tsj6u445k8KNS7Z9WvlCe3IJv2Hx1uUmj2n9yyWKNvE6g13p2z2yE6Zlb1nd5x2CPpCbE76FTrzi0tkOpwVaX0XF/3INvv1Kc1HR91XZ739nT2+Hh2+Pj3OLi6rp+8adO+Ycy86dQ/Hsp8qdN+oIu/Xcm/HspehNLBAAAAPN0Uk5TAA8GATpyuvH7/7+AFGSyW7cfj/6uNrn/QCqx////lWX8IMh0CcNOiLwN7ilcYV57//////9vZ43/////cP/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////PgEC/wIDfQKC/wN/vi3GgxgAABTlJREFUeJzt2/lbFVUYB/CrmXWxfcPC277vA1SAmjpBhgghASWhllbSIpKKkJomCZEQFWW0SGmalYC2WGS7kWaL2Wqb7XtpaH9B931n7p0zyzlzYs6509Mz70933nOe8/046x0ebyjErn79+rvMkFZ7DNhz4F57h0VW0qBB3PH77Luf0Ox4cRL2P0BOPCfhwIMOlpfPIRhwiMx4d8GhhxFzkwWVWTCYlX/4EfHwlCECKxIxAEkswJFS4jUDzy446mh9jvB4ECS77oJjjtWniP/3YyW7AY7T8yNy8oek6OvT8o8/QTIgdh7QToITY2eJrPzYQaABTooBJJ0CroCTw7IPgX4WUACnnBq/CfkDOM24WcnbBSzA6eEECFiAM8Jh+QQW4MywuSIRCQgW4Kywrc5WPFdqWjov4BwpgGilcQLOlQVQUtN9BiipfgOMo+AXQPEdkO43IM1vQCoH4LwAEAACQAAIAO6AjMwst8rMlAjIHMpTWfIAXPnOAiEAvh3wHwAM7SNgWAAIAAEgAASAAOAGyODM7+vT0BWgZPEBnL4TiQFwHYSsDId8UYC+VwAIAAHg/wAYfv6Ikb4CRqmqegEzJDvnwtEX5Y6RA8jNi+arY/MLLi4cV3RJcUnpqEsvG6+WFV4Og2PKJ0ycdIUaqysn508RDLjqapVS1yjK1AqH/rXXXS8ScAMtX52mVE53HqmoEgi4kQooVmZQx2aKA8ykZczKUSqNreqS2TW1Nxnbo8WdhHNm44pz5908v2DBLSMX1t26KLe+4TYcK69RG29fDMNN2uTmO4o0wDyBV4FSBis2O11hWCoBiFZLNTaMS9IzoAkXvJOW34DDREM7M+4SB7gb1mul7gDMu4fs3AudJeIAdbBeDRVQBcP3kZ026NwvDvAArPcgFfCQbXgpdNrFAR6G9R6hAnB4GdmZCJ3l4gCPwnorVj7WlFO/6vEnnsy2AHA4j+yshk6HMMCyTssdqMsMmAu9cqKxBmetFAVYa78HPmUCPA2tZ4hGLTSeNbY9AtbZAc+R+c9jqzu+/cJkbKwRBlhvy+9sIgEvQqvipZdfeRU3X3sd5xQpwgBTqonsig2Nb7T3mI5AS3zwzZaqjWO1j9M3iQNoj8O3Nq/KeVtxqoX2Q6SuW0TO8ApYAkuudQyHWu6Q/45phlfAOFiT/qV4vi3/XcuD0yvgPVi0w5obr1kwPN6IX7/COsMrYBosu4UKGAHDLVMLa7T8PPsMjwDrdW4t/LYCJ30XTqx9XzSgGS99av5WjMWPH2gXo2jAh7BqKRWwBYZX48fuUhR8JBiAr0UfUwGfwHCJ9rkHb9uLrS9oHgGfwqIbqQC8TW3TNyaoBEcUAF9MllIB+TBcENsqRkG7eYoJ4JzPAkyCJT+jAtD3eWzrC+27w5ciAa2w4gwqAC//uvhmh3YvNs0nAbT/4E8HaLcB0wPYVBtgeLOx/RXO7yTvxjogpW+ATbBeGTVfey1qIBrbsNO61RFA/YUDHYCvRY10wPbo8Hay8fU3KCBej3VAhH4GMM+Bb82rWes71fqs7sGHx/cOgCT6rwsYgOy2th/o+Up314/Wx1999GtRbaUNwPyFidg/03X/9DP58NIAvzB/X5KAvxP+yspPBOA3vwHM/AQA2EcgAQB2vnyAyw6QD3DJlw5w2wGyAb+75csGsO8B8gGuByBaMgF/cORLBfzJA9ghEbCTB/CXPEAvT34otEsagGsHhOxngSgA1xkANXi3FAB3vu0oCAH08u5/fScM27X771jt6PVcO/9dfILrHxqGWhuSTXKrAAAAAElFTkSuQmCC
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_listValues
// @grant        GM_deleteValue
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// @grant        GM_registerMenuCommand
// @grant        GM_getResourceText
// @connect      fr.unmeta.cn
// @connect      127.0.0.1
// @connect      edge.microsoft.com
// @connect      api-edge.cognitive.microsofttranslator.com
// @connect      aip.baidubce.com
// @connect      dashscope.aliyuncs.com
// @connect      open.bigmodel.cn
// @connect      api.openai.com
// @connect      api.moonshot.cn
// @connect      fanyi.baidu.com
// @run-at       document-end
// @downloadURL  https://update.greasyfork.org/scripts/482986/%E6%B5%81%E7%95%85%E9%98%85%E8%AF%BB.user.js
// @updateURL    https://update.greasyfork.org/scripts/482986/%E6%B5%81%E7%95%85%E9%98%85%E8%AF%BB.meta.js
// @require      https://cdnjs.cloudflare.com/ajax/libs/crypto-js/4.0.0/crypto-js.min.js
// @require      https://registry.npmmirror.com/sweetalert2/10.16.6/files/dist/sweetalert2.min.js
// @resource     swalStyle https://registry.npmmirror.com/sweetalert2/10.16.6/files/dist/sweetalert2.min.css
// ==/UserScript==

// region 变量

// URL 相关
const POST = "POST";
const url = new URL(location.href.split('?')[0]);
// cacheKey 与 时间
const checkKey = "fluent_read_check";
const expiringTime = 86400000 / 4;

// 服务请求地址
// const source = "http://127.0.0.1"
const source = "https://fr.unmeta.cn"
const read = "%s/read".replace("%s", source), preread = "%s/preread".replace("%s", source);

// 预编译正则表达式
const regex = {
    timeRegex: /^(a|an|\d+)\s+(minute|hour|day|month|year)(s)?\s+ago$/, // "2 days ago"
    paginationRegex: /^(\d+)\s*-\s*(\d+)\s+of\s+([\d,]+)$/, // "10 - 20 of 300"
    lastReleaseRegex: /Last Release on (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s(\d{1,2}),\s(\d{4})/, // "Last Release on Jul 4, 2022"
    dependencyRegex: /(Test|Provided|Compile) Dependencies \((\d+)\)/, // "Compile Dependencies (5)"
    rankRegex: /#(\d+) in\s*(.*)/, // "#3 in Algorithms"
    artifactsRegex: /^([\d,]+)\s+artifacts$/, // "1,024 artifacts"
    vulnerabilityRegex: /^(\d+)\s+vulnerabilit(y|ies)$/, // "3 vulnerabilities"
    repositoriesRegex: /Indexed (Repositories|Artifacts) \(([\d.]+)M?\)/, //  Indexed Repositories (100)
    packagesRegex: /([\d,]+) indexed packages/,  // 12,795,152 indexed packages
    joinedRegex: /Joined ((Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec).*\s\d{1,2},?\s\d{4}$)/,  // Joined March 27, 2022
    moreRegex: /\+(\d+) more\.\.\./, // More 100
    commentsRegex: /(\d+)\sComments/,    // 数字 Comments
    gamesRegex: /(\d{1,3}(?:,\d{3})*)( games| Collections)/,
    combinedDateRegex: /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec).*\s\d{1,2},?\s\d{4}$|^\d{1,2}\s(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec).*,?\s\d{4}$|^\d{1,2}\/\d{1,2}\/\d{4}$/i,
    emailRegex: /^Receive feedback emails \((.*)\)$/,
    verifyDomain: /To verify ownership of (.*), navigate to your DNS provider and add a TXT record with this value:/,
    autoSavedRegex: /Auto-saved (\d{2}):(\d{2}):(\d{2})/,
    // 辅助变量
    typeMap: {'Test': '测试', 'Provided': '提供', 'Compile': '编译'},
}

// 精确翻译特例适配
const exceptionMap = {
    maven: "mvnrepository.com",
    docker: "hub.docker.com",
    nexusmods: "www.nexusmods.com",
    openai_web: "openai.com",
    chatGPT: "chat.openai.com",
    coze: "www.coze.com",
    youtube: "www.youtube.com",
}

// 文本类型
const textType = {
    textContent: 0,
    placeholder: 1,
    inputValue: 2,
    ariaLabel: 3,
}

// 适配器与剪枝、预处理 map
let adapterFnMap = new (Map);
let skipStringMap = new Map();
let pruneSet = new Set();   // 剪枝 set
let outerHTMLSet = new Set();   // outerHTML set prune

// DOM 防抖，单位毫秒
let throttleObserveDOM = throttle(observeDOM, 3000);

// 鼠标位置
let mouseX = 0, mouseY = 0;

//
const transModelFn = new Map()   // 翻译模型 map

// 翻译模型
const transModel = {    // 翻译模型枚举
    // --- LLM翻译 ---
    openai: "openai",
    yiyan: "yiyan",
    tongyi: "tongyi",
    zhipu: "zhipu",
    moonshot: "moonshot",
    // --- 机器翻译 ---
    microsoft: "microsoft",
}

// 翻译模型名称
const transModelName = {
    [transModel.microsoft]: '微软翻译（推荐）',

    [transModel.zhipu]: '智谱清言AI',
    [transModel.tongyi]: '通义千问AI',
    [transModel.yiyan]: '文心一言AI',
    [transModel.openai]: 'chatGPT AI',
    [transModel.moonshot]: 'moonshot AI',
}

// 错误类型
const errorManager = {
    unknownError: "未知错误",
    netError: "网络超时，请稍后重试",
    authFailed: "认证失败，请检查 token 是否正确",
    quota: "每分钟翻译次数已达上限，请稍后再试",
}

// 模型类型
const optionsManager = {
    openai: {
        "gpt-3.5-turbo": "gpt-3.5-turbo",
        "gpt-4": "gpt-4",
        "gpt-4-turbo-preview": "gpt-4-turbo-preview",
    },
    yiyan: {    // url 后缀
        "ERNIE-Bot 4.0": "completions_pro",
        "ERNIE-Bot-8K": "ernie_bot_8k",
        "ERNIE-Bot": "completions",
    },
    tongyi: {
        "qwen-turbo": "qwen-turbo",
        "qwen-plus": "qwen-plus",
        "qwen-max": "qwen-max",
        "qwen-max-longcontext": "qwen-max-longcontext",
    },
    zhipu: {
        "glm-4": "glm-4",
        "glm-4v": "glm-4v",
        "glm-3-turbo": "glm-3-turbo",
    },
    moonshot: {
        "moonshot-v1-8k": "moonshot-v1-8k",
    },
    // 获取 option key
    getOption(model) {
        return GM_getValue("model_" + model) || '';
    },
    setOption(model, value) {
        GM_setValue("model_" + model, value);
    },
    // 获取 option value
    getOptionName(model) {
        return this[model][this.getOption(model)];
    }
}

let LLMFormat = {
    getStdHeader(token) {
        return {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + token
        }
    },
    getStdData(origin, option) {
        return JSON.stringify({
            'model': option,
            "temperature": 0.3,
            'messages': [
                {'role': 'system', 'content': chatMgs.getSystemMsg()},
                {'role': 'user', 'content': chatMgs.getUserMsg(origin)}]
        })
    }
}

// token 管理器
const tokenManager = {
    setToken: (model, value) => {
        if (transModel[model]) GM_setValue("token_" + model, value)
    },
    getToken: model => {
        return GM_getValue("token_" + model, '');
    },
    removeToken(model) {
        GM_deleteValue("token_" + model)
    }
};

// sessionStorage
const sessionManager = {
    // 同时缓存原文和译文
    setTransCache(origin, result) {
        let model = util.getValue('model');
        let option = optionsManager.getOption(model);
        // key: 模型_文本，value: 文本
        sessionStorage.setItem(model + "_" + option + "_" + origin, result)
        sessionStorage.setItem(model + "_" + option + "_" + result, origin)
    },
    getTransCache(key) {
        let model = util.getValue('model');
        let option = optionsManager.getOption(model);
        return sessionStorage.getItem(model + "_" + option + "_" + key)
    },
    removeSession(key) {
        sessionStorage.removeItem(util.getValue('model') + "_" + key)
    },
}
const util = {
    getValue(name) {
        return GM_getValue(name, '');
    },
    setValue(name, value) {
        GM_setValue(name, value);
    },
    // 获取元素值
    getElementValue(id) {
        return document.getElementById(id).value || '';
    },
}

const htmlManager = {
    openTagWithAttributes: /<\s*(\w+)(\s+[^>]*?)?\s*>/g,
    openTag: /<\s*(\w+)\s*>/g,
    closingTag: /<\s*\/\s*(\w+)\s*>/g,
    // 标准化 HTML
    standardizeHtml(sentence) {
        // 1、处理开标签和属性，移除标签名和属性之间多余的空格，// 如 < a href="#"> 会被转换成 <a href="#">
        // 2、处理没有属性的开标签，移除标签名周围的多余空格，如 "<p >" 会被转换成 "<p>"
        // 3、处理闭合标签，移除标签名周围的多余空格，如 "</ p>" 会被转换成 "</p>"
        sentence = sentence.replace(this.openTagWithAttributes, (match, p1, p2) => {
            return `<${p1}${p2 ? ' ' + p2.trim() : ''}>`;
        }).replace(this.openTag, "<$1>").replace(this.closingTag, "</$1>")
        return sentence;
    }
};


// endregion

// region 菜单

// toast 样式定义
const toastClass = {
    container: 'translate-d-container',
    popup: 'translate-d-popup',
};
// toast 实例
const toast = Swal.mixin({
    toast: true,
    position: 'top',
    showConfirmButton: false,
    timerProgressBar: false,
    didOpen: toast => {
        toast.addEventListener('mouseenter', Swal.stopTimer);
        toast.addEventListener('mouseleave', Swal.resumeTimer);
    }
});

// 多语言管理对象
const langManager = {
    auto: '自动检测',  // 自动检测
    zh: 'zh-Hans',    // 简体中文
    cht: 'zh-Hant',   // 繁体中文
    en: 'en',         // 英语
    jp: 'ja',         // 日语
    kor: 'ko',        // 韩语
    fra: 'fr',        // 法语
    spa: 'es',        // 西班牙语
    ru: 'ru',         // 俄语
    de: 'de',         // 德语
    it: 'it',         // 意大利语
    tr: 'tr',         // 土耳其语
    pt: 'pt',         // 葡萄牙语
    vie: 'vi',        // 越南语
    id: 'id',         // 印度尼西亚语
    th: 'th',         // 泰语
    ar: 'ar',         // 阿拉伯语
    hi: 'hi',         // 印地语
    per: 'fa',        // 波斯语
    // from、to 源语言、目标语言
    from: {auto: '自动检测'},
    to: {'zh-Hans': '简体中文', 'en': '英语',},
    // 解析语言种类
    parseLanguage(language) {
        return langManager[language] || language || 'en';
    },
    // set
    setFromTo(from, to) {
        GM_setValue('from', from);
        GM_setValue('to', to);
    },
    getFrom() {
        return GM_getValue('from', 'auto')
    },
    getTo() {
        return GM_getValue('to', 'zh-Hans')
    }
}

// 快捷键
const shortcutManager = {
    currentShortcut: null,
    hotkeyOptions: {Control: 'Control', Alt: 'Alt', Shift: 'Shift'},
    hotkeyPressed: false,
}

// 鼠标悬停计时器
let hoverTimer;

const settingManager = {
    // 将对象转换为 HTML option 标签
    generateOptions(options, selectedValue) {
        return Object.entries(options).map(([key, value]) =>
            `<option value="${key}" ${selectedValue === key ? 'selected' : ''}>${value}</option>`
        ).join('');
    },
    // 设置中心界面
    setSetting() {
        // 页面 dom
        const dom = `
  <div style="font-size: 1em;">
    <label class="instant-setting-label">快捷键<select id="fluent-read-hotkey" class="instant-setting-common">${this.generateOptions(shortcutManager.hotkeyOptions, util.getValue('hotkey'))}</select></label>
    <label class="instant-setting-label">翻译源语言<select id="fluent-read-from" class="instant-setting-common">${this.generateOptions(langManager.from, langManager.getFrom())}</select></label>
    <label class="instant-setting-label">翻译目标语言<select id="fluent-read-to" class="instant-setting-common">${this.generateOptions(langManager.to, langManager.getTo())}</select></label>
    <label class="instant-setting-label">翻译服务<select id="fluent-read-model" class="instant-setting-select">${this.generateOptions(transModelName, util.getValue('model'))}</select></label>
    
    <label class="instant-setting-label" id="fluent-read-option-label" style="display: none;">模型类型<select id="fluent-read-option" class="instant-setting-select"></select></label>
    <!-- 令牌区域 -->
    <label class="instant-setting-label" id="fluent-read-token-label" style="display: none;">token令牌<input type="text" class="instant-setting-input" id="fluent-read-token" value="" ></label>
    <label class="instant-setting-label" id="fluent-read-ak-label" style="display: none;">ak令牌<input type="text" class="instant-setting-input" id="fluent-read-ak" value="" ></label>
    <label class="instant-setting-label" id="fluent-read-sk-label" style="display: none;">sk令牌<input type="text" class="instant-setting-input" id="fluent-read-sk" value="" ></label>
    <!-- 添加的输入区域 -->
    <label class="instant-setting-label" id="fluent-read-system-label" style="display: none;">
        <span class="fluent-read-tooltip">system角色设定<span class="fluent-read-tooltiptext">模型角色设定，如：你是一名专业的翻译家...</span></span>
    <textarea class="instant-setting-textarea" id="fluent-read-system-message">${chatMgs.getSystemMsg()}</textarea>
    </label>
    <label class="instant-setting-label" id="fluent-read-user-label" style="display: none;">
    <span class="fluent-read-tooltip">user消息模板<span class="fluent-read-tooltiptext">用户对话内容，如：请你翻译 Hello</br>注意：{{text}} 是你需要翻译的原文，不可缺少。</span></span>
    <textarea class="instant-setting-textarea" id="fluent-read-user-message">${chatMgs.getOriginUserMsg()}</textarea>
    </label>
  </div>`;
        Swal.fire({
                title: '设置中心',
                html: dom,
                showCancelButton: true,
                confirmButtonText: '保存并刷新页面',
                cancelButtonText: '取消',
                customClass: toastClass
            },
        ).then(async (result) => {
                if (result.isConfirmed) {
                    // 1、设置语言
                    util.setValue('from', util.getElementValue('fluent-read-from'));
                    util.setValue('to', util.getElementValue('fluent-read-to'));
                    // 2、设置快捷键
                    util.setValue('hotkey', util.getElementValue('fluent-read-hotkey'));
                    // 3、设置翻译服务
                    let model = util.getElementValue('fluent-read-model');
                    util.setValue('model', model);
                    // 4、设置模型类型
                    optionsManager.setOption(model, util.getElementValue('fluent-read-option'));
                    // 5、存储 token
                    let token = util.getElementValue('fluent-read-token');
                    let ak = util.getElementValue('fluent-read-ak');
                    let sk = util.getElementValue('fluent-read-sk');
                    switch (model) {
                        case transModel.yiyan:
                            tokenManager.setToken(model, {ak: ak, sk: sk});
                            break;
                        case transModel.zhipu:
                            tokenManager.setToken(model, {apikey: token});
                            break;
                        default:
                            tokenManager.setToken(model, token);
                    }
                    // 6、设置 chatGPT 消息模板
                    chatMgs.setSystemMsg(util.getElementValue('fluent-read-system-message'));
                    chatMgs.setUserMsg(util.getElementValue('fluent-read-user-message'));

                    toast.fire({icon: 'success', title: '设置成功！'});
                    history.go(0); // 刷新页面
                }
            }
        )
        // 设置中心打开时需判断是否展示 token 选项
        let model = util.getElementValue('fluent-read-model');
        if ([transModel.openai, transModel.zhipu, transModel.tongyi, transModel.yiyan, transModel.moonshot].includes(model)) {
            this.showHidden(model);
        }
        // 监听“翻译服务”选择框
        document.getElementById('fluent-read-model').addEventListener('change', e => {
            const model = e.currentTarget.value;
            this.showHidden(model);
        });
    },
    showHidden(model) {
        // label 是最外层的标签
        const tokenLabel = document.getElementById('fluent-read-token-label');
        const akLabel = document.getElementById('fluent-read-ak-label');
        const skLabel = document.getElementById('fluent-read-sk-label');

        const token = document.getElementById('fluent-read-token');
        const ak = document.getElementById('fluent-read-ak');
        const sk = document.getElementById('fluent-read-sk');

        // 获取存储的 token 对象
        const tokenObject = tokenManager.getToken(model)

        switch (model) {
            case transModel.yiyan:
                ak.value = tokenObject ? tokenObject.ak : '';
                sk.value = tokenObject ? tokenObject.sk : '';
                this.setDisplayStyle([akLabel, skLabel], [tokenLabel]);
                break;
            case transModel.zhipu:
                token.value = tokenObject.apikey || '';
                this.setDisplayStyle([tokenLabel], [akLabel, skLabel]);
                break;
            default:
                if (model === transModel.openai || model === transModel.moonshot || model === transModel.tongyi) {
                    token.value = tokenObject;
                    this.setDisplayStyle([tokenLabel], [akLabel, skLabel]);
                } else {
                    this.setDisplayStyle([], [tokenLabel, akLabel, skLabel]);
                }
        }
    },
    // 批量设置元素的 display 样式
    setDisplayStyle(flex, none) {
        const systemMsgLabel = document.getElementById('fluent-read-system-label');
        const userMsgLabel = document.getElementById('fluent-read-user-label');

        // 1、如果 flex 为空，则设置所有元素的 display 为 none，返回
        if (flex.length === 0) {
            document.getElementById('fluent-read-option-label').style.display = "none";
            systemMsgLabel.style.display = "none";
            userMsgLabel.style.display = "none";
            none.forEach(element => element.style.display = "none");
            return
        }
        // 2、正常逻辑，更新选项、按需要显示元素
        // 更新下拉框选项
        let model = util.getElementValue('fluent-read-model');
        const optionSelect = document.getElementById('fluent-read-option');
        optionSelect.innerHTML = settingManager.generateOptions(optionsManager[model], optionsManager.getOption(model));

        const optionLabel = document.getElementById('fluent-read-option-label');
        optionLabel.style.display = "flex"

        flex.forEach(element => element.style.display = "flex");
        none.forEach(element => element.style.display = "none");
        systemMsgLabel.style.display = "flex";
        userMsgLabel.style.display = "flex";
    },
    setHotkey() {
        Swal.fire({
            title: '快捷键设置',
            text: '请选择鼠标快捷键',
            input: 'select',
            inputValue: util.getValue('hotkey'),
            inputOptions: shortcutManager.hotkeyOptions,
            confirmButtonText: '保存并刷新页面',
            cancelButtonText: '取消',
            showCancelButton: true,
            customClass: toastClass,
        }).then(async (result) => {
            if (result.isConfirmed) {
                util.setValue('hotkey', result.value);
                setShortcut(result.value);
                toast.fire({icon: 'success', title: '快捷键设置成功！'});
                history.go(0); // 刷新页面
            }
        });
    },
    setLanguage(lang) {
        let args = lang === 'from' ? {
            notion: "源",
            inputValue: langManager.getFrom(),
            inputOptions: langManager.from,
        } : {
            notion: "目标",
            inputValue: langManager.getTo(),
            inputOptions: langManager.to,
        }
        Swal.fire({
            title: args.notion + '语言设置',
            text: '请选择翻译' + args.notion + '语言',
            input: 'select',
            inputValue: args.inputValue,
            inputOptions: args.inputOptions,
            confirmButtonText: '保存并刷新页面',
            cancelButtonText: '取消',
            showCancelButton: true,
            customClass: toastClass,
        }).then(async (result) => {
            if (result.isConfirmed) {
                langManager.setFromTo(langManager.getFrom(), result.value);
                toast.fire({icon: 'success', title: args.notion + '语言设置成功！'});
                history.go(0); // 刷新页面
            }
        });
    },
    about() {
        // 跳转页面
        window.open('https://fr.unmeta.cn/');
    }
};
// endregion

// region 主函数

(function () {
    'use strict';

    initApplication()

    // 当浏览器或标签页失去焦点时，重置 ctrlPressed
    window.addEventListener('blur', () => shortcutManager.hotkeyPressed = false)

    // 鼠标、键盘监听事件，悬停翻译
    window.addEventListener('keydown', event => handler(mouseX, mouseY, 10))
    document.body.addEventListener('mousemove', event => {
        // 更新鼠标位置
        mouseX = event.clientX;
        mouseY = event.clientY;

        handler(mouseX, mouseY, 150);
    });

    // 检查是否需要拉取数据
    checkRun(shouldRun => {
        // 如果 host 包含在 preread 中，shouldRun 为 true，则开始解析 DOM 树并设置监听器
        if (!shouldRun) return

        // 1、添加监听器，使用 MutationObserver 监听 DOM 变化
        const observer = new MutationObserver(function (mutations, obs) {
            mutations.forEach(mutation => {
                if (isEmpty(mutation.target)) return;
                // console.log("原先变更记录：", mutation.target);
                // 如果不包含下面节点，则处理
                if (!["img", "noscript"].includes(mutation.target.tagName.toLowerCase())) {
                    handleDOMUpdate(mutation.target);
                }
            });
        });
        observer.observe(document.body, {childList: true, subtree: true});
        // 2、手动开启一次解析 DOM 树
        handleDOMUpdate(document.body);
    });

    // 快捷键 F2，清空所有缓存
    document.addEventListener('keydown', function (event) {
        if (event.key === 'F2') {
            let listValues = GM_listValues();
            listValues.forEach(e => GM_deleteValue(e))
            console.log('Cache cleared!');
        }
    });
})();

// 延迟响应时间
let delay = 250;

function delayRemoveCache(key, time = 250) {
    outerHTMLSet.add(key);
    setTimeout(() => {
        outerHTMLSet.delete(key);
    }, time);
}

// 监听事件处理器，参数：鼠标坐标、计时器
function handler(mouseX, mouseY, time) {
    if (!shortcutManager.hotkeyPressed) return;

    clearTimeout(hoverTimer); // 清除计时器
    hoverTimer = setTimeout(() => {
        let node = document.elementFromPoint(mouseX, mouseY);   // 获取鼠标

        // 全局与空节点、class="notranslate" 的节点不翻译
        if (node.classList.contains('notranslate') || !node.innerText || ['HTML', 'BODY'].includes(node.tagName)) return;


        // 判断翻译类型
        node = getTransNode(node);
        if (!node) return;  // 如果不需要翻译，则跳过

        if (hasLoadingSpinner(node)) return;    // 如果已经在翻译，则跳过

        // 去重判断
        if (outerHTMLSet.has(node.outerHTML)) return
        outerHTMLSet.add(node.outerHTML);

        // 检测缓存 cache
        let outerHTMLCache = sessionManager.getTransCache(node.outerHTML);
        if (outerHTMLCache) {
            let temp = node.outerHTML;
            // console.log("缓存命中：", outerHTMLCache);
            let spinner = createLoadingSpinner(node, true);
            setTimeout(() => {  // 延迟 remove 转圈动画与替换文本
                spinner.remove();
                outerHTMLSet.delete(temp);
                node.outerHTML = outerHTMLCache;    // 替换
                delayRemoveCache(outerHTMLCache);
            }, delay);
            return;
        }
        translate(node);
    }, time);
}

function hasLoadingSpinner(node) {
    let child = node.firstChild;
    while (child) {
        if (child.classList && child.classList.contains('loading-spinner-fluentread')) return true;
        child = child.nextSibling;
    }
    return false;
}

function getTransNode(node) {
    // 1、判断是否应该从父元素开始翻译（微软翻译时）
    let parent = isMachineTrans(util.getValue('model')) ? shouldTranslateFromParent(node.parentNode) : false;
    if (parent) {
        console.log("应当翻译父节点：", parent);
        return parent;  // 返回应该翻译的父节点
    }

    // 2、判断是否应该翻译自身
    if (!node.innerText.includes('\n')  // 不包含换行符的 innerText
        || (node.childNodes.length === 1 && node.childNodes[0].nodeType === node.TEXT_NODE) // 只包含文本的单一节点
        || ["p", 'span'].includes(node.nodeName.toLowerCase())  // p、span 标签内视为完整句子
    ) {
        console.log("应当翻译自身：", node);
        return node;  // 返回自身节点，因为它应该翻译
    }

    // 3、不需要翻译
    return false;
}

// 返回最终应该翻译的父节点或 false
function shouldTranslateFromParent(node) {
    // 如果节点为空，或者已经到达了文档的根节点，则不需要翻译
    if (!node || node === document.body || node === document.documentElement) {
        return false;
    }

    // 检测当前节点是否满足翻译条件
    if (detectChildMeta(node)) {
        return shouldTranslateFromParent(node.parentNode) || node;  // 返回应该翻译的节点
    }

    return false
}

// 检测子元素中是否包含指定标签以外的元素
function detectChildMeta(parent) {
    let child = parent.firstChild;
    while (child) {
        // 如果子元素不是 a、b、strong、span、p、img 标签，则返回 false
        if (child.nodeType === Node.ELEMENT_NODE && !['a', 'b', 'strong', 'span', 'p', 'img'].includes(child.nodeName.toLowerCase())) {
            return false;
        }
        child = child.nextSibling;
    }
    return true;
}

// endregion


// region 通用翻译处理模块
const chatMgs = {
    system: `You are a professional, authentic translation engine, only returns translations.`,
    user_pre: `Please translate them into {{to}}, `,    // 隐藏前半部分（语言选择），显示用户自定义的后半部分
    user_post: `please do not explain my original text.:

{{origin}}`,
    setSystemMsg(msg) {
        GM_setValue('systemMsg', msg);
    },
    setUserMsg(msg) {
        GM_setValue('userMsg', this.user_pre + msg);
    },
    getOriginUserMsg() {
        let userMsg = GM_getValue('userMsg', this.user_pre + this.user_post);
        return userMsg.substring(userMsg.indexOf(',') + 2, userMsg.length);
    },
    getSystemMsg() {
        return GM_getValue('systemMsg', this.system);
    },
    getUserMsg(origin) {
        let userMsg = GM_getValue('userMsg', this.user_pre + this.user_post);
        return userMsg.replace('{{origin}}', origin).replace('{{to}}', langManager.getTo());
    }
}


function translate(node) {

    let model = util.getValue('model')
    let origin = getTextWithCode(node);

    // 检测语言类型，如果是中文则不翻译
    baiduDetectLang(origin).then(lang => {
        if (lang === langManager.getTo()) return;   // 与目标语言相同，不翻译

        if (isMachineTrans(model)) origin = node.outerHTML; // 如果是微软翻译，应翻译 HTML

        let spinner = createLoadingSpinner(node);   // 插入转圈动画

        let timeout = setTimeout(() => {
            createFailedTip(node, new Error(errorManager.netError).toString(), spinner);
        }, 60000);

        // 调用翻译服务
        transModelFn[model](origin).then(text => {

            clearTimeout(timeout);  // 取消超时

            spinner.remove()
            console.log("翻译前的句子：", origin);
            console.log("翻译后的句子：", text);

            if (!text || origin === text) return;

            // 保存旧的 outerHTML
            let oldOuterHtml = node.outerHTML
            let newOuterHtml = text


            if (isMachineTrans(model)) {    // 1、机器翻译
                if (!node.parentNode) return;

                // todo 1、特殊情况需使用高阶函数，2、暂未考虑特殊情况。2024-2-10
                if (url.host === exceptionMap.youtube) {    // youtube 适配
                    let element = document.createElement('span');
                    element.innerHTML = text;
                    node.innerText = element.innerText;
                    return;
                }
                node.outerHTML = text;
            } else {    // 2、LLM 翻译
                node.innerHTML = text;
                newOuterHtml = node.outerHTML;
            }

            sessionManager.setTransCache(oldOuterHtml, newOuterHtml);   // 设置缓存
            // 延迟 newOuterHtml，删除 oldOuterHtml
            delayRemoveCache(newOuterHtml);
            outerHTMLSet.delete(oldOuterHtml);
        }).catch(e => {
            clearTimeout(timeout);
            createFailedTip(node, e.toString() || errorManager.unknownError, spinner);
        })
    }).catch(e => createFailedTip(node, e.toString() || errorManager.unknownError));
}

// 创建转圈动画并插入
function createLoadingSpinner(node, isCache) {
    const spinner = document.createElement('span');
    spinner.className = 'loading-spinner-fluentread';
    if (isCache) spinner.style.borderTop = '3px solid green'
    node.appendChild(spinner);
    return spinner;
}

// LLM 模式获取翻译文本
function getTextWithCode(node) {
    let text = "";
    // 遍历所有子节点
    node.childNodes.forEach(child => {
        if (child.nodeType === Node.TEXT_NODE) {
            // 文本节点：直接添加其文本
            text += child.nodeValue;
        } else if (child.nodeType === Node.ELEMENT_NODE) {
            // 元素节点：检查是否是<code>标签
            if (['code', 'a', 'strong', 'b'].includes(child.tagName.toLowerCase())) {
                // 是<code>、<a>标签，添加 outerHTML
                text += child.outerHTML;
            } else {
                // 不是<code>标签：递归处理
                text += getTextWithCode(child);
            }
        }
    });
    return text;
}

function createFailedTip(node, errorMsg, spinner) {
    console.log(errorMsg); // 打印错误信息
    // 取消转圈动画
    spinner?.remove();
    // 创建包装元素
    const wrapper = document.createElement('span');
    wrapper.classList.add('retry-error-wrapper');

    // 创建重试按钮
    const retryButton = document.createElement('span');
    retryButton.innerText = '重试';
    retryButton.classList.add('retry-error-button');
    retryButton.addEventListener('click', function () {
        // 移除错误提示元素，重新翻译
        wrapper.remove();
        translate(node);
    });

    // 创建错误提示元素
    const errorTip = document.createElement('span');
    errorTip.innerText = '错误原因';
    errorTip.classList.add('retry-error-tip');
    errorTip.addEventListener('click', function () {
        if (errorMsg.includes("auth failed")) {
            window.alert(errorManager.authFailed);
            return;
        }
        if (errorMsg.includes("quota") || errorMsg.includes("limit")) {
            window.alert(errorManager.quota);
            return
        }
        window.alert(errorMsg || errorManager.unknownError);
    });

    // 将 SVG 图标和文本添加到包装元素
    wrapper.appendChild(createRetrySvgIcon());
    wrapper.appendChild(retryButton);
    wrapper.appendChild(createWarnSvgIcon());
    wrapper.appendChild(errorTip);

    node.appendChild(wrapper);
}

// 重试 svg
function createRetrySvgIcon() {
    return createSvgIcon(`M35.9387 5.48805C35.9166 4.60421 35.2434 4.04719 34.279 4.0675C33.3131 4.0878 32.8154 4.67712 32.6567 5.56132C32.5745 6.01985 32.601 6.49957 32.5962 6.96997C32.5881 7.77251 32.594 8.5752 32.594 9.3779C32.4685 9.43478 32.343 9.4917 32.2175 9.54866C31.7961 9.14366 31.3817 8.73102 30.9521 8.33488C27.0799 4.76502 22.4856 3.43605 17.3405 4.22591C10.0761 5.34107 4.69388 11.3891 4.06231 18.939C3.46983 26.0213 8.03881 32.8643 14.897 35.1663C21.8348 37.495 29.5543 34.7845 33.4563 28.6429C33.7074 28.2475 33.9685 27.8417 34.1218 27.4045C34.4194 26.5555 34.2699 25.765 33.4312 25.3113C32.6231 24.8743 31.8573 25.0498 31.2835 25.7915C30.9966 26.1625 30.7785 26.5856 30.5106 26.9724C28.0914 30.4658 24.7682 32.3693 20.5158 32.5766C14.8218 32.8541 9.60215 29.1608 7.94272 23.717C6.22884 18.0946 8.59939 12.0366 13.6698 9.08126C18.5986 6.20837 24.9262 7.03281 28.9148 11.0837C29.2069 11.3803 29.4036 11.7708 29.8772 12.4519C28.32 12.4519 27.1212 12.3885 25.9323 12.4704C24.8345 12.5461 24.253 13.1995 24.262 14.1166C24.2708 15.0096 24.8931 15.7485 25.9495 15.7745C28.7068 15.8424 31.4671 15.8177 34.2259 15.7884C35.1348 15.7787 35.8872 15.2584 35.9148 14.3603C36.0054 11.4048 36.0127 8.44397 35.9387 5.48805Z`)
}

// 警告 svg
function createWarnSvgIcon() {
    return createSvgIcon(`M20.5607 2.5191C10.735 2.05516 2.46528 10.1045 2.50011 20.0984C2.54469 32.8837 15.9794 41.3025 27.521 35.772C28.0597 35.5138 28.6042 35.2357 29.0745 34.8742C29.9064 34.2347 30.0797 33.3404 29.5712 32.5989C29.0382 31.8217 28.2936 31.6838 27.4596 32.0227C27.2265 32.1174 27.0066 32.2437 26.7865 32.3701C26.6008 32.4767 26.415 32.5833 26.2211 32.6712C20.8005 35.1282 15.6165 34.6504 11.0342 30.8857C6.38506 27.0662 4.83815 21.9885 6.36608 16.1605C8.23236 9.04216 15.6457 4.59129 22.7912 6.13629C30.3201 7.76418 35.1917 14.6886 33.9006 22.1467C33.6763 23.4426 33.1697 24.693 32.665 25.9388C32.4936 26.3618 32.3223 26.7846 32.1625 27.2081C31.7321 28.3488 31.8755 29.1499 32.727 29.6338C33.5625 30.1085 34.3839 29.8271 35.0848 28.8121C35.2031 28.6407 35.3005 28.4544 35.3977 28.2685C35.4242 28.2179 35.4507 28.1672 35.4776 28.1169C36.5263 26.154 37.166 24.0544 37.3992 21.8528C38.4715 11.7296 30.8594 3.00541 20.5607 2.5191ZM22.2324 19.4482C22.6221 17.6294 21.6934 16.7853 19.8682 17.1885C19.4795 17.2744 19.0887 17.3789 18.7223 17.531C17.5055 18.036 17.1067 18.9307 17.8422 20.0563C18.3665 20.8586 18.2472 21.5161 18.0255 22.2965L17.9039 22.7239C17.5079 24.1148 17.1115 25.5072 16.7935 26.9165C16.4841 28.2873 17.2241 29.1723 18.6198 29.1593C18.6749 29.1502 18.7366 29.1408 18.8028 29.1307C18.9623 29.1063 19.1482 29.078 19.332 29.0394C21.5543 28.5732 21.9094 27.8227 20.9844 25.759C20.8192 25.3904 20.8406 24.873 20.9389 24.4633C21.1123 23.7404 21.3092 23.0227 21.5061 22.3052C21.7664 21.3567 22.0267 20.4083 22.2324 19.4482ZM21.2918 10.7674C22.3383 10.7322 23.3464 11.7297 23.3245 12.7787C23.3035 13.7817 22.4311 14.6541 21.4139 14.6892C20.3685 14.7252 19.5018 13.9485 19.4202 12.9025C19.3341 11.798 20.2055 10.8041 21.2918 10.7674Z`)
}

// 根据 d 创建 svg 元素
function createSvgIcon(d) {
    // 创建SVG元素
    const svgNS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(svgNS, "svg");
    svg.setAttribute("fill", "none");
    svg.setAttribute("viewBox", "0 0 40 40");
    svg.setAttribute("height", "40");
    svg.setAttribute("width", "40");
    svg.style.alignItems = 'center';
    svg.style.justifyContent = 'center';  // 可选，如果也需要水平居中
    svg.style.display = "inline";
    svg.style.width = "1em";
    svg.style.height = "1em";
    svg.style.marginLeft = '1em';
    svg.style.pointerEvents = "none";

    // 创建path元素并设置属性
    const path = document.createElementNS(svgNS, "path");
    path.setAttribute("fill", "#428ADF");
    path.setAttribute("d", d);
    svg.appendChild(path);
    return svg;
}

// endregion

// region 微软翻译
function microsoft(origin) {
    return new Promise((resolve, reject) => {
        let from = langManager.getFrom() === 'auto' ? '' : langManager.getFrom()

        // 从 GM 缓存获取 token
        let jwtToken = tokenManager.getToken(transModel.microsoft);
        refreshToken(jwtToken).then(jwtString => {
            // 文档：https://learn.microsoft.com/zh-cn/azure/ai-services/translator/language-support
            GM_xmlhttpRequest({
                method: POST,
                url: "https://api-edge.cognitive.microsofttranslator.com/translate?from=" + from + "&to=" + langManager.getTo() + "&api-version=3.0&includeSentenceLength=true&textType=html",
                headers: LLMFormat.getStdHeader(jwtString),
                data: JSON.stringify([{Text: origin}]),
                onload: resp => {
                    try {
                        let resultJson = JSON.parse(resp.responseText);
                        resolve(resultJson[0].translations[0].text);
                    } catch (e) {
                        reject(resp.responseText);
                    }
                },
                onerror: error => reject(error)
            });
        }).catch(error => reject('Error refreshing microsoft token: ' + error))
    });
}

// 返回有效的令牌或 false
function refreshToken(token) {
    return new Promise((resolve, reject) => {
        const decodedToken = parseJwt(token);
        const currentTimestamp = Math.floor(Date.now() / 1000); // 当前时间的UNIX时间戳（秒）
        if (decodedToken && currentTimestamp < decodedToken.exp) {
            resolve(token);
            return
        }

        // 如果令牌无效或已过期，则尝试获取新令牌
        GM_xmlhttpRequest({
            method: 'GET',
            url: "https://edge.microsoft.com/translate/auth",
            onload: resp => {
                if (resp.status === 200) {
                    let token = resp.responseText;
                    if (!token) {
                        reject(resp.responseText);
                        return;
                    }
                    tokenManager.setToken(transModel.microsoft, token);
                    resolve(token);
                } else reject(resp.status, resp.responseText);
            },
            onerror: error => reject(error)
        });
    });
}


// 解析 jwt，返回解析后对象
function parseJwt(token) {
    try {
        const base64Url = token.split('.')[1];
        const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
        const jsonPayload = decodeURIComponent(atob(base64).split('').map(function (c) {
            return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
        }).join(''));
        return JSON.parse(jsonPayload);
    } catch (e) {
        return null;
    }
}

// endregion

// region openai

function openai(origin) {
    return new Promise((resolve, reject) => {
        let token = tokenManager.getToken(transModel.openai)
        let option = optionsManager.getOptionName(transModel.openai)

        if (!token) {
            reject('No token available');
            return;
        }

        GM_xmlhttpRequest({
            method: 'POST',
            url: 'https://api.openai.com/v1/chat/completions',
            headers: LLMFormat.getStdHeader(token),
            data: LLMFormat.getStdData(origin, option),
            onload: resp => {
                try {
                    let result = JSON.parse(resp.responseText);
                    resolve(result.choices[0].message.content);
                } catch (e) {
                    reject(resp.responseText);
                }
            },
            onerror: error => reject(error)
        });
    });
}

// endregion

// region moonshot
function moonshot(origin) {
    return new Promise((resolve, reject) => {
        let token = tokenManager.getToken(transModel.moonshot);
        let option = optionsManager.getOptionName(transModel.moonshot);
        if (!token) {
            reject('No token available');
            return;
        }

        GM_xmlhttpRequest({
            method: POST,
            url: 'https://api.moonshot.cn/v1/chat/completions',
            headers: LLMFormat.getStdHeader(token),
            data: LLMFormat.getStdData(origin, option),
            onload: resp => {
                try {
                    let result = JSON.parse(resp.responseText);
                    resolve(result.choices[0].message.content);
                } catch (e) {
                    reject(resp.responseText);
                }
            },
            onerror: error => reject(error)
        });
    });
}


// endregion

// region 文心一言

function yiyan(origin) {
    return new Promise((resolve, reject) => {
        getYiyanToken().then(token => {
            let option = optionsManager.getOptionName(transModel.yiyan);

            // ERNIE-Bot 4.0 模型，模型定价页面：https://console.bce.baidu.com/qianfan/chargemanage/list
            // api 文档中心：https://cloud.baidu.com/doc/WENXINWORKSHOP/s/clntwmv7t
            GM_xmlhttpRequest({
                method: POST,
                url: 'https://aip.baidubce.com/rpc/2.0/ai_custom/v1/wenxinworkshop/chat/' + option + '?access_token=' + token,
                headers: {"Content-Type": "application/json"},
                system: chatMgs.getSystemMsg(),
                data: JSON.stringify({
                    'temperature': 0.3, // 随机度
                    'disable_search': true, // 禁用搜索
                    'messages': [{"role": "user", "content": chatMgs.getUserMsg(origin)}],
                }),
                onload: resp => {
                    try {
                        let res = JSON.parse(resp.responseText);
                        resolve(res.result);
                    } catch (e) {
                        reject(resp.responseText);
                    }
                },
                onerror: error => reject(error)
            });
        }).catch(error => reject('Error getting Yiyan token: ' + error));
    });
}


// req: API Key、Secret Key
// resp: access_token，有效期默认 30 天
function getYiyanToken() {
    return new Promise((resolve, reject) => {
        // 1、尝试从 GM 中获取 token，并检测是否有效
        let v = tokenManager.getToken(transModel.yiyan)
        if (v && v.token && v.ak && v.sk && v.expiration > Date.now()) {
            resolve(v.token); // 返回有效的 token
            return
        }
        // 2、发起网络请求
        GM_xmlhttpRequest({
            method: POST,
            url: 'https://aip.baidubce.com/oauth/2.0/token',
            data: 'grant_type=client_credentials&client_id=' + v.ak + '&client_secret=' + v.sk,
            onload: resp => {
                try {
                    let res = JSON.parse(resp.responseText);
                    if (res.access_token) {
                        // 获取有效时间范围，有效期30天（单位秒），需 x1000 转换为毫秒
                        let expiration = new Date().getTime() + res.expires_in * 1000;
                        tokenManager.setToken(transModel.yiyan, {
                            ak: v.ak,
                            sk: v.sk,
                            token: res.access_token,
                            expiration: expiration
                        });
                        resolve(res.access_token);
                    } else reject(new Error(res.error_description));
                } catch (e) {
                    reject(e);
                }
            },
            onerror: error => reject(error)
        });
    })
}

// endregion

// region 通义千问
// 文档：https://help.aliyun.com/zh/dashscope/developer-reference/tongyi-thousand-questions-metering-and-billing
function tongyi(origin) {
    return new Promise((resolve, reject) => {
        let token = tokenManager.getToken(transModel.tongyi);
        let option = optionsManager.getOptionName(transModel.tongyi);
        if (!token) {
            reject('No token available');
            return;
        }

        // 发起请求
        GM_xmlhttpRequest({
            method: POST,
            url: 'https://dashscope.aliyuncs.com/api/v1/services/aigc/text-generation/generation',
            headers: LLMFormat.getStdHeader(token),
            data: JSON.stringify({
                "model": option,
                "input": {
                    "messages": [
                        {"role": "system", "content": chatMgs.getSystemMsg()},
                        {"role": "user", "content": chatMgs.getUserMsg(origin)}
                    ]
                },
                "parameters": {}
            }),
            onload: resp => {
                try {
                    let res = JSON.parse(resp.responseText);
                    resolve(res.output.text);
                } catch (e) {
                    reject(resp.responseText);
                }
            },
            onerror: error => reject(error)
        });
    });
}


// endregion

// region 智谱
function zhipu(origin) {
    return new Promise((resolve, reject) => {
        let tokenObject = tokenManager.getToken(transModel.zhipu);  // 获取 tokenObject
        let token = tokenObject.token;
        if (!token || tokenObject.expiration >= Date.now()) {
            token = generateToken(tokenObject.apikey);
        }

        let option = optionsManager.getOptionName(transModel.zhipu);

        // 发起请求
        GM_xmlhttpRequest({
            method: POST,
            url: "https://open.bigmodel.cn/api/paas/v4/chat/completions",
            headers: LLMFormat.getStdHeader(token),
            data: LLMFormat.getStdData(origin, option),
            onload: resp => {
                try {
                    let res = JSON.parse(resp.responseText);
                    resolve(res.choices[0].message.content);
                } catch (e) {
                    reject(resp.responseText);
                }
            },
            onerror: error => reject(error)
        });
    });
}


function generateToken(apiKey) {

    if (!apiKey || !apiKey.includes('.')) {
        console.log("API Key 格式错误：", apiKey)
        return;
    }
    let duration = 3600000 * 24; // 生成的 token 默认24小时后过期

    const [key, secret] = apiKey.split('.');
    let token = generateJWT(secret, {alg: "HS256", sign_type: "SIGN", typ: "JWT"}, {
        api_key: key,
        exp: Math.floor(Date.now() / 1000) + (duration / 1000),
        timestamp: Math.floor(Date.now() / 1000)
    });
    if (!token) return  // 失败则提前返回
    // 存储
    tokenManager.setToken(transModel.zhipu, {apikey: apiKey, token: token, expiration: Date.now() + duration});

    return token;
}

// 生成JWT（JSON Web Token）
function generateJWT(secret, header, payload) {
    // 对header和payload部分进行UTF-8编码，然后转换为Base64URL格式
    const encodedHeader = base64UrlSafe(btoa(JSON.stringify(header)));
    const encodedPayload = base64UrlSafe(btoa(JSON.stringify(payload)));
    // 生成 jwt 签名
    let hmacsha256 = base64UrlSafe(CryptoJS.HmacSHA256(encodedHeader + "." + encodedPayload, secret).toString(CryptoJS.enc.Base64))
    return `${encodedHeader}.${encodedPayload}.${hmacsha256}`;
}

// 将Base64字符串转换为Base64URL格式的函数
function base64UrlSafe(base64String) {
    return base64String.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// endregion

// region read
// read：异步返回 callback，表示是否需要拉取数据
function checkRun(callback) {
    // 1、检查缓存
    let pageMapCache = GM_getValue(checkKey, false);
    if (pageMapCache) {
        pageMapCache[url.host] ? callback(true) : callback(false);
    }

    // 2、网络请求
    const lastRun = GM_getValue("lastRun", undefined);
    const now = new Date().getTime();

    if (isEmpty(lastRun) || now - lastRun > expiringTime) {
        console.log("开始更新 preread 缓存");
        GM_xmlhttpRequest({
            method: POST,
            url: preread,
            onload: function (response) {
                // pagesMap 是新获取的数据，pageMapCache 是从缓存中获取的旧数据
                let pagesMap = JSON.parse(response.responseText).Data;
                pagesMap[url.host] ? callback(true) : callback(false);
                // 将 fluent_read_check 设置为新的缓存
                GM_setValue(checkKey, pagesMap);
                // 检查 preread 名单判断是否需要更新对应 host 的 read 数据
                const listValues = GM_listValues();
                listValues.forEach(host => {
                    if (pageMapCache[host] !== pagesMap[host]) {
                        GM_deleteValue(host);
                        console.log("删除过期的缓存数据：", host);
                    }
                });
                GM_setValue("lastRun", now.toString()); // 请求成功后设置当前时间
            },
            onerror: (error) => console.error("请求失败: ", error)
        });
    }
}

// read：处理 DOM 更新
function handleDOMUpdate(node) {
    // 如果数据存在则直接解析，否则发起网络请求
    let cachedData = GM_getValue(url.host, undefined);
    cachedData ? parseDfs(node, cachedData) : throttleObserveDOM();
}

// read：监听器配置
function observeDOM() {
    GM_xmlhttpRequest({
        method: POST,
        url: read,
        data: JSON.stringify({page: url.origin}),   // 请求参数
        onload: function (response) {
            console.log("新的 read 请求：", url.host);

            let respMap = JSON.parse(response.responseText).Data;
            GM_setValue(url.host, respMap);
            parseDfs(document.body, respMap);
        },
        onerror: function (error) {
            console.error("请求失败: ", error);
        }
    });
}


// read：递归提取节点文本
function parseDfs(node, respMap) {
    if (isEmpty(node)) return;

    // console.log("当前节点：", node)
    switch (node.nodeType) {
        // 1、元素节点
        case Node.ELEMENT_NODE:
            // console.log("元素节点： ", node);
            // 根据 host 获取 skip 函数，判断是否需要跳过
            let skipFn = skipStringMap[url.host];
            if (skipFn && skipFn(node)) return;
            // aria 提示信息
            if (node.hasAttribute("aria-label")) processNode(node, textType.ariaLabel, respMap);
            // 按钮与文本域节点
            if (["input", "button", "textarea"].includes(node.tagName.toLowerCase())) {
                if (node.placeholder) processNode(node, textType.placeholder, respMap);
                if (node.value && (node.tagName.toLowerCase() === "button" || ["submit", "button"].includes(node.type))) processNode(node, textType.inputValue, respMap);
            }
            break;
        // 2、文本节点
        case  Node.TEXT_NODE:
            let fn = adapterFnMap[url.host];    // 根据 host 获取 adapter 函数，判断是否需要特殊处理
            isEmpty(fn) ? processNode(node, textType.textContent, respMap) : fn(node, respMap);
            return; // 文本节点无子节点，return
    }
    let child = node.firstChild;
    while (child) {
        parseDfs(child, respMap);
        child = child.nextSibling;
    }
}

function processNode(node, attr, respMap) {
    let text;
    switch (attr) {
        case textType.textContent:
            text = node.textContent;
            break;
        case textType.placeholder:
            text = node.placeholder;
            break;
        case textType.inputValue:
            text = node.value;
            break;
        case textType.ariaLabel:
            text = node.getAttribute('aria-label');
            break;
    }

    if (pruneSet.has(text)) return;

    let formattedText = format(text);
    if (formattedText && withoutChinese(formattedText)) {
        signature(url.host + formattedText).then(sign => respMap[sign] ? replaceText(attr, node, respMap[sign]) : null)
    }
}

// endregion

// region 通用函数

// 快捷键处理
function setShortcut(shortcut) {
    // 1、移除旧的事件监听器
    if (shortcutManager.currentShortcut) {
        document.removeEventListener('keydown', shortcutListener);
        document.removeEventListener('keyup', shortcutListener);
    }

    // 2、设置新的快捷键并添加事件监听器
    shortcutManager.currentShortcut = shortcut;
    document.addEventListener('keydown', shortcutListener);
    document.addEventListener('keyup', shortcutListener);

    function shortcutListener(event) {
        if (event.key === shortcut) {   // 按下相关快捷键，调整 ctrlPressed
            shortcutManager.hotkeyPressed = (event.type === 'keydown');
        }
    }
}

// 判断是否为机器翻译
function isMachineTrans(model) {
    return [transModel.microsoft].includes(model);
}

// 检测语言类型
function baiduDetectLang(text) {
    return new Promise((resolve, reject) => {
        // 数据参数
        const data = new URLSearchParams();
        data.append('query', text);
        const url = 'https://fanyi.baidu.com/langdetect?' + data.toString();
        // 发起请求
        GM_xmlhttpRequest({
            method: POST,
            url: url,
            onload: resp => {
                const jsn = JSON.parse(resp.responseText);
                if (resp.status === 200 && jsn && jsn.lan) {
                    resolve(langManager.parseLanguage(jsn.lan));
                } else {
                    reject(new Error('Server responded with status ' + resp.status));
                }
            },
            onerror: error => {
                reject(new Error('GM_xmlhttpRequest failed'));
            }
        });
    })
}

// 计算SHA-1散列，取最后20个字符
async function signature(text) {
    if (!text) return "";
    const hashBuffer = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(text));
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    return hashHex.slice(-20);
}

// 防抖限流函数
function throttle(fn, interval) {
    let last = 0;   // 维护上次执行的时间
    return function () {
        const now = Date.now();
        // 根据当前时间和上次执行时间的差值判断是否频繁
        if (now - last >= interval) {
            last = now;
            fn();
        }
    };
}

// 判断是否为空元素
function isEmpty(node) {
    return node ? false : true;
}

// 验证并解析日期格式，如果格式不正确则返回false
function parseDateOrFalse(dateString) {
    // 正则表达式，用于检查常见的日期格式（如 YYYY-MM-DD）
    if (!regex.combinedDateRegex.test(dateString)) return false;
    // 尝试解析日期，如果无效返回 false
    const date = new Date(dateString);
    return !isNaN(date.getTime()) ? date : false;
}

// 判断字符串是否不包含中文
function withoutChinese(text) {
    return !/[\u4e00-\u9fa5]/.test(text);
}

// 文本格式化
function format(text) {
    return text.replace(/\u00A0/g, ' ').trim();
}

// 替换文本
function replaceText(type, node, value) {
    switch (type) {
        case textType.textContent:
            node.textContent = value;
            break;
        case textType.placeholder:
            node.placeholder = value;
            break;
        case textType.inputValue:
            node.value = value;
            break;
        case textType.ariaLabel:
            node.setAttribute('aria-label', value);
            break;
    }
    pruneSet.add(value)    // 剪枝
}

// 初始化程序
function initApplication() {
    // 初始化菜单栏配置
    let commonConfig = [
        {name: 'hotkey', value: 'Control'},
        {name: 'from', value: 'auto'},
        {name: 'to', value: 'zh-Hans'},
        {name: 'model', value: transModel.microsoft}
    ]
    let modelConfig = [
        {openai: "gpt-3.5-turbo"},
        {yiyan: "completions"},
        {tongyi: "qwen-turbo"},
        {zhipu: "glm-3-turbo"},
        {moonshot: "moonshot-v1-8"},
    ]
    commonConfig.forEach(v => !util.getValue(v.name) ? util.setValue(v.name, v.value) : null);
    modelConfig.forEach(option => {
        let key = Object.keys(option)[0]; // 获取对象的第一个键
        let value = option[key]; // 使用该键获取值
        if (!optionsManager.getOption(key)) optionsManager.setOption(key, value);
    });
    setShortcut(util.getValue('hotkey'));  // 快捷键设置

    // 初始化菜单
    GM_registerMenuCommand(`原始语言：${langManager.from[util.getValue('from')]}`, () => settingManager.setLanguage('from'));
    GM_registerMenuCommand(`目标语言：${langManager.to[util.getValue('to')]}`, () => settingManager.setLanguage('to'));
    GM_registerMenuCommand(`鼠标快捷键：${util.getValue('hotkey')}`, () => settingManager.setHotkey());
    GM_registerMenuCommand(`翻译服务：${transModelName[util.getValue('model')]}`, () => settingManager.setSetting());
    GM_registerMenuCommand('关于项目', () => settingManager.about());

    // 初始化翻译模型对应函数
    transModelFn[transModel.openai] = openai
    transModelFn[transModel.yiyan] = yiyan
    transModelFn[transModel.tongyi] = tongyi
    transModelFn[transModel.zhipu] = zhipu
    transModelFn[transModel.moonshot] = moonshot
    transModelFn[transModel.microsoft] = microsoft

    // 填充适配器 map
    adapterFnMap[exceptionMap.maven] = procMaven
    adapterFnMap[exceptionMap.docker] = procDockerhub
    adapterFnMap[exceptionMap.nexusmods] = procNexusmods
    adapterFnMap[exceptionMap.openai_web] = procOpenai
    adapterFnMap[exceptionMap.chatGPT] = procChatGPT
    adapterFnMap[exceptionMap.coze] = procCoze
    // 填充 skip map
    skipStringMap[exceptionMap.openai_web] = function (node) {
        return node.hasAttribute("data-message-author-role") || node.hasAttribute("data-projection-id")
    }
    skipStringMap[exceptionMap.nexusmods] = function (node) {
        return node.classList.contains("desc") || node.classList.contains("material-icons") || node.classList.contains("material-icons-outlined")
    }
    skipStringMap[exceptionMap.coze] = function (node) {
        return node.classList.contains("auto-hide-last-sibling-br")
            || node.classList.contains("jwzzTyL0ME4eVCKuxpDL")
            || node.classList.contains("XnSvnXQFZ4QHrFiqJPSG")
            || node.classList.contains("NcsIaDLOKk0l8CjedpJc")
            || ["code"].includes(node.tagName.toLowerCase())
    }
    // 引入外部 css 库
    GM_addStyle(GM_getResourceText("swalStyle"));
    GM_addStyle(`
    @keyframes spin {
        0% { transform: rotate(0deg); }
        100% { transform: rotate(360deg); }
    }
    .loading-spinner-fluentread {border: 3px solid #f3f3f3;border-top: 3px solid blue;border-radius: 50%;width: 12px;height: 12px;animation: spin 1s linear infinite;display: inline-block;}
    .translate-d-container { z-index: 999999!important; }
    .translate-d-popup { font-size: 14px !important;width:50% !important;max-width: 500px !important;}
    /* 翻译设置 */
    .instant-setting-label { display: flex;align-items: center;justify-content: space-between;padding-top: 15px;}
    .instant-setting-input { border: 1px solid #bbb; box-sizing: border-box; padding: 5px 10px; border-radius: 5px; width: 15em !important;}
    .instant-setting-textarea { border: 1px solid #bbb; box-sizing: border-box; padding: 5px 10px; border-radius: 5px; width: 18em !important;}
    .instant-setting-common { border: 1px solid #bbb; box-sizing: border-box; padding: 5px 10px; border-radius: 5px; width: 8em !important;}
    .instant-setting-select { border: 1px solid #bbb; box-sizing: border-box; padding: 5px 10px; border-radius: 5px; width: 12em !important;}
    /* 重试错误提示 */
    .retry-error-wrapper {display: inline-flex;align-items: center;}
    .retry-error-button, .retry-error-tip {color: #428ADF;text-decoration: underline;text-underline-offset: 0.2em;margin-left: 0.2em;font-size: 1em;cursor: pointer;}
    /* 工具提示 */
    .fluent-read-tooltip { position: relative; display: inline-block; }
    .fluent-read-tooltip .fluent-read-tooltiptext { visibility: hidden; width: 25em; background-color: black; color: #fff; text-align: left; border-radius: 6px; padding: 5px; position: absolute; z-index: 1; bottom: 100%; left: 50%; margin-left: -60px; opacity: 0; transition: opacity 0.6s; font-size: 14px; }
    .fluent-read-tooltip:hover .fluent-read-tooltiptext { visibility: visible; opacity: 1; }
    `
    );
}

// endregion

// region 第三方特例

// 适配 coze
function procCoze(node, respMap) {
    let text = format(node.textContent);
    if (text && withoutChinese(text)) {
        // "Auto-saved 21:28:58"
        let autoSavedMatch = text.match(regex.autoSavedRegex);
        if (autoSavedMatch) {
            node.textContent = `自动保存于 ${autoSavedMatch[1]}:${autoSavedMatch[2]}:${autoSavedMatch[3]}`;
            return;
        }

        processNode(node, textType.textContent, respMap);
    }
}

// 适配 nexusmods
function procNexusmods(node, respMap) {
    let text = format(node.textContent)
    if (text && withoutChinese(text)) {
        // 使用正则表达式匹配 text
        let commentsMatch = text.match(regex.commentsRegex);
        if (commentsMatch) {
            node.textContent = `${parseInt(commentsMatch[1], 10)} 条评论`;
            return;
        }
        // TODO 翻译待修正
        let gamesMatch = text.match(regex.gamesRegex);
        if (gamesMatch) {
            let type = gamesMatch[2] === " games" ? "份游戏" : "个收藏";  // 判断是游戏还是收藏
            node.textContent = `${gamesMatch[1]}${type}`;
            return;
        }

        let dateOrFalse = parseDateOrFalse(text);
        if (dateOrFalse) {
            node.textContent = `${dateOrFalse.getFullYear()}-${String(dateOrFalse.getMonth() + 1).padStart(2, '0')}-${String(dateOrFalse.getDate()).padStart(2, '0')}`
        }

        processNode(node, textType.textContent, respMap);
    }
}

function procOpenai(node, respMap) {
    let text = format(node.textContent);
    if (text && withoutChinese(text)) {
        let dateOrFalse = parseDateOrFalse(text);
        if (dateOrFalse) {
            node.textContent = `${dateOrFalse.getFullYear()}-${dateOrFalse.getMonth() + 1}-${dateOrFalse.getDate()}`;
            return;
        }

        processNode(node, textType.textContent, respMap);
    }
}

function procChatGPT(node, respMap) {
    let text = format(node.textContent);
    if (text && withoutChinese(text)) {
        // 提取电子邮件地址
        let emailMatch = text.match(regex.emailRegex);
        if (emailMatch) {
            node.textContent = `接收反馈邮件（${emailMatch[1]}）`;
            return;
        }
        // 验证域名
        let verifyDomainMatch = text.match(regex.verifyDomain);
        if (verifyDomainMatch) {
            node.textContent = `要验证 ${verifyDomainMatch[1]} 的所有权，请转到您的DNS提供商并添加一个带有以下值的TXT记录：`;
            return;
        }
        // 处理日期格式
        let dateOrFalse = parseDateOrFalse(text);
        if (dateOrFalse) {
            node.textContent = `${dateOrFalse.getFullYear()}-${String(dateOrFalse.getMonth() + 1).padStart(2, '0')}-${String(dateOrFalse.getDate()).padStart(2, '0')}`;
            return;
        }

        processNode(node, textType.textContent, respMap);
    }
}


// 适配 maven
function procMaven(node, respMap) {
    let text = format(node.textContent);
    if (text && withoutChinese(text)) {
        // 处理 “Indexed Repositories (1936)” 与 “Indexed Artifacts (1.2M)” 的格式
        let repositoriesMatch = text.match(regex.repositoriesRegex);
        if (repositoriesMatch) {
            let count = parseInt(repositoriesMatch[2], 10);
            node.textContent = repositoriesMatch[1] === "Repositories" ? `索引库数量（${count}）` : `索引包数量（${count * 100}万）`;
            return;
        }
        // 匹配并处理 "indexed packages" 的格式
        let packagesMatch = text.match(regex.packagesRegex);
        if (packagesMatch) {
            let count = parseInt(packagesMatch[1].replace(/,/g, ''), 10);   // 移除数字中的逗号，然后转换为整数
            node.textContent = `${count.toLocaleString()}个索引包`;
            return;
        }
        // 处理“Last Release on”格式的日期
        let lastReleaseMatch = text.match(regex.lastReleaseRegex);
        if (lastReleaseMatch) {
            let date = new Date(`${lastReleaseMatch[1]} ${lastReleaseMatch[2]}, ${lastReleaseMatch[3]}`);
            node.textContent = `最近更新 ${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
            return;
        }
        // 处理日期格式
        let dateOrFalse = parseDateOrFalse(text);
        if (dateOrFalse) {
            node.textContent = `${dateOrFalse.getFullYear()}-${String(dateOrFalse.getMonth() + 1).padStart(2, '0')}-${String(dateOrFalse.getDate()).padStart(2, '0')}`;
            return;
        }
        // 处理依赖类型
        let dependencyMatch = text.match(regex.dependencyRegex);
        if (dependencyMatch) {
            let [_, type, count] = dependencyMatch;
            node.textContent = `${regex.typeMap[type] || type}依赖 ${type} (${count})`;
            return;
        }
        // 处理排名
        let rankMatch = text.match(regex.rankRegex);
        if (rankMatch) {
            node.textContent = `第 ${rankMatch[1]} 位 ${rankMatch[2]}`;
            return;
        }
        // 处理 artifacts 被引用次数
        let artifactsMatch = text.match(regex.artifactsRegex);
        if (artifactsMatch) {
            node.textContent = `被引用 ${artifactsMatch[1]} 次`;
            return;
        }
        // 处理漏洞数量
        let vulnerabilityMatch = text.match(regex.vulnerabilityRegex);
        if (vulnerabilityMatch) {
            node.textContent = `${vulnerabilityMatch[1]}个漏洞`;
            return;
        }

        processNode(node, textType.textContent, respMap);
    }
}

function procDockerhub(node, respMap) {
    let text = format(node.textContent);
    if (text && withoutChinese(text)) {
        // 处理更新时间的翻译
        let timeMatch = text.match(regex.timeRegex);
        if (timeMatch) {
            let [_, quantity, unit, isPlural] = timeMatch;
            quantity = (quantity === 'a' || quantity === 'an') ? ' 1' : ` ${quantity}`; // 将 'a' 或 'an' 转换为 '1'
            const unitMap = {'minute': '分钟', 'hour': '小时', 'day': '天', 'month': '月',};  // 单位转换
            unit = unitMap[unit] || unit;
            node.textContent = `${quantity} ${unit}之前`;
            return;
        }
        // 处理分页信息的翻译
        let paginationMatch = text.match(regex.paginationRegex);
        if (paginationMatch) {
            let [_, start, end, total] = paginationMatch;
            total = total.replace(/,/g, ''); // 去除数字中的逗号
            node.textContent = `当前第 ${start} - ${end} 项，共 ${total} `;
            return;
        }
        // 处理 "Joined March 27, 2022"
        let joinedMatch = text.match(regex.joinedRegex);
        if (joinedMatch) {
            const date = new Date(joinedMatch[1]);
            node.textContent = `加入时间：${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
            return;
        }
        // 处理 "+5 more..."
        let moreMatch = text.match(regex.moreRegex);
        if (moreMatch) {
            node.textContent = `还有${parseInt(moreMatch[1], 10)}个更多...`;
            return;
        }

        processNode(node, textType.textContent, respMap);
    }
}

// endregion