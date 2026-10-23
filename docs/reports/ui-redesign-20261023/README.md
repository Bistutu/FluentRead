# UI 信息层级改版验收（2026-10-23）

保留流畅阅读的粉色品牌、原有皮肤和 Vue/WXT 架构，把主要操作、当前内容和必要状态放在优先位置。共享设置卡片统一边界、留白与标题，次要配置默认收起；设置搜索和锚点仍能展开并定位目标。

## 设计取舍与复用

- 设置页恢复清晰的桌面标题，统一卡片与页内导航。窄屏使用顶部分类选择器，避免重复标题占用正文高度。
- 通用设置保留默认服务、目标语言和显示方式；功能独立服务收进折叠卡片，缺凭据或已启用功能不可用时仍在摘要提醒。
- Popup 把悬浮、划词开关放在抽屉标题旁；移除重复快捷键和含义不明的服务数量。常用服务直接可见，更多服务按需展开，搜索仍覆盖完整目录。
- 皮肤以名称和配色缩略图供比较，只展示当前选择的说明。保留完整可访问名称、悬停说明及方向键、Home/End 操作。
- 免费服务先显示路由策略和启用数量，17 个节点的状态、权重及配置按需展开。收起后不读取权重、不保留轮询，展开才读取；关闭会取消请求并忽略晚到结果。
- 空材料库不显示无效筛选，管理与恢复入口仍可访问。长笔记原位展开全文，阅读与编辑分开；取消编辑保留原文和搜索条件。
- 文档翻译完成后以下载为主操作，保留重新翻译；更改翻译设置后重新突出翻译。确认框返回或 Esc 不提交请求，原结果仍可下载。

复用入口为 `SettingsGroup`、`SettingsItem`、新增的 `SettingsDisclosure` 和 `src/ui/styles/tokens.css`。折叠组件使用原生 details/summary，无额外观察器或轮询，内容始终挂载以保留草稿。规则与真实组件示例见[设计系统与组件预览](../../guide/design-system.md)。本轮没有复制或修改参考仓库代码。

移除了 3 条已无 UI 使用的旧翻译校正；已发布 userscript 远程语言包通过独立投影保留原字节和固定引用，避免破坏已有资源校验。

## 验收范围

| 专项 | 结果 | 已验证内容 |
| --- | --- | --- |
| 主 UI | 85 项，96 张截图 | 16 个设置分类的 1440/390px 浅深主题；皮肤另覆盖 820px、中英文及键盘选择；服务搜索、折叠揭示、Popup 快关与重开保存 |
| 服务与学习 | 7 组流程，23 张截图 | 17 个节点开关持久化、浏览服务不改默认、空材料恢复文件入口、八行笔记展开及取消编辑；1440/390px 浅深主题 |
| 文档 | 12 项，9 张截图 | 1440/900px 主次操作切换、两种取消重译方式、改变目标语言、实际双语 TXT 下载；只产生 1 次本机翻译请求 |

三项专项均使用生产扩展、临时 Edge profile 和第二块屏幕上的后台可见窗口，记录 `macos-background-cdp`、`launchservices-no-foreground`、`background-visible-no-focus`，前台 PID 未被测试浏览器占用。未发现页面错误或横向溢出，自有浏览器和 profile 均已清理。桌面各分类、窄屏深色及所有改动交互的代表截图已实际逐组查看。

组件与生命周期定向测试覆盖 Popup、设置搜索/锚点、皮肤键盘交互、服务目录、权重轮询取消、材料/笔记和文档动作；i18n 与 userscript 资源契约共 360 项通过。类型检查、Chrome/Firefox 构建、userscript 构建与校验、Storybook 类型/产物检查、文档构建与测试归类审计一并执行。

证据边界：这是本机 Edge 的生产扩展验收和确定性 TXT 夹具，不代表真实翻译供应商、全格式文档、Firefox/Safari 实机或物理移动设备已经验证；本轮未运行全量回归。

## 复现

先运行 `pnpm build`。将下列 `PLAYWRIGHT_ROOT` 指向安装了 Playwright 的 node_modules，`ARTIFACTS` 指向仓库外的新证据目录。每次只运行一个浏览器专项。

```sh
node scripts/testing/run-ui-hierarchy-polish.cjs --extension-dir .output/chrome-mv3 --playwright-root "$PLAYWRIGHT_ROOT" --artifacts-dir "$ARTIFACTS/main" --audit-sections true
node scripts/testing/run-service-learning-hierarchy-test.cjs --extension-dir .output/chrome-mv3 --playwright-root "$PLAYWRIGHT_ROOT" --artifacts-dir "$ARTIFACTS/learning" --display secondary
node scripts/testing/run-document-action-hierarchy-test.cjs --extension-dir .output/chrome-mv3 --playwright-root "$PLAYWRIGHT_ROOT" --artifacts-dir "$ARTIFACTS/document" --display secondary --widths 1440,900
```

脚本使用独立配置；文档专项启动本机 HTTP 翻译夹具，其他专项禁止外部服务请求。截图及结构化报告写入指定目录。

## 代表截图

通用设置先呈现默认选择与常用操作：

![通用设置](./settings-general.png)

皮肤网格保留品牌差异，减少重复说明：

![皮肤选择](./skin-picker.png)

划词抽屉的开关与功能名称同行：

![划词抽屉](./popup-selection.png)

窄屏深色下，次要服务配置保持紧凑：

![免费服务窄屏](./services-narrow-dark.png)

笔记展开后原位阅读，编辑仍是独立入口：

![笔记展开](./memory-expanded.png)

文档完成后突出下载，保留重新翻译：

![文档完成态](./document-completed.png)
