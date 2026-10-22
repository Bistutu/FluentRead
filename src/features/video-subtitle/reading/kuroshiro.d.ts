/**
 * @file src/features/video-subtitle/reading/kuroshiro.d.ts
 * 文件职责：为固定版本 kuroshiro 的纯假名转换入口声明最小类型契约。
 * 主要内容：仅声明读音 Worker 使用的 Hepburn 文本转换，不开放其 HTML 标注或全局 DOM 接口。
 * 模块边界：编译期声明，不执行初始化、不替代实际包中的转换实现。
 */
declare module 'kuroshiro' {
    const Kuroshiro: {
        Util: {kanaToRomaji(text: string, system: 'hepburn'): string};
    };
    export default Kuroshiro;
}
