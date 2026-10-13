/**
 * @file src/ui/dateFormat.ts
 * 文件职责：让同一 Vue 组件同步模板中的日期保持现有本地化规则，避免逐行重复初始化原生格式器。
 * 主要内容：在 setup 内快照固定选项并创建日期函数，首次调用才构造格式器，每次组件更新前丢弃上一轮实例，下一轮重新读取可选语言与系统默认 locale/时区；构造失败不保留实例，允许同轮重试。
 * 模块边界：只供本组件同步模板调用，不用于 computed、异步回调或子组件 slot；不缓存日期、用户正文或跨组件/SSR 请求状态，也不监听操作系统变化。
 */
import {onBeforeUpdate} from 'vue';

export function useRenderDateFormatter(options: Intl.DateTimeFormatOptions, getLocales?: () => Intl.LocalesArgument | undefined): (value: number) => string {
    const rules = {...options};
    let formatter: Intl.DateTimeFormat | undefined;
    onBeforeUpdate(() => {formatter = undefined;});
    return value => (formatter ??= new Intl.DateTimeFormat(getLocales?.(), rules)).format(value);
}
