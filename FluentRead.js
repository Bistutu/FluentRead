// ==UserScript==
// @name         流畅阅读
// @license      GPL-3.0 license
// @namespace    https://fr.unmeta.cn/
// @version      1.30
// @description  基于上下文语境的人工智能翻译引擎，为部分网站提供精准翻译，让所有人都能够拥有基于母语般的阅读体验。程序Github开源：https://github.com/Bistutu/FluentRead，欢迎 star。
// @author       ThinkStu
// @match        *://*/*
// @icon         data:image/png;base64,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
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
// @connect      localhost
// @connect      edge.microsoft.com
// @connect      api-edge.cognitive.microsofttranslator.com
// @connect      aip.baidubce.com
// @connect      dashscope.aliyuncs.com
// @connect      open.bigmodel.cn
// @connect      api.openai.com
// @connect      api.moonshot.cn
// @connect      fanyi.baidu.com
// @connect      gateway.ai.cloudflare.com
// @connect      api.chatanywhere.com.cn
// @connect      generativelanguage.googleapis.com
// @connect      api-free.deepl.com
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

// icon
const icon = {
    retryIcon: createRetrySvgIcon(),
    warnIcon: createWarnSvgIcon()
}

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
}

// 兼容
const compatFn = {
    "www.youtube.com": youtube,
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

const transModelFn = new Map()   // 翻译模型 map

// 翻译模型
const transModel = {    // 翻译模型枚举
    // --- LLM翻译 ---
    openai: "openai",
    gemini: "gemini",
    yiyan: "yiyan",
    tongyi: "tongyi",
    zhipu: "zhipu",
    moonshot: "moonshot",
    // --- 机器翻译 ---
    microsoft: "microsoft",
    deepL: "deepL",
    // --- 本地大模型 ---
    ollama: "ollama",
}

const LLM = new Set(
    [
        transModel.openai, transModel.yiyan, transModel.tongyi,
        transModel.zhipu, transModel.moonshot, transModel.gemini,
        transModel.ollama,
    ]
)

// 翻译模型名称
const transModelName = {
    ['machine']: '---【机器翻译】---',
    [transModel.microsoft]: '微软翻译（推荐）',
    [transModel.deepL]: 'DeepL翻译(需令牌)',
    ['llm']: '---【AI翻译】---',
    [transModel.moonshot]: 'Moonshot',
    [transModel.zhipu]: '智谱清言',
    [transModel.tongyi]: '通义千问',
    [transModel.yiyan]: '文心一言',
    [transModel.openai]: 'ChatGPT',
    [transModel.gemini]: 'Gemini',
    ['native']: '---【本地大模型】---',
    [transModel.ollama]: 'ollama',
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
    gemini: {
        "gemini-pro": "gemini-pro",
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
        // LLM 才有 option 选项
        if (LLM.has(model)) GM_setValue("model_" + model, value);
    },
    // 获取 option value
    getOptionName(model) {
        return this[model][this.getOption(model)];
    },
    getCustomOption(model) {
        return GM_getValue("model_" + model) || '';
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
                {'role': 'user', 'content': chatMgs.getUserMsg('hello')},
                {'role': "assistant", 'content': '你好'},
                {'role': 'user', 'content': origin}
            ]
        })
    },
    getOllamaData(origin, option) {
        return JSON.stringify({
            'model': option,
            "stream": false,
            "temperature": 0.1,
            'messages': [
                {'role': 'system', 'content': chatMgs.getSystemMsg()},
                {'role': 'user', 'content': chatMgs.getUserMsg(origin)},
            ]
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
const localStorageManager = {
    // 同时缓存原文和译文
    setTransCache(origin, result) {
        let model = util.getValue('model');
        let option = optionsManager.getOption(model);
        // key: 模型_文本，value: 文本
        localStorage.setItem(model + "_" + option + "_" + origin, result)
        localStorage.setItem(model + "_" + option + "_" + result, origin)
    },
    getTransCache(key) {
        let model = util.getValue('model');
        let option = optionsManager.getOption(model);
        return localStorage.getItem(model + "_" + option + "_" + key)
    },
    removeSession(key) {
        localStorage.removeItem(util.getValue('model') + "_" + key)
    },
    // 清空相关域下的 LocalStorage
    clearLocalStorageIfNewSession() {
        const lastSessionTimestamp = localStorage.getItem('lastSessionTimestamp');
        const currentTime = new Date().getTime();

        // 超过 24 小时清空 localStorage
        if (!lastSessionTimestamp || currentTime - parseInt(lastSessionTimestamp) > 24 * 3600000) {
            // if (!lastSessionTimestamp || currentTime - parseInt(lastSessionTimestamp) > 20000) {
            localStorage.clear();
        }
        // 更新时间戳
        localStorage.setItem('lastSessionTimestamp', currentTime.toString());
    }
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

// trustHTML
let safeFluentRead;
if (window.trustedTypes && window.trustedTypes.createPolicy) {
    safeFluentRead = window.trustedTypes.createPolicy("safeFluentRead", {
        createHTML: (string) => string
    });
}

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
    hotkeyOptions: {Control: 'Control', Alt: 'Alt', Shift: 'Shift', '`': '反引号键'},
    hotkeyPressed: false,
}
// 自定义 GPT地址
const customGPT = {
    openai: "https://api.openai.com/v1/chat/completions",
    setGPTUrl(model, url) {
        url = url.trim();   // 去除首尾空格
        // 解析 url，确保为 cloudflare 代理或 openai 官方地址
        let cloudflareReg = /https:\/\/gateway.ai.cloudflare.com\/v1\/\w+\/\w+\/openai\/chat\/completions/;
        if (url === this.openai
            || url === "https://api.chatanywhere.com.cn/v1/chat/completions"
            || cloudflareReg.test(url)
            // 是 127.0.0.1 或 localhost
            || url.indexOf("127.0.0.1") !== -1
            || url.indexOf("localhost") !== -1
        ) {
            GM_setValue(model + '_url', url)
            return true
        }
        return false
    },
    getGPTUrl(model) {
        if (!model) model = util.getValue('model');
        return GM_getValue(model + '_url', this.openai)
    }
}

// 鼠标悬停计时器
let hoverTimer;

const settingManager = {
    generateOptions(options, selectedValue) {
        return Object.entries(options).map(([key, value]) => {
            // 检查是否为需要禁用的选项
            const isDisabled = ['---【机器翻译】---', '---【AI翻译】---', '---【本地大模型】---'].includes(value);
            return `<option value="${key}" ${selectedValue === key ? 'selected' : ''} ${isDisabled ? 'disabled' : ''}>${value}</option>`;
        }).join('');
    },

    // 设置中心界面
    setSetting() {
        // 页面 dom
        const dom = `
  <div style="font-size: 1em;" xmlns="http://www.w3.org/1999/html">
    <label class="instant-setting-label">快捷键<select id="fluent-read-hotkey" class="instant-setting-common">${this.generateOptions(shortcutManager.hotkeyOptions, util.getValue('hotkey'))}</select></label>
    <label class="instant-setting-label">翻译源语言<select id="fluent-read-from" class="instant-setting-common">${this.generateOptions(langManager.from, langManager.getFrom())}</select></label>
    <label class="instant-setting-label">翻译目标语言<select id="fluent-read-to" class="instant-setting-common">${this.generateOptions(langManager.to, langManager.getTo())}</select></label>
    <label class="instant-setting-label">翻译服务<select id="fluent-read-model" class="instant-setting-select">${this.generateOptions(transModelName, util.getValue('model'))}</select></label>
    
    <!--支持 ollama 等自定义模型名称-->
    <label class="instant-setting-label" id="fluent-read-custom-type-label" style="display: none;">
    <span class="fluent-read-tooltip">自定义模型类型
            <span class="fluent-read-tooltiptext">
            请填写模型类型全称，如：gemma:7b、llama2:7b
            </span>
        </span>
    <input type="text" class="instant-setting-input" id="fluent-read-custom-type" value="${optionsManager.getOption(util.getValue('model'))}" ></label>
    
    <label class="instant-setting-label" id="fluent-read-option-label" style="display: none;">模型类型<select id="fluent-read-option" class="instant-setting-select"></select></label> 
    <!-- custom 输入框-->
    <label class="instant-setting-label" id="fluent-read-custom-label" style="display: none;">
        <span class="fluent-read-tooltip">自定义 GPT 地址
            <span class="fluent-read-tooltiptext">
            1、支持 OpenAI 官方地址，如：https://api.openai.com/v1/chat/completions
            </br>
            2、支持 Cloudflare 代理，如：https://gateway.ai.cloudflare.com/.../openai/chat/completions
            </br>
            3、支持国内开源代理，如：https://api.chatanywhere.com.cn/v1/chat/completions
            </br>
            4、支持本地代理，如：http://localhost:11434/v1/chat/completions
            </br>
            5、由于浏览器安全限制，如需支持其他代理，请于 GitHub 提 issue.
            </span>
        </span>
        <input type="text" class="instant-setting-input" id="fluent-read-custom" value="${customGPT.getGPTUrl()}" >
    </label>
    <!-- 令牌区域 -->
    <label class="instant-setting-label" id="fluent-read-token-label" style="display: none;">token令牌<input type="text" class="instant-setting-input" id="fluent-read-token" value="" ></label>
    <label class="instant-setting-label" id="fluent-read-ak-label" style="display: none;">ak令牌<input type="text" class="instant-setting-input" id="fluent-read-ak" value="" ></label>
    <label class="instant-setting-label" id="fluent-read-sk-label" style="display: none;">sk令牌<input type="text" class="instant-setting-input" id="fluent-read-sk" value="" ></label>
    <!-- 添加的输入区域 -->
    <label class="instant-setting-label" id="fluent-read-system-label" style="display: none;">
        <span class="fluent-read-tooltip">system角色设定<span class="fluent-read-tooltiptext">模型角色设定，如：你是一名专业的翻译家</span></span>
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
                    let model = util.getElementValue('fluent-read-model');

                    // 0、设置自定义 GPT 地址
                    if ([transModel.openai, transModel.ollama].includes(model)) {
                        let ok = customGPT.setGPTUrl(model, util.getElementValue('fluent-read-custom'));
                        if (!ok) {
                            toast.fire({
                                icon: 'error',
                                title: '自定义地址不合法，请检查后重试！'
                            });
                            return
                        }
                    }

                    // 1、设置语言
                    util.setValue('from', util.getElementValue('fluent-read-from'));
                    util.setValue('to', util.getElementValue('fluent-read-to'));
                    // 2、设置快捷键
                    util.setValue('hotkey', util.getElementValue('fluent-read-hotkey'));
                    // 3、设置翻译服务
                    util.setValue('model', model);
                    // 4、设置模型类型
                    if (model === transModel.ollama) {
                        optionsManager.setOption(model, util.getElementValue('fluent-read-custom-type'));
                    } else {
                        optionsManager.setOption(model, util.getElementValue('fluent-read-option'));
                    }
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
        if (LLM.has(model) || model === transModel.deepL) {
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
                if ([transModel.openai, transModel.moonshot, transModel.tongyi, transModel.gemini, transModel.deepL, transModel.ollama].includes(model)) {
                    token.value = tokenObject;
                    this.setDisplayStyle([tokenLabel], [akLabel, skLabel]);
                } else {
                    this.setDisplayStyle([], [tokenLabel, akLabel, skLabel]);
                }
        }
    },
    // 批量设置元素的 display 样式
    setDisplayStyle(flex, none) {
        // 消息模版
        const systemMsgLabel = document.getElementById('fluent-read-system-label');
        const userMsgLabel = document.getElementById('fluent-read-user-label');
        // 自定义 GPT 地址框
        const customLabel = document.getElementById('fluent-read-custom-label');
        const optionLabel = document.getElementById('fluent-read-option-label');
        const customTypeLabel = document.getElementById('fluent-read-custom-type-label');

        // 1、如果 flex 为空，则设置所有元素的 display 为 none，返回 / 如果是 DeepL
        let model = util.getElementValue('fluent-read-model');
        if (flex.length === 0 || model === transModel.deepL) {
            optionLabel.style.display = "none";
            systemMsgLabel.style.display = "none";
            userMsgLabel.style.display = "none";
            customLabel.style.display = "none";
            none.forEach(element => element.style.display = "none");
            flex.forEach(element => element.style.display = "flex");
            return
        }

        // 2、正常逻辑，更新选项、按需要显示元素

        customLabel.style.display = [transModel.openai, transModel.ollama].includes(model) ? "flex" : "none";  // 判断是否显示自定义 GPT 地址输入框
        document.getElementById('fluent-read-custom').value = customGPT.getGPTUrl(model);  // 设置自定义 GPT 地址

        flex.forEach(element => element.style.display = "flex");
        none.forEach(element => element.style.display = "none");
        systemMsgLabel.style.display = "flex";
        userMsgLabel.style.display = "flex";

        // 更新下拉框选项
        if (model === transModel.ollama) {
            optionLabel.style.display = "none"
            customTypeLabel.style.display = "flex"
            flex.forEach(element => element.style.display = "none");
            document.getElementById('fluent-read-custom-type').value = optionsManager.getCustomOption(model);
        } else {
            const optionSelect = document.getElementById('fluent-read-option');
            optionSelect.innerHTML = settingManager.generateOptions(optionsManager[model], optionsManager.getOption(model));
            optionLabel.style.display = "flex"
            customTypeLabel.style.display = "none"
        }
    }
    ,
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
    }
    ,
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
    }
    ,
    update() {
        // 跳转页面
        window.open('https://greasyfork.org/zh-CN/scripts/482986-%E6%B5%81%E7%95%85%E9%98%85%E8%AF%BB');
    }
    ,
    about() {
        // 跳转页面
        window.open('https://github.com/Bistutu/FluentRead');
    }
};
// endregion

// region 主函数

(function () {
    'use strict';

    initApplication()

    // 触屏监听事件：三指触摸触发翻译事件
    document.body.addEventListener('touchstart', event => {
        // 检查是否有三个触摸点以及其中心位置
        if (event.touches.length === 3) {
            let centerX = (event.touches[0].clientX + event.touches[1].clientX + event.touches[2].clientX) / 3;
            let centerY = (event.touches[0].clientY + event.touches[1].clientY + event.touches[2].clientY) / 3;
            // 调用翻译处理函数
            handler(centerX, centerY, 0, false);
        }
    });

    // 当浏览器或标签页失去焦点时，重置 ctrlPressed
    window.addEventListener('blur', () => shortcutManager.hotkeyPressed = false)

    // 鼠标、键盘监听事件，悬停翻译
    window.addEventListener('keydown', event => handler(mouseX, mouseY, 10))
    document.body.addEventListener('mousemove', event => {
        // 更新鼠标位置
        mouseX = event.clientX;
        mouseY = event.clientY;

        handler(mouseX, mouseY, 25);
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

    document.addEventListener('keydown', function (event) {
        // F2 清空当前页面所有翻译缓存
        if (event.key === 'F2') {
            localStorage.clear()
            toast.fire({icon: 'success', title: '当前页面翻译缓存清空成功！'});
        }

        // 快捷键 F1，清空所有缓存
        // if (event.key === 'F1') {
        //     let listValues = GM_listValues();
        //     listValues.forEach(e => GM_deleteValue(e))
        //     console.log('Cache cleared!');
        // }

        // 鼠标选中事件，暂未开放
        // if (event.key === 'F3') {
        //     translateSelectedText();
        // }
    });
})();

// 监听事件处理器，参数：鼠标坐标、计时器
function handler(mouseX, mouseY, time, noSkip = true) {
    if (noSkip && !shortcutManager.hotkeyPressed) return;

    clearTimeout(hoverTimer); // 清除计时器
    hoverTimer = setTimeout(() => {
        let node = getTransNode(document.elementFromPoint(mouseX, mouseY));  // 获取最终需要翻译的节点
        if (!node) return;  // 如果不需要翻译，则跳过

        if (hasLoadingSpinner(node)) {    // 如果已经在翻译，则跳过
            // console.log('正在翻译中...跳过');
            return;
            // }else {
            //     console.log('翻译节点：', node);
        }

        // 去重判断
        let outerHTMLTemp = node.outerHTML;
        if (outerHTMLSet.has(outerHTMLTemp)) {
            // console.log('重复节点', node);
            return;
        }
        outerHTMLSet.add(outerHTMLTemp);

        // 检测缓存 cache
        let outerHTMLCache = localStorageManager.getTransCache(node.outerHTML);
        if (outerHTMLCache) {
            // console.log("缓存命中：", outerHTMLCache);
            let spinner = createLoadingSpinner(node, true);
            setTimeout(() => {  // 延迟 remove 转圈动画与替换文本
                spinner.remove();
                outerHTMLSet.delete(outerHTMLTemp);
                let fn = compatFn[url.host];    // 兼容函数
                if (fn) {
                    fn(node, outerHTMLCache);    // 兼容函数
                } else {
                    node.outerHTML = safeFluentRead ? safeFluentRead.createHTML(outerHTMLCache) : outerHTMLCache;
                }
                delayRemoveCache(outerHTMLCache);
            }, 250);
            return;
        }

        translate(node);
    }, time);
}

const getTransNodeSet = new Set(['span']);
// 特例集合
const specialSet = new Set([
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',  // 标题
    'p',         // 段落（p 标签通常代表一句完整的话）
    "li",        // 列表
    'yt-formatted-string',   // youtube 评论
]);

// 特例适配
const getTransNodeCompat = new Map([
    ["mvnrepository.com", node => {
        if (node.tagName.toLowerCase() === 'div' && node.classList.contains('im-description')) return true
    },
        "www.aozora.gr.jp", node => {
        if (node.tagName.toLowerCase() === 'div' && node.classList.contains('main_text')) return true
    },
    ],
]);

// 返回最终应该翻译的父节点或 false
function getTransNode(node) {
    let model = util.getValue('model')
    // 1、全局节点与空节点、文字过多的节点、class="notranslate" 的节点不翻译
    if (!node || [document.documentElement, document.body].includes(node)
        || node.tagName.toLowerCase() === "iframe" || node.classList.contains('notranslate')
        || node.textContent.length > 8192
    ) return false;
    // 2、特例适配标签，遇到这些标签则直接返回节点
    if (specialSet.has(node.tagName.toLowerCase())) return node;
    // 3、特例适配函数，根据 host 适配、且支持匹配 class
    let fn = getTransNodeCompat.get(url.host);
    if (fn && fn(node)) return node;
    // 4、检测当前节点是否满足翻译条件
    if (getTransNodeSet.has(node.tagName.toLowerCase()) || detectChildMeta(node)) {
        return getTransNode(node.parentNode) || node;   // 如果当前节点满足翻译条件，则向上寻找最终符合的父节点
    }
    // 5、如果节点是div并且不符合一般翻译条件，可翻译首行文本
    if (node.tagName.toLowerCase() === 'div') {
        // 遍历子节点，寻找首个文本节点或 a 标签节点
        let child = node.firstChild;
        while (child) {
            if (child.nodeType === Node.TEXT_NODE && child.textContent.trim() !== '') {
                transModelFn[model](child.textContent).then(text => {
                    child.textContent = text;
                })
                return false; // 只翻译首行文本
            }
            child = child.nextSibling;
        }
    }
    // 6、翻译文本节点
    if (node.nodeType === Node.TEXT_NODE && node.textContent.trim() !== '') {
        transModelFn[model](node.textContent).then(text => {
            node.textContent = text;
        })
        return false; // 只翻译文本节点
    }

    // console.log('不翻译节点：', node);
    return false
}

// node 的 parentNode 只含有这些标签时，会向上翻译 parentNode
const detectChildMetaSet = new Set([
    'a', 'b', 'strong', 'span', 'p', 'img',
    'br', 'em', 'u', 'small', 'sub', 'sup', 'i',
    'font', 'big', 'strike', 's', 'del', 'ins',
    'mark', 'cite', 'q', 'abbr', 'acronym', 'dfn',
    'code', 'samp', 'kbd', 'var', 'pre', 'address',
    'time', 'ruby', 'rb', 'rt', 'rp', 'bdi', 'bdo', 'wbr',
    'details', 'summary', 'menuitem', 'menu', 'dialog',
    'slot', 'template', 'shadow', 'content', 'element',
]);

// 检测子元素中是否包含指定标签以外的元素
function detectChildMeta(parent) {
    let child = parent.firstChild;
    while (child) {
        if (child.nodeType === Node.ELEMENT_NODE && !detectChildMetaSet.has(child.nodeName.toLowerCase())) {
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

    if (!node.innerText.trim()) return; // 空文本，跳过

    // 检测语言类型，如果是中文则不翻译
    reliableDetectLang(node.innerText).then(lang => {
        if (lang === langManager.getTo()) return;   // 与目标语言相同，不翻译

        // 如果是机器翻译，则翻译 outerHTML，否则递归获取文本
        let origin = isMachineTrans(model) ? node.outerHTML : getTextWithNode(node);

        let spinner = createLoadingSpinner(node);   // 插入转圈动画
        let timeout = setTimeout(() => {
            createFailedTip(node, new Error(errorManager.netError).toString(), spinner);
        }, 60000);

        // 调用翻译服务
        transModelFn[model](origin).then(text => {

            clearTimeout(timeout) // 取消超时
            spinner.remove()      // 移除 spinner

            // console.log("翻译前的句子：", origin);
            // console.log("翻译后的句子：", text);

            if (!text || origin === text) return;

            let oldOuterHtml = node.outerHTML  // 保存旧的 outerHTML

            let newOuterHtml = text
            if (isMachineTrans(model)) {
                // 机器翻译
                if (!node.parentNode) return;
                let fn = compatFn[url.host];
                if (fn) {
                    oldOuterHtml = node.outerHTML;
                    fn(node, text);
                    newOuterHtml = node.outerHTML;
                } else {
                    node.outerHTML = safeFluentRead ? safeFluentRead.createHTML(text) : text;
                }
            } else {
                // LLM 翻译
                node.innerHTML = safeFluentRead ? safeFluentRead.createHTML(text) : text;
                newOuterHtml = node.outerHTML;
            }

            localStorageManager.setTransCache(oldOuterHtml, newOuterHtml);   // 设置缓存
            // 延迟 newOuterHtml，删除 oldOuterHtml
            delayRemoveCache(newOuterHtml);
            outerHTMLSet.delete(oldOuterHtml);
        }).catch(e => {
            console.log(e)
            clearTimeout(timeout);
            createFailedTip(node, e.toString() || errorManager.unknownError, spinner);
        })
    }).catch(e => {
        console.log(e)
        createFailedTip(node, e.toString() || errorManager.unknownError)
    })
}

const getTextWithNodeSet = new Set([
    'div', 'br',
    'code', 'a', 'strong', 'b', 'em', 'i', 'u', 's', 'del',
    'ins', 'mark', 'small', 'sub', 'sup', 'big', 'font',
    'abbr', 'acronym', 'cite', 'dfn', 'kbd', 'samp', 'var',
    'pre', 'q', 'blockquote', 'address', 'time', 'ruby', 'rt',
    'rp', 'bdi', 'bdo', 'wbr', 'details', 'summary', 'menuitem',
    'menu', 'dialog', 'slot', 'template', 'shadow', 'content', 'element',
])

// LLM 模式获取翻译文本
function getTextWithNode(node) {
    let text = "";
    // 遍历所有子节点
    node.childNodes.forEach(child => {
        if (child.nodeType === Node.TEXT_NODE) {
            // 文本节点：直接添加其文本
            text += child.nodeValue;
        } else if (child.nodeType === Node.ELEMENT_NODE) {
            // 检查是否为特定节点
            if (getTextWithNodeSet.has(child.tagName.toLowerCase())) {
                text += child.outerHTML;    // 添加至 outerHTML
            } else {
                text += getTextWithNode(child); // 递归
            }
        }
    });
    return text;
}

// endregion

// region 翻译兼容
function youtube(node, text) {
    // 替换 innerText
    let temp = document.createElement('span');
    temp.innerHTML = text;
    node.innerHTML = temp.innerText;
    return node.outerHTML;
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

// region deepL
// native 判断是否为本地部署模型（native 不支持 html，暂保留）
function deepL(origin, native = false) {
    return new Promise((resolve, reject) => {
        let target_lang = langManager.getTo();
        if (target_lang === 'zh-Hans') target_lang = 'zh';  // DeepL 不支持 zh-Hans

        // 获取 DeepL API 密钥
        let deepLAuthKey = tokenManager.getToken(transModel.deepL);

        // 判断是否为本地部署模型（模型所需参数些许不同）
        let text = native ? origin : [origin]
        let url = native ? "http://127.0.0.1:1188/translate" : "https://api-free.deepl.com/v2/translate"

        // 发起翻译请求
        GM_xmlhttpRequest({
            method: 'POST',
            url: url,
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'DeepL-Auth-Key ' + deepLAuthKey
            },
            data: JSON.stringify({
                text: text,
                target_lang: target_lang,
                tag_handling: 'html',
                context: url.host + document.title,   // 添加上下文辅助
                preserve_formatting: true
            }),
            onload: resp => {
                try {
                    let resultJson = JSON.parse(resp.responseText);
                    if (native) resolve(resultJson.data);
                    else resolve(resultJson.translations[0].text);
                } catch (e) {
                    reject(resp.responseText);
                }
            },
            onerror: error => reject(error)
        });
    });
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
            method: POST,
            url: customGPT.getGPTUrl(),
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

// region ollama

function ollama(origin) {
    return new Promise((resolve, reject) => {
        let option = optionsManager.getCustomOption(transModel.ollama)
        GM_xmlhttpRequest({
            method: POST,
            url: customGPT.getGPTUrl(),
            headers: {'Content-Type': 'application/json'},
            data: LLMFormat.getOllamaData(origin, option),
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

// region gemini
function gemini(origin) {
    return new Promise((resolve, reject) => {
        // 获取 token 和选项，这里的 tokenManager 和 optionsManager 应由您实现
        let token = tokenManager.getToken('gemini');
        let option = optionsManager.getOption('gemini');    // gemini-pro

        // 检查 token 是否存在
        if (!token) {
            reject('No token available');
            return;
        }

        // 发送请求
        GM_xmlhttpRequest({
            method: POST,
            url: "https://generativelanguage.googleapis.com/v1beta/models/" + option + ":generateContent?key=" + token,
            headers: {'Content-Type': 'application/json'},
            data: JSON.stringify({
                "contents": [
                    {
                        "role": "user",
                        "parts": [{"text": chatMgs.getSystemMsg() + chatMgs.getUserMsg("hello")}]
                    },
                    {
                        "role": "model",
                        "parts": [{"text": "你好"}]
                    },
                    {
                        "role": "user",
                        "parts": [{"text": origin}]
                    }]
            }),
            onload: response => {
                try {
                    let result = JSON.parse(response.responseText);
                    resolve(result.candidates[0].content.parts[0].text);
                } catch (e) {
                    reject(response.responseText);
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
                    'messages': [
                        {"role": "user", "content": chatMgs.getUserMsg("hello")},
                        {"role": "assistant", "content": "你好"},
                        {"role": "user", "content": origin}
                    ],
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
                            ak: v.ak, sk: v.sk, token: res.access_token, expiration: expiration
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
                        {"role": "user", "content": chatMgs.getUserMsg("hello")},
                        {"role": "assistant", "content": "你好"},
                        {"role": "user", "content": origin}
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
    return [transModel.microsoft, transModel.deepL].includes(model);
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
                    console.log(resp)
                    reject(new Error('Server responded with status ' + resp));
                }
            },
            onerror: error => {
                reject(new Error('baiduDetectLang GM_xmlhttpRequest failed'));
            }
        });
    })
}

function detectLang(text) {
    return new Promise((resolve, reject) => {
        // 数据参数
        const data = new URLSearchParams();
        data.append('text', text);
        // 发起请求
        GM_xmlhttpRequest({
            method: 'POST',
            url: 'https://fr.unmeta.cn/detect',
            data: data.toString(),
            headers: {"Content-Type": "application/x-www-form-urlencoded"},
            onload: function (response) {
                if (response.status === 200) {
                    const jsn = JSON.parse(response.responseText);
                    if (jsn && jsn.language) resolve(jsn.language);
                } else {
                    reject(new Error('Server responded with status ' + response.status));
                }
            },
            onerror: () => reject(new Error('GM_xmlhttpRequest failed'))
        });
    });
}

// 可靠的语言检测（竞速）
function reliableDetectLang(text) {
    let fail = false;
    return new Promise((resolve, reject) => {
        detectLang(text)
            .then(resolve)
            .catch(error => {
                if (fail) reject('Both methods failed' + error);
                else fail = true;
            });

        baiduDetectLang(text)
            .then(resolve)
            .catch(error => {
                if (fail) reject('Both methods failed' + error);
                else fail = true;
            });
    });
}

// 翻译选中的文本
function translateSelectedText() {
    const selectedText = window.getSelection().toString();
    if (selectedText.length > 5) {  // 如果选中文本长度大于 5 字符，则翻译（避免误触事件）
        // 检查原始文本是否以换行符结尾
        const endsWithNewline = selectedText.endsWith('\n');

        let model = util.getValue('model');
        transModelFn[model](selectedText).then(translatedText => {
            replaceSelectedText(translatedText, endsWithNewline);
        });
    }
}

// 替换选中范围内的文本
function replaceSelectedText(replacementText, endsWithNewline) {
    const selection = window.getSelection();
    if (!selection.rangeCount) return false;
    selection.deleteFromDocument();

    // 创建一个 span 元素来包含翻译后的文本
    const span = document.createElement('span');
    span.textContent = replacementText;
    if (endsWithNewline) span.appendChild(document.createElement('br'));

    // 获取当前选中范围的第一个 Range 对象
    const range = selection.getRangeAt(0);
    range.insertNode(span);

}


// 延迟删除缓存
function delayRemoveCache(key, time = 250) {
    outerHTMLSet.add(key);
    setTimeout(() => {
        outerHTMLSet.delete(key);
    }, time);
}

function createFailedTip(node, errorMsg, spinner) {
    // console.log(errorMsg); // 打印错误信息
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
            errorMsg = errorManager.authFailed
        }
        if (errorMsg.includes("quota") || errorMsg.includes("limit")) {
            window.alert(errorManager.quota);
        }
        window.alert(errorMsg || errorManager.unknownError);
    });

    // 将 SVG 图标和文本添加到包装元素
    wrapper.appendChild(icon.retryIcon);
    wrapper.appendChild(retryButton);
    wrapper.appendChild(icon.warnIcon);
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

// 创建转圈动画并插入
function createLoadingSpinner(node, isCache) {
    const spinner = document.createElement('span');
    spinner.className = 'loading-spinner-fluentread';
    if (isCache) spinner.style.borderTop = '3px solid green'
    node.appendChild(spinner);
    return spinner;
}

// 递归检查是否包含 spinner
function hasLoadingSpinner(node) {
    if (node.classList.contains('loading-spinner-fluentread')) return true;
    for (let child of node.children) {
        if (hasLoadingSpinner(child)) return true;
    }
    return false;
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
    // 判断是否需要清除当前页面的缓存
    localStorageManager.clearLocalStorageIfNewSession()
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
        {gemini: "gemini-pro"},
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
    GM_registerMenuCommand(`鼠标快捷键：${shortcutManager.hotkeyOptions[util.getValue('hotkey')]}`, () => settingManager.setHotkey());
    GM_registerMenuCommand(`翻译服务：${transModelName[util.getValue('model')]}`, () => settingManager.setSetting());
    GM_registerMenuCommand('检查更新', () => settingManager.update());
    GM_registerMenuCommand('关于项目', () => settingManager.about());

    // 初始化翻译模型对应函数
    transModelFn[transModel.microsoft] = microsoft
    transModelFn[transModel.deepL] = deepL

    transModelFn[transModel.openai] = openai
    transModelFn[transModel.yiyan] = yiyan
    transModelFn[transModel.tongyi] = tongyi
    transModelFn[transModel.zhipu] = zhipu
    transModelFn[transModel.moonshot] = moonshot
    transModelFn[transModel.gemini] = gemini

    transModelFn[transModel.ollama] = ollama

    // 填充适配器 map
    adapterFnMap[exceptionMap.maven] = procMaven
    adapterFnMap[exceptionMap.docker] = procDockerhub
    adapterFnMap[exceptionMap.openai_web] = procOpenai
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
    
     /* 适配移动端 */
    @media (max-width: 600px) {
        .translate-d-popup {
            font-size: 12px !important; /* 调整字体大小 */
            width: 90% !important; /* 在小屏幕上占据更多空间 */
        }
        .instant-setting-input,
        .instant-setting-textarea,
        .instant-setting-common,
        .instant-setting-select {
            width: 60% !important; /* 调整宽度以适应屏幕 */
        }
    
        .fluent-read-tooltip .fluent-read-tooltiptext {
            width: 18em; /* 调整工具提示宽度 */
            font-size: 12px; /* 调整工具提示字体大小 */
        }
    }
    `
    );
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
            node.textContent = `Last Release on ${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
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