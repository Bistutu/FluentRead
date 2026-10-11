# 视频学习性能复验协议

本轮最终比较使用最新主干不可变提交 `58ef643e85b5` 的独立归档生产构建与已集成该主干的候选。归档源文件 1904 项构建前后哈希一致，双方使用相同 lockfile 和 node_modules；[构建证据](./evidence/matching-baseline-build.json) 已保存。较早的 e96、e411 和中间候选不用于最终提升。

## 测量对象与边界

- 生产 Chrome 扩展，隔离 Edge 临时 profile，第二屏正常可见窗口，经 Launch Services 后台启动与 CDP 操作；记录真实前台事件并清理专属浏览器和临时配置。
- YouTube 结构的受控 HTML；真实解码的 18 秒 MP4，20 fps，自然媒体时钟，不派发合成 timeupdate。原生字幕供应、翻译服务质量和完整真实网站 CPU 不在该协议范围内。
- 一个覆盖测量期间的完整原句，original-only 字幕模式；学习面板译文在测量前通过确定性 HTTP transport 预热完成。
- 每个场景两个样本，每段约 6 秒：关闭学习静态播放、打开学习静态播放、打开学习并以 20 Hz 替换原生字幕 span、打开学习并以 20 Hz 替换原生控件图标。DOM 压力为受控输入，媒体仍自然播放。

记录 CDP renderer Task/Script/Layout/RecalcStyle 累计时间及布局次数，页面长任务、页面与学习面板 MutationRecord、翻译请求数、原生 timeupdate，以及媒体时间、倍速和 seek/ratechange 事件。Task 包含 renderer 其他工作，DOM 记录数不等于用户感知耗时。

同一句预热后的测量要求无额外翻译请求，媒体保持 1x、正常推进且没有插件 seek。成功还要求页面异常和浏览器前台激活为零，所属临时 profile 清理完成。性能值不设任意 CPU 门槛，两个样本不能建立统计置信区间。

## 可重复命令

通过工作区依赖工具取得 Playwright 包目录，显式传入不可变生产产物；双方保持同一 measurement-ms 与 trials。

```bash
node scripts/testing/run-resource-safe.mjs --concurrency 3 -- \
  node scripts/run-video-sentence-learning-test.cjs \
  --runtime-performance-only --platforms youtube \
  --performance-tag <baseline-or-candidate> \
  --extension-dir <immutable-production-artifact> \
  --playwright-root <bundled-node-packages> \
  --measurement-ms 6000 --trials 2 \
  --artifacts-dir <evidence-directory>
```

功能另用默认视频专项语义回归及 --reliability-only --platforms youtube,x，覆盖时间、异步草稿、收藏与出处，以及点击视频后快捷键、菜单按键作用域、帮助、紧凑放大、拖动、真实全屏和同媒体宿主迁移、Escape、外观设置及真实持久化。--compact-probe-only --platforms youtube 单独记录 390×260 与 320×180 的全部 header/nav/footer 控件边界及真实中心 hit-test；这些诊断不混入性能样本。

## 最终同协议结果

[基线完整 JSON](./evidence/performance-baseline.json) 的 content-script SHA-256 为 `35037bc8c71fcbf12c967e249f165e2de612f3e3f0cdb4cb9c6cb4268cf9904e`；[候选完整 JSON](./evidence/performance-candidate.json) 为 `d1166be072fa5682add0e7d4c468f0f0b0a0e4258931ccc0f7481a3d5b696943`。各八段均完成，页面异常和前台激活为零，专属浏览器及配置已清理。以下每格为两次样本，单位 ms，箭头表示基线到候选；变化为两样本均值的相对变化，负值代表减少。

| 每段约 6 秒 | Task 基线 → 候选 | 均值变化 | Script 基线 → 候选 | 均值变化 | Layout 基线 → 候选 |
| --- | --- | --- | --- | --- | --- |
| 学习关闭，静态 | 44.8 / 73.6 → 28.0 / 28.6 | -52.2% | 20.3 / 29.7 → 17.2 / 19.1 | -27.3% | 0.0 / 0.0 → 0.0 / 0.0 |
| 学习打开，静态 | 61.3 / 72.5 → 34.0 / 45.3 | -40.8% | 27.6 / 31.3 → 21.0 / 30.1 | -13.1% | 0.0 / 0.0 → 0.0 / 0.0 |
| 原生字幕 span 压力 | 205.5 / 226.3 → 198.9 / 222.8 | -2.4% | 80.3 / 94.8 → 79.6 / 85.0 | -6.0% | 20.7 / 22.4 → 26.7 / 31.8 |
| 原生控件图标压力 | 280.5 / 262.3 → 202.9 / 235.6 | -19.2% | 102.6 / 89.2 → 54.7 / 66.2 | -36.9% | 54.9 / 44.1 → 48.7 / 53.7 |

