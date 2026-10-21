# 手机自适应修复的主分支集成复验（2026-10-18）

产品提交 `95cac87cb1777c7c7824a3f158033a557f7acda8` 整合主分支 `9d6f2864`，保留字幕菜单、服务抽屉和语言选择器的手机布局。主分支新加入的品牌官网链接在触屏及已识别的 Firefox Android Popup 中提供居中的 46×46px 点击区域，图标仍为 32px；桌面保持 32px。官网链接、提示、Escape 关闭及减少动画偏好均保留。

冲突解决同时保留服务抽屉的极矮布局、可见区域恢复后的聚焦搜索框定位、视口监听清理，以及 Tooltip 和真实抽屉 body 的测试端口。独立代码复核未发现遗失的双方改动。

| 本轮验证 | 结果与范围 |
| --- | --- |
| 专项测试 | 实际匹配 9 个测试文件，589 项通过、无跳过；覆盖 Popup 生命周期、启动、嵌入、功能可见性、关键信息、子控件归属、视口及 userscript 配置与语言资源。类型检查通过。命令中一个不存在的额外文件过滤项没有执行，不计入文件数。 |
| 生产构建 | Chrome、Firefox、Safari、userscript 重新构建通过，userscript、扩展清单及 Safari 产物检查通过。版本仍为主分支的 0.0.39。清单 SHA 与上一轮相同，不能单凭清单识别整包；构建、干净源码提交和实际输出另行绑定。 |
| 真实扩展界面 | 隔离后台 Edge 重新执行全部 9 场景：320／390px 源语言与目标语言搜索、空结果关闭、选择后立即关闭并重开保存；780×220 横屏；两种受控 58px 可见区域；深色；桌面 ArrowDown／Enter。9/9 通过，18 张原始截图逐张检查。 |
| 触控与裁切 | 原有 46px 控件、16px 输入、可见区域、祖先裁切及五点命中检查保留；新增六个正常触屏场景的品牌链接 46×46px 和五点命中检查，桌面为 32×32px。两个受控 58px 场景优先检查菜单关闭，不要求已移出可见区域的页头。无控制台错误、用例问题或清理错误，测试配置恢复。 |
| Safari 本地目标 | 新目录打包、macOS、iOS Simulator、arm64 iPhoneOS 四阶段通过；三目标各自内嵌的 467 份 Web 资源与本轮 Safari 包逐文件一致。六个 bundle 的 Info、实际二进制和架构已核对：macOS／Simulator 的默认架构签名读回为链接器 ad-hoc、无开发者团队，不能推为两个架构切片均有签名；iPhoneOS 未签名。原生包装 1.0／build 1 与 Web 0.0.39 分开记录。 |

[浏览器及构建摘要](./main9d6-integration-evidence/summary.json) · [原生资源与二进制摘要](./main9d6-integration-evidence/native-build-summary.json)

| 本轮原始截图 | 查看 |
| --- | --- |
| 320px 目标语言 | [原图](./main9d6-integration-evidence/target-320.png) |
| 横屏短高度 | [原图](./main9d6-integration-evidence/landscape.png) |
| 受控 58px 及偏移 | [原图](./main9d6-integration-evidence/visible-58-offset.png) |
| 深色触屏列表 | [原图](./main9d6-integration-evidence/dark.png) |
| 桌面键盘选择后重开 | [原图](./main9d6-integration-evidence/desktop-keyboard.png) |

本轮使用真实生产扩展和临时 profile，触屏、媒体和视口条件由自动化控制；58px 不是原生软键盘，焦点仅为采样。未安装或执行新原生 UI，单次构建后资源采样不作为独立前后保全证据。原生基线读回仍保留上一轮进程监测超时中止的结果；没有取得配置读回向量，不能声称升级保留或本轮语言选择器的原生键盘验收。

此前分版本证据见[语言选择器修复](./popup-language-touch-followup.md)、[字幕菜单](./video-responsive-followup.md)和[服务抽屉](./services-short-viewport-followup.md)。#992 系统 AVKit 全屏字幕、长期后台、完整安装更新矩阵及物理无障碍设备仍待验收。未借鉴参考仓库实现，未进行开发者签名或发布。
