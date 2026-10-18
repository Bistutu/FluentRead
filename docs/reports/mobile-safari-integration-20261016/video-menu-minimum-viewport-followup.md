# 视频菜单极矮视口与正文可达性补充（2026-10-18）

本轮修复视频菜单在极矮可见区域中关闭按钮裁切、以及正文控件不可见却仍能获得键盘焦点的问题。安全高度不足 128px 时保留完整 Close；达到 128px 时，标题下方至少保留一个 44px 正文滚动窗口，并显露当前明确聚焦的控件。128px 不代表全部菜单内容能同屏显示。

## 已保留的失败与修复

旧生产包在 58px 受控可见高度下，44px Close 只有 32px 可见，两个下方命中点落到播放器；该轮退出 1。第一版修复让 Close 通过，但逐图审阅又发现：84px 正常态的正文窗口只有 4px，44px 控件仍可进入键盘导航。此前 runner 的成功只覆盖 Close，不能验收正文可用性。增强断言在该版生产包上复跑，于 84px 预期 close-only 的检查再次退出 1；这些旧记录均保留。

最终规则是：44–127px 折叠正文与非 Close 标题分支，并以 `inert` 隔离其焦点；Close 保持 44×44px。需要显露正文焦点时，只滚动 FluentRead 自有正文，使用户打开菜单所选项或键盘下一目标完整显露，不滚宿主页。正文几何按宿主缩放折回 CSS 像素；同尺寸周期刷新不会拉回手动滚动。恢复高度保留节点、模式、子页和原有 hidden/inert 归属，不自动把焦点搬回正文。桌面与正常提示面板保留原焦点行为。

## 本轮实际验证

三份专项共 **183 项通过、0 跳过**（绑定 112、菜单与本地化 36、视口 35）；类型检查、静态测试审计、Chrome／Firefox／Safari Web 生产构建及 Safari Web 资源校验退出 0。随后一次隔离生产扩展 `--suite menu` 运行退出 0，耗时 22.992 秒，报告记录 7 个共享场景及菜单几何检查，错误数组为空，共保存 49 张原图。49 张原图已由非作者逐张审阅，代码和操作逻辑独审均无未解决项；149 份完整可见目标记录的 745 个命中点均通过，另外 22 份是正常滚动区的部分可见记录，不据此声称全部内容同屏。此页逐字节复制其中六张原图。

| 实际检查 | 本轮结果 |
| --- | --- |
| 44、54、58、80、83、84、127px | Close 完整至少 44px、五点命中；菜单位于宿主内、宿主位于受控可见区域内；正文不参与布局和键盘导航 |
| 128px 正常正文 | 正文 clientHeight 为 44px；选中首项、End 末项、返回首项均完整 44px 且五点命中；仅正文 scrollTop 为 3 → 216 → 3，页面滚动均为 0 |
| 非零滚动折叠再恢复 | 216 → 127px 折叠无滚动框时读数 0 → 128px 展开恢复 216；同一正文、模式节点与选中值，Close 留焦，不自动回正文 |
| 恢复 280px | 正文恢复可达；正常关闭重开后六个主要模式／校时控件完整，节点与选中值保留 |
| 焦点与关闭 | 自有正文折叠时移至 Close；页面已有焦点不抢夺；具名 Close、Escape、外部点击关闭后菜单无矩形／采样命中；普通 Close 返回已知入口 |

单元用例另覆盖变换缩放与边框换算、上下显露、可见目标不写 scrollTop、同尺寸手动滚动不重置、外部目标不写及桌面／非正文焦点行为。它们不替代新的原生 prompt 验收。

## 六张原始截图

320px 竖屏保留两列模式；844px 横屏保留主要控件。两图来自受控页面中的真实生产扩展。

| 320px 竖屏 | 844px 横屏 |
| --- | --- |
| ![320px 菜单](./video-menu-minimum-viewport-evidence/portrait-320-menu-first-screen.png) | ![844px 横屏菜单](./video-menu-minimum-viewport-evidence/landscape-844-menu-first-screen.png) |

44px 受控区域只保留 Close；128px 显露选中项，正文其余内容通过自有滚动访问。

| 44px 完整 Close | 128px 选中项 |
| --- | --- |
| ![44px 关闭](./video-menu-minimum-viewport-evidence/very-short-44-close.png) | ![128px 选中项](./video-menu-minimum-viewport-evidence/normal-128-open-selected.png) |

128px 用 End 显露末项；280px 恢复正常正文。以下截图未裁剪、拼接或重绘。

| 128px 末项 | 280px 恢复 |
| --- | --- |
| ![128px 末项](./video-menu-minimum-viewport-evidence/normal-128-keyboard-last.png) | ![280px 恢复](./video-menu-minimum-viewport-evidence/very-short-restored-280-primary.png) |

## 源码和证据边界

执行时源码基于 `00c9770bfbb6e392ba5f44da69059230b19a9e01` 加未提交的三个产品文件改动，尚无本修复的新提交 SHA。测试、构建与浏览器回执记录同一文件字节；[公开摘要](./video-menu-minimum-viewport-evidence/summary.json) 保留这三个源码的完整 SHA256、生产 content 脚本与 manifest 摘要，manifest 相同本身不能证明产品源码相同。[复制索引](./video-menu-minimum-viewport-evidence/copy-index.json) 记录六张副本与原图的相同字节和 SHA256。

本轮是隔离 Chromium、受控 HTML／字幕／翻译响应及真实生产扩展的布局与操作验证。极矮高度来自 VisualViewport 数值夹具，不是真实软键盘；coarse 和 DOM 全屏属性也属受控条件。实际 safe-area inset 模拟接口不可用，不能将已有 offset／root-transform 检查称为系统安全区通过。没有新 Safari／Firefox 运行时、原生 UI、物理设备、供应商或全语言主题验收，不沿用旧原生 PASS，不证明系统全屏字幕绘制。本修复未借鉴参考仓库。
