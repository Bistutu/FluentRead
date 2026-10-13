这些夹具都是虚构的研究文章，人物、句子、链接和 `SYNTHETIC-SECRET` 标记不来自真实用户。

`pageContextDefuddle.test.ts` 将原始 HTML 安装为 live document，通过生产的 `getPageTranslationContext` 执行快照、隐私清洗、锁定的 Defuddle core 提取和生产 Markdown 转换。测试不把未清洗 HTML 直接传入转换器，也不依赖 `defuddle/full`。

夹具覆盖标题、列表起始编号与嵌套、引用、常规/不齐/单列/嵌套/合并表格、行内语义、MathJax 标准化后公式、脚注、提示块、定义和中英混合正文。Linkedom 提供分离 DOM 的确定性结构证据，不能替代浏览器布局、实际网站或真人验收。
