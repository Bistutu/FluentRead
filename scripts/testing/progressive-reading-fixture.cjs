'use strict';

// 渐进阅读专项的本机网页与 OpenAI 兼容 HTTP 夹具。只模拟传输，生产扩展的配置、后台路由、翻译和 Vue 面板仍真实运行。
const http = require('node:http');

const SOURCE = 'If the plan does not take into account the cost, it may fail even when the bank approves it. By and large, the estimate applies only if demand remains stable.';
const TRANSLATION = '如果计划没有考虑成本，即使银行批准，也可能失败。总体而言，只有需求保持稳定时，这项估算才适用。';
const UPDATED_SOURCE = 'Unless the review is complete, the result may not apply to a new bank account.';
const UPDATED_TRANSLATION = '除非审查已经完成，否则这项结果可能不适用于新的银行账户。';
const ROUTE_SOURCE = 'If the route changes, this delayed reading request must not remain attached to the old page.';

function createProgressiveReadingFixture() {
    const requests = [];
    const lifecycle = [];
    let responseDelay = 120;
    const translate = source => {
        if (source === SOURCE) return TRANSLATION;
        if (source === UPDATED_SOURCE) return UPDATED_TRANSLATION;
        if (source === ROUTE_SOURCE) return '如果路由改变，这项延迟的阅读请求不能继续附着在旧页面上。';
        if (source.toLowerCase() === 'take into account') return '考虑；把……计入';
        if (source.toLowerCase() === 'by and large') return '总体而言';
        if (source.toLowerCase() === 'bank') return '银行（本机确定性测试响应，不验证义项判断）';
        return `本机确定性提示：${source}`;
    };
    const server = http.createServer(async (request, response) => {
        response.setHeader('access-control-allow-origin', '*');
        response.setHeader('access-control-allow-headers', '*');
        if (request.method === 'OPTIONS') {response.writeHead(204); response.end(); return;}
        if (request.url?.startsWith('/lifecycle')) {
            lifecycle.push({event: new URL(request.url, 'http://127.0.0.1').searchParams.get('event'), at: Date.now()});
            response.writeHead(204); response.end(); return;
        }
        if (request.method === 'POST' && request.url === '/v1/chat/completions') {
            try {
                const chunks = []; for await (const chunk of request) chunks.push(chunk);
                const body = JSON.parse(Buffer.concat(chunks).toString());
                const prompt = (body.messages || []).filter(message => message.role === 'user').map(message => message.content).join('\n');
                const source = /SOURCE_BEGIN([\s\S]*?)SOURCE_END/u.exec(prompt)?.[1]?.trim();
                if (!source) throw new Error('The production translation prompt did not include the fixture source delimiters');
                requests.push({source, model: body.model, at: Date.now()});
                await new Promise(resolve => setTimeout(resolve, responseDelay));
                response.setHeader('content-type', 'application/json');
                response.end(JSON.stringify({id: 'progressive-reading-local-fixture', object: 'chat.completion', created: 1, model: body.model,
                    choices: [{index: 0, message: {role: 'assistant', content: translate(source)}, finish_reason: 'stop'}]}));
            } catch (error) {
                response.writeHead(400, {'content-type': 'application/json'});
                response.end(JSON.stringify({error: {message: error.message}}));
            }
            return;
        }
        response.setHeader('content-type', 'text/html; charset=utf-8');
        response.end(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Progressive reading local fixture</title><style>html{color-scheme:light}body{margin:0;padding:36px 28px;font:18px/1.9 system-ui;background:#fff;color:#273347}article{max-width:760px}p{margin:20px 0}a{color:#16639f}button{font:inherit}#guide{margin-top:48px}@media(max-width:500px){body{padding:18px 14px;font-size:16px}}</style></head><body><article><h1 translate="no">Progressive reading local fixture</h1><p id="primary">${SOURCE}</p><p id="neighbor">This neighboring paragraph must remain selectable and unchanged. Read the <a id="host-link" href="#guide">cost guide</a> when needed.</p><p id="guide" translate="no">This is the original host link target.</p><button id="host-action" type="button" onclick="this.dataset.clicks=String(Number(this.dataset.clicks||0)+1)">Host page action</button></article><script>addEventListener('pagehide',()=>navigator.sendBeacon('/lifecycle?event=pagehide',''));addEventListener('pageshow',()=>fetch('/lifecycle?event=pageshow'));</script></body></html>`);
    });
    return {server, requests, lifecycle, setResponseDelay(milliseconds) {responseDelay = milliseconds;}, async start() {
        await new Promise((resolve, reject) => {server.once('error', reject); server.listen(0, '127.0.0.1', resolve);});
        const origin = `http://127.0.0.1:${server.address().port}`;
        return {origin, url: `${origin}/article`, endpoint: `${origin}/v1/chat/completions`};
    }, async close() {
        await new Promise(resolve => server.close(resolve));
    }};
}

module.exports = {SOURCE, TRANSLATION, UPDATED_SOURCE, UPDATED_TRANSLATION, ROUTE_SOURCE, createProgressiveReadingFixture};
