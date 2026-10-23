'use strict';

// 仅报告本地浏览器 guard 已定义的公开错误码；不从消息推断阶段，不复制任意错误属性。
const PUBLIC_CODES = new Set([
  'CDP_CONNECT_TIMEOUT', 'CDP_QUERY_TIMEOUT', 'DETACH_TIMEOUT', 'NATIVE_CLOSE_TIMEOUT',
  'CONTEXT_CLOSE_TIMEOUT', 'PS_TIMEOUT', 'PROFILE_INVALID', 'PS_INVALID', 'PLATFORM_UNSUPPORTED',
  'OWNERSHIP_UNKNOWN', 'IDENTITY_CHANGED', 'TERMINATION_TIMEOUT', 'PROFILE_CHANGED',
  'HELPER_UNSUPPORTED', 'SESSION_UNGUARDED', 'FOCUS_SAFETY_VIOLATION',
]);
const MAX_NODES = 128, MAX_DEPTH = 32;
const PREFIX = '[site-error-codes] ';

function ownDataProperty(value, key) {
  try {
    const property = Object.getOwnPropertyDescriptor(value, key);
    if (!property) return {status: 'absent'};
    return Object.hasOwn(property, 'value')
      ? {status: 'available', value: property.value} : {status: 'unreadable'};
  } catch { return {status: 'unreadable'}; }
}

function collectErrorCodes(error) {
  const seen = new Map();
  let count = 0;
  function visit(current, depth) {
    if (current === null || !['object', 'function'].includes(typeof current)) return {codeStatus: 'non-object'};
    if (seen.has(current)) return {reference: seen.get(current)};
    if (depth > MAX_DEPTH || count >= MAX_NODES) return {truncated: true};
    const id = ++count;
    seen.set(current, id);
    const code = ownDataProperty(current, 'code');
    const result = {id, codeStatus: code.status};
    if (code.status === 'available') {
      // A code can contain a token or user-controlled data; only this explicit public vocabulary is persisted.
      result.codeStatus = typeof code.value === 'string' && PUBLIC_CODES.has(code.value) ? 'reported' : 'omitted';
      if (result.codeStatus === 'reported') result.code = code.value;
    }
    const cause = ownDataProperty(current, 'cause');
    if (cause.status === 'available') result.cause = visit(cause.value, depth + 1);
    else if (cause.status === 'unreadable') result.causeStatus = 'unreadable';
    const errors = ownDataProperty(current, 'errors');
    if (errors.status === 'unreadable') result.errorsStatus = 'unreadable';
    else if (errors.status === 'available') {
      let array;
      try { array = Array.isArray(errors.value); } catch { array = false; }
      if (!array) result.errorsStatus = 'non-array';
      else {
        const length = ownDataProperty(errors.value, 'length');
        if (length.status !== 'available' || !Number.isSafeInteger(length.value) || length.value < 0) {
          result.errorsStatus = 'unreadable';
        } else {
          result.errors = [];
          for (let index = 0; index < Math.min(length.value, MAX_NODES); index += 1) {
            if (count >= MAX_NODES || depth >= MAX_DEPTH) {
              result.truncatedErrors = true;
              break;
            }
            const child = ownDataProperty(errors.value, String(index));
            result.errors.push(child.status === 'available' ? visit(child.value, depth + 1) : {codeStatus: child.status});
          }
          if (length.value > MAX_NODES) result.truncatedErrors = true;
        }
      }
    }
    return result;
  }
  return visit(error, 0);
}

function reportErrorCodes(error, phase, write = chunk => process.stderr.write(chunk)) {
  try {
    if (!['terminal', 'cleanup'].includes(phase)) return;
    write(PREFIX + JSON.stringify({pid: process.pid, phase, error: collectErrorCodes(error)}) + '\n');
  } catch { /* 旁路日志失败不能覆盖原始异常、清理结果或 CLI 退出状态。 */ }
}

// 独立退出码让矩阵停止分发和重试；只相信已有公开错误码，不从错误文案推断。
const FOCUS_SAFETY_EXIT_CODE = 86;
function siteTestExitCode(error) {
  const pending = [collectErrorCodes(error)];
  while (pending.length) {
    const item = pending.pop();
    if (item.code === 'FOCUS_SAFETY_VIOLATION') return FOCUS_SAFETY_EXIT_CODE;
    if (item.cause) pending.push(item.cause);
    if (item.errors) pending.push(...item.errors);
  }
  return 1;
}

module.exports = {collectErrorCodes, reportErrorCodes, siteTestExitCode, FOCUS_SAFETY_EXIT_CODE};
