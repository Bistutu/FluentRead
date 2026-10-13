# 流畅阅读品牌宣传语

**Closer languages. A bigger world.**

**让语言更近，让世界更大。**

## 多语言文案

| 语言 | 宣传语 |
| --- | --- |
| 简体中文 | 让语言更近，让世界更大。 |
| English | Closer languages. A bigger world. |
| 日本語 | 言葉をもっと身近に。世界をもっと広く。 |
| 한국어 | 언어는 더 가깝게. 세상은 더 넓게. |
| Français | Des langues plus proches. Un monde plus grand. |
| Русский | Языки ближе. Мир больше. |
| Español | Idiomas más cercanos. Un mundo más grande. |

## 展示约定

宣传语用于 README 首屏、官网首页与页脚、设置侧栏、关于页、首次欢迎页、商店介绍、宣传图片和社区文案。界面中的宣传语跟随界面语言；首次欢迎页和中英文 README 同时展示中英文，便于尚未选择语言的用户理解。

保留原有标点，可以在两句话之间换行。宣传语附近保留“开源浏览器双语翻译插件”等具体产品介绍，让首次接触流畅阅读的用户了解用途。不要把功能说明中的“双语阅读”“双语翻译”机械替换成宣传语。

## 维护入口

七种语言的唯一文案来源为 [`src/core/i18n/messages/brand-taglines.json`](../src/core/i18n/messages/brand-taglines.json)。扩展语言目录的 `brand.tagline`、官网、用户脚本 metadata 和宣传图生成脚本都复用该文件。README、商店短介绍、`package.json` 和本页为可直接复制的静态文案，同步修改后运行 `pnpm verify:brand` 检查一致性。

语言资源改动后运行 `pnpm generate:userscript-languages`。非英文用户脚本资源生成后，先提交新资源，再将 `userscript/vite.config.ts` 的 `userscriptLanguageResourceCommit` 指向包含这些文件的提交，最后重新构建并校验用户脚本。

宣传图运行 `node scripts/build-product-assets.cjs --promo-only --runtime <Node 包目录>` 重新生成；需检查 440×280 与 1400×560 的中英文图片均完整显示两句话。仓库内更新不代表商店或官网已经发布。
