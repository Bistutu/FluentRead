'use strict';

// 局部 fixture 使用回显原槽的中文响应，逐个证明混合容器的直属正文与嵌套段落。
// 此函数可直接序列化到浏览器；只读取 DOM，不为缺失的片段创建标记或译文。
function inspectFixtureTranslationParts({parts, requireAll = false}, root = document) {
  const normalize = value => String(value ?? '').replace(/\s+/gu, ' ').trim();
  const result = parts.map(part => {
    const targets = [...root.querySelectorAll(part.selector)];
    const wrappers = targets.length === 1
      ? [...targets[0].children].filter(node => node.matches('.fluent-read-bilingual-content')) : [];
    const text = normalize(wrappers[0]?.textContent);
    // The local provider echoes each original Text slot independently. Its exact
    // prefix can occur inside links/emphasis; remove only that known marker for
    // prose comparison while keeping raw Chinese and preserved markup checks.
    const echoedSource = normalize(String(wrappers[0]?.textContent ?? '').replaceAll('测试译文：', ''));
    const translated = targets.length === 1 && wrappers.length === 1 && /[\u3400-\u9fff]/u.test(text)
      && echoedSource.includes(normalize(part.sourceIncludes))
      && (part.preservedText ?? []).every(value => text.includes(normalize(value)))
      && (part.omittedText ?? []).every(value => !echoedSource.includes(normalize(value)))
      && (part.preservedMarkup ?? []).every(expected =>
        [...wrappers[0].querySelectorAll(expected.selector)].some(node => node.textContent === expected.text));
    return {selector: part.selector, targetCount: targets.length, wrapperCount: wrappers.length, text, translated};
  });
  return requireAll ? result.every(part => part.translated) : result;
}

module.exports = {inspectFixtureTranslationParts};
