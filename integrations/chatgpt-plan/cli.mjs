#!/usr/bin/env node
/**
 * @file integrations/chatgpt-plan/cli.mjs
 * FluentRead 本机 ChatGPT 套餐助手的独立 Node 入口；不需要 API Key 或额外依赖。
 * 仅展示一次性配对码和运行状态，绝不打印 OAuth URL、账号内容或 OpenAI 凭证。
 */
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { createChatGPTPlanBridge, BRIDGE_PORT } from './bridge.mjs';

const argumentsList = process.argv.slice(2);
if (argumentsList.includes('--help')) {
  console.log('用法：node integrations/chatgpt-plan/cli.mjs [--data-dir 路径]\n固定监听 127.0.0.1:18743。终端输入 pair 生成新配对码，Ctrl+C 退出。');
  process.exit(0);
}
if (Number(process.versions.node.split('.')[0]) < 20) {
  console.error('本机助手需要 Node.js 20 或更高版本。'); process.exit(1);
}
let directory = join(homedir(), '.config', 'fluentread-chatgpt-plan');
for (let index = 0; index < argumentsList.length; index++) {
  const option = argumentsList[index];
  const value = argumentsList[++index];
  if (option === '--data-dir' && value) directory = value;
  else { console.error('命令参数无效。使用 --help 查看用法。'); process.exit(1); }
}
let bridge;
try { bridge = await createChatGPTPlanBridge({ directory, port: BRIDGE_PORT }); }
catch (failure) {
  console.error(failure.code === 'EADDRINUSE' ? '本机助手端口 18743 已被占用，请关闭已有助手或占用该端口的程序。'
    : failure.message === 'BRIDGE_ALREADY_RUNNING' ? '该凭证目录已有助手运行，请复用现有助手。' : '本机助手无法启动，请检查目录权限和 Node.js 版本。');
  process.exit(1);
}
console.log(`FluentRead ChatGPT 本机助手已启动：${bridge.url}`);
function printPairCode() { console.log(`一次性配对码（5 分钟内有效）：${bridge.issuePairCode()}`); }
printPairCode();
console.log('在 FluentRead 设置中输入此码。终端输入 pair 可生成新码，Ctrl+C 退出。');
const lines = createInterface({ input: process.stdin, output: process.stdout });
lines.on('line', (line) => { if (line.trim() === 'pair') printPairCode(); });
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true; lines.close();
  await bridge.close(); process.exit(0);
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
