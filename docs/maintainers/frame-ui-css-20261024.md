# 受限 frame 的 UI 样式依赖裁剪（2026-10-24）

受限 frame 共用翻译控制能力，但不都显示同一套 Vue 浮层。此前，全文翻译根公共出口静态重导出进度面板，QQ 与网易的共享邮件运行时又静态导入划词浮层。这些依赖让构建收集到未使用组件的 CSS：网易正文入口带上进度面板样式，QQ、Disqus、Kaggle 和 Hugging Face Spaces 的共用入口也生成了没有当前消费路径的 UI 样式文件。

本阶段从源码切断多余依赖，保留已有组件、Shadow UI 和页面翻译样式实现。没有借鉴参考仓库，也不通过手动删除构建文件获得结果。

## 依赖与公共边界

`src/features/full-page-translation/public.ts` 继续提供翻译控制、区域翻译与进度状态等能力。进度面板的挂载和卸载改由独立的 `src/features/full-page-translation/ui/public.ts` 提供，`src/app/content/features.ts` 从这个 UI 出口装配顶层内容应用。根公共出口不能再为兼容而重导出面板，否则不显示面板的 frame 会重新获得组件样式依赖。

`src/app/content/qqMailFrameRuntime.ts` 继续拥有邮件 frame 的授权、路由、配置与生命周期，只接收可选的划词 UI 挂载及卸载端口。网易专用的 `src/app/content/neteaseMailFrameRuntime.ts` 静态导入现有划词能力，传入原始 WXT context，并直接返回共享运行时的 Promise；QQ 调用不提供端口。共享 QQ 模块不能反向重导出网易装配器。这里没有增加动态导入，也没有改变挂载或卸载的异步时序。

新的 UI public 是纯重导出，沿用现有公共契约规则；网易装配器是应用接线函数，需要独立的验证归属，不能借此扩大公共模块或覆盖率豁免。

## 入口、样式 URL 与生命周期

网易仍使用独立 `neteaseMailFrame` 入口，保留三个免费邮箱主机范围、`allFrames`、`matchAboutBlank`、`document_end` 和 `cssInjectionMode: 'ui'`。受支持的其他 frame 仍使用原 `supportedFrame` 入口，不增加 `about:blank` 匹配或来源回退。

网易正文必须同时通过原有顶层阅读路由、子文档地址和后台会话授权检查；登录、写信、编辑器和顶层页面的拒绝条件不变。`about:blank` 或 `about:srcdoc` 子文档仍依赖受支持的邮件父页面，不成为任意空白 frame 的通用挂载入口。

实际消费网易 UI 样式的是授权后的划词浮层。WXT 根据原入口名读取 `/content-scripts/neteaseMailFrame.css`，将样式放入隔离 Shadow UI；本阶段保留该文件 URL 及既有稳定资源策略。顶层内容应用继续消费自己的 `content.css`。QQ 和 embedded frame 当前没有对应的进度面板或划词 Shadow UI 消费路径，因此原 `supportedFrame.css` 是静态依赖带出的多余产物，而不是页面翻译必需样式。

`pageStyles.ts` 的四份内联页面样式属于另一条路径，继续覆盖译文显示、页面排版、双语句子高亮和词汇再遇提示；其文档及开放 Shadow Root 注入、配置订阅和清理不变。不得因为裁剪 UI CSS 而删除这些页面样式。

网易的选择浮层仍由原 `selectionMountGeneration`、当前 activation、授权和配置共同判断是否需要。禁用、授权撤销、路由退出及上下文失效仍卸载浮层；迟到的旧挂载不能接管新激活。共享 `ensureContentFeatureMounted` 和具体浮层的请求代次继续处理快速关闭再开启。公共 Shadow UI 保留异步创建前后的 context 校验、Vue 卸载和 WXT 自有 host 清理。

## 产物比较契约

应从冻结源码重新构建，让 WXT 自然决定 CSS 输出及 manifest 资源项。不能先删除 `supportedFrame.css` 再检查文件数量。最终应同时核对入口声明、JS 内的 CSS URL、资源文件存在性、manifest 对应范围，以及权限和 CSP。

顶层 `content.css` 要求与保存的基线字节完全一致。网易 CSS 允许的变化仅是去除未消费的 `TranslationProgressPanel.vue` 样式，其他规则、声明、顺序和作用域必须保留。基线面板使用独立 `data-v-8772ccfe` 作用域及 `fr-progress-pulse-8772ccfe` 动画名，未与其他组件合并选择器；后续组件源码改变时应重新确认这个前提。

语义比较使用本地 PostCSS 解析器保留有序 AST：只删除每个选择器分支都属于上述作用域的规则、精确对应的动画定义，以及因这些删除而变空的媒体容器；将剩余树与候选比较。比较必须保留选择器、at-rule 名称与参数、声明属性和值、`!important` 和子节点顺序，不能通过排序或去重掩盖层叠顺序变化。其余 reading、卡片、划词规则及动画不能随面板一并裁剪。

构建后的网易 JS 应继续引用原网易 CSS URL，且文件和可访问资源声明匹配；共用 supportedFrame 入口应自然不再输出这份无消费 UI CSS，也不包含相应 CSS 加载路径。资源稳定性辅助函数中保留一个未输出的历史路径，本身不会生成文件或扩大 manifest；以实际构建结果为准。

## 验证边界

与本地提交 `bf20eff23cf808d9f43b568b678ee8c8ba0a3367` 的冻结产物比较，Chrome 文件数从 516 变为 515，总字节数从 63,001,410 变为 62,933,246，减少 68,164 字节；这是未压缩产物目录的统计，不是发布 ZIP 大小。网易 CSS 从 60,403 降为 54,162 字节，删除的 AST 恰为 47 条面板规则、一份动画及三个变空的媒体容器。Chrome 与 Firefox 的剩余有序 AST 相同于对应基线裁剪结果，顶层 `content.css` 的 108,848 字节完全一致。userscript 保持 1,869,057 字节。

邮件运行时和入口测试 50 项、顶层 UI/消息/生命周期及 embedded frame 测试 173 项通过；新增网易装配器的 statements、branches、functions、lines 均为 100%。编译与 Chrome、Firefox、userscript 构建通过。入口清单保持原注入条件、权限和 CSP，只移除未消费的 `supportedFrame.css` 可访问资源项。

定向验证应包括真实网易入口到专用装配器及共享运行时的接线、QQ/embedded 不调用网易 UI 端口、授权与配置变化、快速禁用再启用、迟到挂载、路由和上下文清理，以及原页面样式和 Shadow UI 生命周期。入口测试和公共依赖边界检查用于约束注入范围与反向依赖。最终测试计数、构建摘要、CSS 比较和文件摘要记录在工作区 `workspace-data/evidence/performance-integration-20261024/frame-css-dedup/`。

本阶段没有真实邮箱或受限 frame 的浏览器验收，另行授权的八项缓存诊断也不覆盖这些页面。离线测试中部分页面样式或 feature 端口被替代，不能据此声称已在真实邮箱验证样式加载、点击或翻译交互。WXT 的样式读取失败会告警并返回空字符串，UI 仍可能挂载；因此“挂载成功”不能代替最终 URL、资源内容和 manifest 的检查。包体变化也不能直接解释为浏览器请求次数、输入延迟或运行内存的测量。
