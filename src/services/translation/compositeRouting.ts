/**
 * @file src/services/translation/compositeRouting.ts
 *
 * 文件职责：为组合翻译服务生成随机、优先顺序和智能候选顺序，保存有界的会话内健康观察。
 * 主要内容：随机策略使用无重复洗牌，顺序策略保持用户排列，智能策略结合近期成功率、响应时间和失败冷却排序；观察只包含服务身份和数值，不持久化或同步。
 * 模块边界：本文件属于翻译编排层，不调用供应商、不读取凭据或正文；broker 和连接测试仍分别拥有请求预算、取消、缓存和实际成员调用。
 */

import type {CompositeTranslationProvider} from '@/src/core/config/compositeTranslation';

interface MemberHealth {
    successRate: number;
    latencyMs: number;
    failedAt?: number;
}

const MAX_HEALTH_ENTRIES = 200;
const FAILURE_COOLDOWN_MS = 30_000;

/** 观察属于当前后台实例；重启后从用户顺序重新学习，不把历史文本或用量保存为配置。 */
export function createCompositeTranslationRoutingState(
    dependencies: {now?: () => number; random?: () => number} = {},
) {
    const now = dependencies.now ?? Date.now;
    const random = dependencies.random ?? Math.random;
    const health = new Map<string, MemberHealth>();
    const key = (profileId: string, service: string) => `${profileId}\n${service}`;

    function order(profile: CompositeTranslationProvider): string[] {
        const members = [...profile.services];
        if (profile.strategy === 'random') {
            for (let index = members.length - 1; index > 0; index -= 1) {
                const selected = Math.floor(random() * (index + 1));
                [members[index], members[selected]] = [members[selected]!, members[index]!];
            }
        } else if (profile.strategy === 'smart') {
            const timestamp = now();
            const score = (service: string) => {
                const observation = health.get(key(profile.id, service));
                if (!observation) return 1_500;
                const cooling = observation.failedAt !== undefined
                    && timestamp - observation.failedAt < FAILURE_COOLDOWN_MS;
                return observation.latencyMs / Math.max(0.1, observation.successRate)
                    + (cooling ? 100_000 : 0);
            };
            members.sort((left, right) => score(left) - score(right));
        }
        return members;
    }

    function record(profileId: string, service: string, success: boolean, durationMs: number): void {
        const identity = key(profileId, service);
        const previous = health.get(identity);
        const elapsed = Number.isFinite(durationMs) ? Math.max(1, durationMs) : 1_500;
        health.delete(identity);
        health.set(identity, {
            successRate: previous ? previous.successRate * 0.6 + (success ? 0.4 : 0) : success ? 1 : 0.3,
            latencyMs: previous ? previous.latencyMs * 0.6 + elapsed * 0.4 : elapsed,
            ...(success ? {} : {failedAt: now()}),
        });
        if (health.size > MAX_HEALTH_ENTRIES) health.delete(health.keys().next().value!);
    }

    return {order, record};
}