结果存在分化：静态与控件压力 Task 均值减少较多，字幕压力仅减少 2.4%；字幕与控件压力 Layout 均值分别增加 35.6%（21.6→29.3 ms）和 3.4%（49.5→51.2 ms）。控件压力 Script 减少 36.9%，字幕压力减少 6.0%。保留这些布局反向结果，不能将全部工作概括为均匀改善，也不能沿用早期候选更大的降幅。

字幕压力 MutationRecord 每段从 1563 降到 843（减少 46.1%），控件压力从 1203 降到 483（减少 59.9%）；学习面板自身均为 0。字幕布局仍 119–120 次，控件布局仍 120 次。该结果支持减少无关扩展 DOM 写入，并不意味着原生字幕布局消失。

全部 16 段均为 23 次自然时间事件、0 次额外翻译、0 次学习面板 DOM 更新和 0 次长任务；媒体保持 1x，无 seek/ratechange。关闭学习也有运行时收益，不能把共享收益全部归给学习面板。此受控协议没有复现真实网站的严重 CPU 问题或加速，功能冲突另由可信快捷键回归验证。

## 历史失败与证据保留

首轮未完成候选及较后语义批次分别触发前台门禁，立即停止并清理，激活原因未知：[首轮报告](./evidence/performance-candidate-interrupted-foreground.json)、[日志](./evidence/performance-candidate-interrupted-foreground.txt)、[后续语义报告](./evidence/browser-semantic-interrupted-foreground.json)。这些批次不参与性能结论。较早 [e96 基线](./evidence/performance-baseline-historical-e96.json) 与 [导航移位后中间候选](./evidence/performance-candidate-historical-navigation-744.json) 仅作历史记录。

320×180 探针曾确认底部解释/收藏按钮裁剪，而 390×260 正常：[修复前 bounds 与 hit-test](./evidence/small-player-probe-before-fix.json)、[裁剪截图](./screenshots/youtube-small-player-320x180-before-fix.png)。[最终修复后报告](./evidence/small-player-probe-after-fix.json) 两尺寸全部 9 个控件边界与命中通过。320×180 正文可滚区域约 18.8px，优先显示原句；14px 原句首行真实文字矩形高 16.5px，可见交集同为 16.5px，实际截图字形完整。390×260 原句首行 20px 也全部可见。这证明首行可读，不代表极小容器能同时展示全部译文与辅助信息。

修复前新 reliability 在全屏 Escape 默认退出处停止：[原失败报告](./evidence/browser-reliability-fullscreen-default-failure.json) 与 [独立控制](./evidence/browser-fullscreen-escape-control.json)。当时插件关闭配置与学习打开时，可信 Escape 均未 preventDefault，但后台 CDP 均未退出全屏。产品随后为当前媒体所在全屏的 Escape 调用合法的 document.exitFullscreen 接口，同时保留浏览器默认行为；不再依赖后台 CDP 触发浏览器默认退出。

原 80 语义回归在一次快速连按请求合并边界失败后，保留严格请求数 1 重新完成：[通过报告](./evidence/browser-semantic.json)、[首次失败](./evidence/browser-semantic-rapid-timing-failure.json)。最终通过批次每个平台 12 个可信 click 的实际事件间隔约 35.9–44.8ms、仅新增 1 请求；失败批次未记录实际事件间隔，不能确定其原因。

[最终完整 reliability 报告](./evidence/browser-reliability.json) 在相同 d1166 产物上全部通过 31 项（YouTube 17、X 14），包括可信 Escape 真实退出播放器及内部宿主全屏、草稿与拖动位置恢复、菜单键盘作用域、普通 Escape 优先级、正常关闭后宿主键盘释放、1x 自然播放，以及真实外观控件与持久化。测试未用退出 API 代替可信 Escape 输入；退出接口由产品处理该可信事件调用。默认首次未编辑未收藏的 [面板元素截图](./screenshots/youtube-learning-default-panel.png)、[外观中心截图](./screenshots/learning-appearance-settings.png) 已保存。最终性能、80 条语义、31 条 reliability 和小屏探针全部对应同一 content-script SHA，页面异常、前台激活为零，所属临时浏览器与 profile 均已清理。
