# 媒体与文档发版扫描

基线 `0ad3d431b425d8e082f15acfce11de23a66b8cc1`。此报告覆盖 document/image/area/video/local-translation/local-tts 与 document/offscreen app 目录，另按分工补充 TranslationCenter 组件覆盖与冗余逻辑精简；全仓发布、构建、压缩包和所有测试的最终结论由主报告汇总。

## S11 最终冻结产物与发布限制（2026-10-23）

在独立 `candidate-checkpoint-11`（基准提交 `c2d128c6349baf1c19108e40f99c9ae5d5ee01f0`）按普通 userscript、standalone、Greasy Fork、Obsidian 顺序构建。构建后逐一复核冻结清单中的 6756 个源码 SHA，全部一致；没有修改资源、门槛或冻结源码。这里的大小是实际 UTF-8 文件字节，不是 Vite 显示的 kB 字符数，也不是扩展 ZIP 大小。

| 产物 | 实际字节 | 构建退出码 | 独立校验退出码 |
| --- | ---: | ---: | ---: |
| 普通 userscript | 1,859,771 | 0 | 0 |
| standalone userscript | 3,595,448 | 0 | 0 |
| Greasy Fork userscript | 2,922,016 | 1 | 1 |
| Obsidian main.js | 2,064,308 | 0 | 未单独设置 |

普通版低于原 2,125,100 字节门槛，余量 265,329 字节；standalone 低于原 3,600,000 字节门槛，余量仅 4,552 字节，后续源码改变仍须重新构建核对。GF 的 Vite 产物已经生成、固定资源校验完成，但构建内置和独立 verifier 均在原 2,000,000 字节门槛处失败，超出 922,016 字节，不能列为发布通过。此前 GF 冻结产物的只读 AST 盘点中，所有大小的纯数据字面量合计 472,290 字节；即再把插值模板的静态部分和正则文本都计入候选，也仅 519,075 字节，且未扣读取引用开销，无法靠本轮小范围纯数据外置填补差额。该盘点未重新统计 S10/S11，作为已分析过的有限纯数据机会记录；本轮未压缩可执行代码、降低门槛或删除能力来绕过此项。

GF vendor/data 固定于 `4d7fe8be9dcfa2f5f6d312460518171ced4d12f8`，构建保持其已提交字节与来源声明。原始基线 `0ad3d431` 的正式 GF 命令也 exit 1，但在 Vite 之前即被原有资源锁保护阻断：其资源提交为 `20d7b5e0760373958f1d460dda642f83cf5f22c4`，`pnpm-lock.yaml` 已与该资源提交不同。基线工作树前后 clean，未绕过保护，未得到可比产物；因此不能断言基线也超过 2 MB。

详细退出码、实际命令及耗时、完整 SHA、许可证结果与日志索引见证据根目录的 `checkpoint11-media-build-results.json`、`checkpoint11-*-build.log`、`checkpoint11-userscript*-verify.log`；GF 分析见 `media/greasyfork-size-review.md` 及三个 AST census JSON；基线失败见 `baseline-userscript-greasyfork-result.json`。S9 的普通版、standalone、GF 分别为 1,857,226、3,592,892、2,916,980 字节；S10 实际分别增加 2,545、2,556、5,036 字节，Obsidian 字节与 SHA 不变。S11 的 1151 个生产文件与 S10 的 SHA 全部相同，重新构建所得四类产物的 SHA 也逐项相同；S10 的结果及日志完整保留。后续源码如再变化，不能继续沿用 S11 结论。主任务报告 S8 浏览器运行 exit 86，本分任务未将其计为通过，也未启动新浏览器或自动重试。

## S11 最终全量覆盖与验收状态

冻结 S11 全量运行 789 个测试文件全部通过，28,526 项通过、2 项保留跳过，共 28,528 项，耗时 1189.05 秒。两项跳过仍因 Harness 原件/历史布局输入缺失，未合成替代材料。进程 exit 1 的原因是原有四维全源码 100% 门槛未达到，不能将“测试通过”写成“发布验收通过”。

| 覆盖范围 | 文件数 | 语句/行 | 函数 | 分支 |
| --- | ---: | --- | --- | --- |
| 全部源码 | 1151 | 162,660 / 166,717（97.56%） | 11,733 / 13,152（89.21%） | 86,408 / 89,246（96.82%） |
| 自有代码，含装配、构建及静态数据 | 1150 | 161,808 / 165,795（97.59%） | 11,249 / 11,368（98.95%） | 85,355 / 87,557（97.48%） |
| 已提交第三方依赖 bundle | 1 | 852 / 922（92.40%） | 484 / 1784（27.13%） | 1053 / 1689（62.34%） |

第三方组仅为 `userscript/resources/fluentread-vendor.v1.js`，其生成包装一并按文件统计；vendor 的构建/导出接线、Vue bridge 和静态 data 资源仍在自有组。分组只解释缺口，不更改全源码分母或门槛。自有代码未覆盖 V8 函数条目为 119：39 个正常函数映射、80 个未覆盖的 `(empty-report)` 占位；第三方未覆盖函数条目为 1300。总计94个占位映射中还有14个被工具标记covered，不能据此声称存在14个被测业务函数。AST节点与V8执行映射是不同计数，未混算或据数字删除代码。

分析逐一核对1151文件的coverage-final/summary/inventory路径、源码SHA和原始计数；全部一致，输入SHA保存在结果中。自有缺口前十及路径分组见根证据 `checkpoint11-coverage-gap-analysis.{json,md}`；可用 `analyze-release-coverage-gaps.py --checkpoint 11` 重跑只读分析。S10结果仍保留，S11补充的公开行为回归覆盖了两个原有函数条目，但没有满足完整覆盖要求。

当前验收决定为不发布：四维全覆盖和GF体积两项原门槛仍失败；主线集成、CI及浏览器结论由主任务另外填写。可提交的事实摘要见同目录 `acceptance-summary.json`，没有把现有构建或测试结果扩张为零bug、真实环境全部验证或发布完成。

## 资源与许可证核对

主任务对 22 项图片资源进行了无损 PNG deflate/JPEG Huffman 优化；逐项证据确认解码 RGBA 相同、ICC profile 保留。原始文件合计减少 19,197 字节；独立 deflate level 6 比较减少 4,348 字节，二者不能混算成扩展压缩包减量。其余已足够紧凑的图片保留原字节，没有为体积删除图像内容或色彩配置。证据为根目录 `asset-optimization.json`。

普通 userscript 改为复用既有非流式 OpenAI HTTP 执行器，仅改变该执行端口的打包，仍使用共享请求配置、端点、鉴权、错误分类、用量、租约与预算路径。实际安装的原 SDK 与自有端口合同测试独立运行 190 项全部通过；阅读 SSE/工具和原生 Claude/Gemini 不经此入口。明确预期差异是自有执行器不读取宿主 `AI_SDK_TELEMETRY_INTEGRATIONS`，避免宿主钩子观察或打断翻译；不能说所有副作用完全等价。现有非流式执行器仍与锁定 SDK 一样等待正文 cancel 完成，合同未证明永不结算的 cancel 握手也能及时退出。

S11 普通与 standalone 产物均再次核对各包标题及上游声明原文；GF vendor/data 生成字节分别与当前源码及固定提交逐字节相等，Dexie、CryptoJS、franc-min 的来源声明保留。本次核对直接读取 S11 新产物，不以此前产物 SHA 代替。`ai 6.0.264`、`@ai-sdk/openai-compatible 2.0.70`、`@ai-sdk/provider 3.0.15` 的包/版本标题保留，安装包中相同的 Vercel Apache 声明原文完整保留一次；`@ai-sdk/provider-utils 4.0.46` 安装包本身没有 LICENSE 文件，按现有策略保留 Apache 标识及 repository 来源链接，未虚称核验了不存在的授权文件。该核对是产物事实检查，不是额外法律意见。证据为 `media/ordinary-http-independent-review.md`、`ordinary-http-independent-contract.log`、`ordinary-http-artifact-review.json`。

## 验证登记纠正

S8 全量回归暴露两类登记不一致，随后仅修改测试及覆盖配置：OCR/漫画设置的 49E 测试改为直接导入真实 SFC，保持原控件、mount 和断言；删除已严格覆盖的 Preview/MangaEntry 重复 Vue 例外；删除 video background、YouTube bridge、document page 的过时 build-only 豁免。四个 app Worker 文件仅有 re-export、自有函数与分支均为 0，因此撤销本轮误加的 strict 业务登记，保留原纯 barrel 分类及全源码普查，未以空函数统计冒充业务覆盖。

漫画、读音和视频转写的真实 Worker 仍在 strict；本地翻译真实 Worker 原来就不在 strict，仍保留已有 build-only 分类与本报告列出的实际覆盖缺口。四组测试继续经过实际 app 入口。定向 6 文件 161 项全过，包含架构归属 21 项和 49E 27 项；分析器、原 invalid 门禁、覆盖阈值及全源码 include 均未降低。证据为 `media/verification-ownership-registration.{json,md}` 和 `verification-ownership-registration-retest.log`。这些登记修复发生在 S8 冻结之后，已进入 S9；S9 全量回归由主任务汇总，不把后续修复追写成 S8 全量已经通过。

## 本地朗读设置的实际 SFC 归因补充

S8 的 LocalTtsSettings 有 4 个函数未归因：来源模式、本地音色、在线音色顺序更新，以及下载进度处理。原生命周期测试已经通过完整客户端编译模板执行这些场景，但自定义 `new Function` loader 没有让 V8 将执行归因到 SFC 文件。现将同一测试文件中的朗读/视频模型设置统一改为正常 SFC import，删除私有编译 loader，继续运行实际模板、配置上下文、后台 handlers、进度发布/订阅和原有全部断言。Vue 公开 render API 只记录真实排队事件，用于原有旧事件隔离验证，不调用私有 setup 或镜像业务函数。

既有模式切换测试进一步验证当前本地音色可修改、切到仅在线再返回后隐藏偏好保持；新增另一页面发起下载的进度接续/完成、模型删除失败后保留可用状态并重试，以及紧凑进度条的可访问名称和未知总量清除旧百分比。原 24 项变为 27 项；与 49C 和架构归属合跑 3 文件 230 项全部通过，ownership 21 项仍通过。没有修改生产代码、降低分析器或阈值，也没有启动浏览器。

定向合并测量：LocalTtsSettings 函数 13/13，语句/行 237/240（98.75%）、分支 126/136（92.64%）；VideoLocalModelSettings 函数 19/19、语句/行 266/266，分支 186/187（99.46%）；DownloadProgress 10 行、14 分支全覆盖，自有函数数为 0。前两个组件仍未四维 100%，不能把函数覆盖完成当作全部覆盖完成。证据为 `media/local-tts-sfc-final-regression.log`、`local-tts-sfc-coverage/coverage-summary.json`、`local-tts-sfc-final-compile.log`；最终全仓类型检查 exit 0。

## S9 本地数据导入独立交叉审查

对此前由其他负责人修改的 LocalDataManagement 做独立只读复核，完整阅读真实模板、source/preview 回调归属、文件输入与异步读取、确认导入及清理流程，并追到词书/模型用量仓库的导入事务和配置客户端/后台修改队列。审查的14个文件在当前工作树与S9逐一SHA相同；完整6756文件的冻结一致性另见构建证据。未发现可复现的新业务问题，没有据此宣称不存在bug。

旧source回调及旧file input事件绑定各自视图代次和会话，不能操作重新打开的来源或预览；大文件确认及File.text返回后重新校验归属。用户确认导入后，写入按模型用量、词书、配置顺序继续执行，离页只使提示与焦点回调失效。每个数据域独立校验和提交，跨域允许部分成功并显示结果；这不是跨三个领域的原子事务，也没有自动撤销已成功领域。配置写入先检查导出指纹，再经队列内revision校验阻止过期整份替换。

在冻结S9独立重跑49C、dataBackup、modelUsageRepository和vocabularyBook，4文件242项全部通过；沿用真实SFC公开事件与生命周期断言、受控边界和测试IndexedDB，没有新增镜像实现或人为状态测试。未运行实际浏览器、原生文件选择器、真实跨页存储竞争或真实设备。证据为 `media/final-local-data-cross-review.json` 与 `media/final-local-data-cross-review-tests.log`。

## 审查口径

基线索引包含 220 个 TS/Vue 文件、5028 个函数（包括匿名回调），静态索引本身不是逐函数语义审查。实际阅读范围、函数体是否完整读过、当前源码摘要记录在 `research/release-audit-20261023/media/semantic-review-ledger.json`（工作区外部证据目录）。基线220个文件的函数体语义阅读已完成（218个保留、2个删除），新增字幕传输模块也已完整阅读；行为验证与修复仍在进行，不声称线上状态均已验证。函数/分支覆盖率100%也不代表不存在bug。

## 已实施修复

1. 文档服务配置初始化等待纳入取消，初始化Promise永久未决时也立即结束调用；取消监听同步移除，迟到成功/拒绝不继续翻译，兼容同步 readiness 端口。
2. OCR语言包准备的可选状态预读设置5秒预算，查询无回应时继续有界下载；迟到状态不能重置下载进度，取消及时清理计时器与订阅。
3. 图片翻译配置依赖与副作用分离。配置变化立即中止进行中翻译、显示可重试状态，旧结果不得覆盖重试；UI副作用读取不再扩张配置依赖。
4. PDF源文件、PDF阅读字体、HLS音轨、漫画网络/缓存、Hindi WASM错误响应复用平台原正文取消，不clone、不排空、不等待取消握手。字体与本地模型读流显式释放reader锁。
5. 本地翻译模型 `artifactStore` 的取消清理不再await未结束的底层cancel，HTTP错误、错误Range和实际超量流均能继续备用镜像并校验结果。
6. X清单、YouTube人工轨、自动原文预取、下载共用 `subtitleTransport.ts`：十五秒覆盖响应头与所有正文，取消保留调用方原因，过期响应迟到时回收正文；X三槽队列不会被无回应请求永久耗尽。YouTube单轨8,000,000字节、X仍1,000,000字节是产品资源保护上限；并未声称已验证所有真实长视频字幕。
7. 自动YouTube预取随配置、轨道变化和卸载取消；旧任务不修改新代次的重试时钟。
8. 纯文本CR换行折行段落与LF/CRLF采用同一规范化，未翻译导出仍保持原字节。已记录旧实现失败复现。
9. VTT带类名的标签（如 `<c.highlight>…</c>`）可从服务返回的括号标记恢复；一次提取真实闭合名，避免动态正则把句点当通配符。已记录旧实现失败复现。
10. YouTube MAIN-world 网络桥对克隆正文默认限制8MB、正文读取最多15秒；卸载或导航后迟到响应不再克隆。取消克隆不影响宿主原响应。三个真实流回归均有修复前失败证据。

11. HTML富文本深色预览支持大小写和合法空白形式的关闭head标签；真实挂载的DocumentApp对三种写法验证srcdoc与sandbox，旧逻辑两例失败。
12. PDF图注切分使用独立图形矩形，不再改写输入graphics；只读输入与重复解析回归证明旧逻辑抛错、新逻辑输出稳定。
13. NASA完整语料第11页确认通栏介绍被并入左栏名单、译文大框覆盖右栏。按同基线旁栏文字约束段落合并，原介绍保持独立；第35页缺底横线表格使用共端点的独立竖边恢复末行边界。同一验收语料最终全部通过，详见下方最终几何验证。

14. OpenStax第20页行内根号不足整行高的短笔画不再当作表格竖分隔线；第70页向量箭头、帽号先按局部主字形归行，避免独立重音行制造假栏间距。第50页窄双栏再以多行独立列边界确认18pt栏间距，避免内部公式词距掩盖实际栏界。原始字形坐标回放先失败后通过；后续补全数学轮廓、上下标、分式、开放表格和交错基线后，完整语料重叠归零，原有断言保持不变。
15. 完整音频解码的AudioContext.close不再阻塞成功或回退；成功、解码失败、解码超时三种未决关闭均有回归。未知视频时长仍按实际PCM/解码声道长度执行20分钟上限，避免额外重采样分配和推理；不声称避免浏览器解码本身已发生的分配。
16. 实时AI采集检测到播放器时钟跳变后完整重建采集图。旧代码只增长session，旧回调随后永久拒绝PCM且running仍为true；新回归验证前进/后退、资源关闭、重新提交及迟到结果隔离。
17. YouTube初始化轨道与JSON3响应逐项跳过null/非对象条目；单个损坏条目不再丢弃整组有效字幕。
18. AI跨窗去重补全don't/won’t/shouldn't/aren’t等否定缩约识别，防止高相似肯定句与否定句被作为同句校正覆盖；保留已有can/cannot保护并验证两条字幕独立输出。
19. PDF搜索按段落位置保持当前命中；分批译文插入更早的匹配不会漂移，原命中消失/全部清空/恢复时索引与滚动位置同步。旧Vue挂载回归先失败后通过。

20. 视频可视区域解析支持浏览器实际计算的 `calc(100% - 10px)` 形式 object-position，百分比、边缘像素与缩放共同参与定位；真实 Edge 计算值作为输入，四角与缩放回归原有5例失败、修复后79项通过。
21. OpenStax第6页四行大标题按同字号、同左边界和紧排基线连续成块；第31页分式利用实际分数线与分子/分母几何关联，正文解释不并入公式。
22. PDF竖向拉伸分隔符复用解析阶段已加载的PDF.js SVG字形轮廓，只取有限绝对路径的保守控制点边界，不新增FontKit/字体常驻数据；普通p/g下降部不缩小。字体状态遵守q/Q与Form保存恢复，同Unicode多字形取边界并集，缺失/损坏/超长路径回退原metrics，57项导入生命周期验证通过。
23. OpenStax第57页下一行短词被大号竖线误当下标，导致文字跨行与重叠；同字号、同基线且紧贴长正文的候选留在正文行，复用已有局部邻居索引，不增加整页平方扫描。实际坐标回归旧逻辑失败、修后通过；修复后的完整语料已通过原有结构验收。

## 性能与代码精简

- 视频runtime删除17项仅供测试兼容的重复re-export，测试直达实际owner；合并只调用一次的seek与UI同步包装，保留1879行低于1887行架构上限。
- TranslationCenter删除已由comparison成功状态保证的空输入回退、凭据警告已判非空后的重复fallback，以及默认免密钥服务始终存在时取目录首项的多余回退。
- PDF阅读样式只读取和解析一次本地存储，初始化的三项设置复用同一快照。
- 删除无生产调用的X字幕viewport旧别名，测试直接调用跨平台生产入口，35项viewport测试通过。
- 完整AI字幕删除始终为空的fallback cue字段及其展开、简化私有合并入参，去除仅重抛异常的try/catch；实际采集和失败生命周期保持回归。
- PDF下载签名仅读取前5字节，移除每个chunk展平后再截断的临时分配。
- PDF溢出批注候选直接查询两份既有几何数组，移除每候选复制完整占用数组；不改变避让顺序。
- TTS模型固定版本已命中时跳过旧main别名读取，正常完整模型状态从12次文件查询降至8次；旧版本兼容测试保留。
- 删除6个无生产调用函数：`createDocumentFileLoadGuard`、`restoreDocumentHistoryTranslations`、`pdfReaderPageHasTranslation`、`getVideoTranscriptionMediaKey`、`getMangaModelSource`、`setMangaModelSource`；删除随之失效的接口/偏好缓存字段；仍有后台状态消息消费者的MangaModelSource类型保留，历史记录测试改为实际生产恢复入口。
- PDF canvas倍率恒定表达式化简为2，保留现有行为；PDF阅读导出复用已有区域绘制函数，删除重复的四方向旋转裁切实现。
- 删除漫画GPU探测的纯透传模块 `mangaGpu.ts`，两个生产调用点直接使用原共享探测函数；删除仅验证透传的3条测试，真实OCR和修补路径50项测试通过。
- 文档历史列表与保存后的淘汰改为IndexedDB游标逐条提取摘要与byteLength，避免getAll聚合持有全部原文件和解析快照；存储版本、排序、80MB/20条上限与取消语义不变。迟到淘汰快照回归迁移为延迟游标终态，后续新修订仍保留。
- OCR竖排分组移除逐轮slice和扩展数组复制，union-find压缩路径；256/1024/2048行分别减少32,640/523,776/2,096,128个候选数组元素复制。5轮预热、15轮交替基线/当前且每轮前GC的本地基准，中位时间5.80→5.99、58.17→57.22、221.69→219.57ms；未证明显著提速，也未出现稳定10%回退。heapUsed差值中位1.78→1.27、9.89→4.72、12.64→9.30MB，只表示包含结果与未回收临时分配的观测值，不能视为真实浏览器峰值或常驻内存。输出逐项相同。
- 精简仅验证上述死API的测试，保留真实导入/历史恢复/媒体身份行为测试；不删除失败分支覆盖来制造通过率。

## 文档几何与界面验证（更新于2026-10-23 09:58 UTC）

- 文档应用补充真实SFC文件/在线URL导入、原生表单事件、目标语言选择、全屏失败与外部退出、历史删除/重开/恢复材料、DOCX表格和跨章节定位、下载通知终态等测试；删除只在不可达Markdown分支使用的`getDocumentReaderSourceClass`和包装。5文件279项通过；随后目标语言事件与最新几何合并回归318项通过。上一份完整测量中DocumentApp语句/行100%、函数99.47%、分支89.86%；PdfReader语句/行/函数100%、分支92.81%。尚不能宣称组件四维100%。
- OpenStax p105双栏在段落间距错开时仍有连续留白带，原相邻4字号距离限制不足；现在每方向最多检查32行，在跨栏文字处停止，并要求两排独立长正文共同支持栏界。真实219字形回归保留CC BY 4.0来源信息。p908公式侵入栏间空白的窄缝由两排独立长正文确认，三栏索引只使用当前连续栏段宽度，防止借用下一栏作证据。
- 复用PDF.js已经加载的数学字形路径，增加括号组件、箭头与帽号的保守控制点边界；不加载另一份字库、不改变普通p/g下降部，不修改导出用原始fontSize。确认各向异性且非剪切的分隔符另存layoutFontSize供行归组，分桶、上下标和行字号统一使用横向字号。相邻根字形限制防止脚标父链回到自身。
- 真实路径证据`actual-glyph-paths.json`、`actual-math-token-paths.json`及逐页几何回放通过。NASA、OpenStax完整1000页、Attention和Smith/Levy四份实际PDF的重叠测量最终为0；正式`pdfPaperLayouts.test.ts`13项全部通过，包含完整语料19.98秒。没有删语料、放宽重叠阈值或用生成PDF替代实书。
- 行内分式的可读单位、多字母变量必须同时有短横分数线、线两侧实际字形和数学上下文才归入原图公式区域，避免把rMg、2π rad等送入独立译文块。新增单元测试不替代真实语料验收。
- 真实p377/p699可视核验发现只有表头线、没有底框的表格。通过相接表头框、重复数字列及独立表题识别，补充虚拟列界与字体不同导致的数值/文字基线差；真实表格夹具及孤立表头、缺失横线、错位表题、无连续数字列等反例通过；完整语料复验通过。

- 字形轮廓只支持已验证的绝对路径，ligature、accent、vmetric、竖排和剪切变换回退原metrics；相同Unicode的不同fontChar取保守轮廓并集。原始fontSize仍供导出文字矩阵使用，layoutFontSize只影响布局。解析历史版本19升为20，旧版本恢复时重解析、保留译文及校对内容。
- 区域翻译两份旧new Function脚本测试迁移到真实SFC import，共享仅替换浏览器边界的测试端口；24项验证真实圈选、复制、重译、重选、下载进度、取消、后台切换和宿主冒泡隔离。行/语句/函数100%，分支191/192；剩一个映射到源码第1行的编译器createCommentVNode空分支，对应loading/error之外又没有result的不可能状态，暂未为制造覆盖率修改生产状态或删除保护。
- 五个严格模块最终四维100：pdfLayoutAnalysis、binary、document translation、image client、youtubeHumanCaptions；28个相关测试文件1458通过、4个既有条件语料skip。跳过项不计为通过，全仓100%仍以主报告为准。

## 本地模型与视频入口补充（2026-10-23 10:38 UTC）

- 本地翻译 Worker 切换 OPUS 翻译方向时，旧模型 dispose 抛错会反复保留损坏实例，使后续重试持续失败；先清空实例所有权再执行释放，同时保留当前请求的释放错误。OPUS dispose 和混元 exit 失败后均能由下一请求重建，真实 Worker 队列回归原版失败、修复后通过。
- 通过实际消息入口补充混元 GPU 成功、GPU→CPU 回退、双失败释放、模型复用、输出超限、空输出、90秒中断、已校验缓存与旧缓存回退、本地下载进度/移除、Worker崩溃和重试。65项 Worker/owner 测试及WASM兼容测试通过；owner函数100%，语句/行98.59%、分支97.58%；Worker语句/行100%、分支98.09%，函数77.77%余四个native日志空回调。未伪造标准AbortSignal的同步竞态来填补防御守卫。
- 共享 offscreen 入口通过真实startOffscreenApp与messageRouter执行翻译、OCR、读音、ASR、TTS播放、下载通知和pagehide释放；10项通过，语句/行/函数100%、分支38/40。两个余项为未来非默认模型下载ID以及TTS未知非Error错误的保守处理。
- 删除已无首次启动入口的历史 live VideoAiCaptureController及专用33项测试。生产唯一实例从requested=false开始，只有已requested的resume条件才能调用start；完整采集的isActive/isRequested相等，无法借完整状态进入live。该状态归纳与唯一生产调用图由root独立复核，详见video-live-capture-reachability.md。共享音频/识别类型迁入fullCapture，当前完整音频的HLS/MP4、快速解码和隐藏扫描回退保持。
- 删除前后实际菜单与完整控制器3文件157项均通过，包含新增隐藏扫描成功/取消、可见播放暂停/恢复不接管、ready字幕重播、visibility/pageshow和卸载。runtime从本轮删除前1879行减至1743行；capture基线748行及其783行专用测试被删除。旧capture时钟修复的中间证据仍保留，但不把已删除的类算作本次最终功能修复。
- linkedom在MutationObserver.disconnect后仍派发空批次，最小复现实证见linkedom-disconnect-probe.log。测试端口现在按原生订阅/断开语义过滤，不把这个测试环境差异当作产品bug。

## 完整字幕清理与入口覆盖补充（2026-10-23 10:59 UTC）

- 删除live采集后再次核对生产消费者，移除audioWindow中只服务旧live模式的流配置类型、窗口配置函数和自适应提交步长函数，及5条仅测试这两函数的用例。保留完整采集使用的重采样、静音判断和PCM编码。requestSession从full/live双项Map精简为单个完整生成会话，保留单调后台generation、过期准备/取消隔离和dispose后的有效取消身份；合并重复live/full测试，6文件231项回归通过。
- playerMenu去掉已经没有生产状态来源的running/requested字段及旧实时识别提示，完整录音、转写、完成、失败与取消状态不变。完整菜单109项测试与类型检查通过。音频窗口、requestSession和fullCapture重新测得四维100%，分别116/18/940行；这是三个模块的定向结果，不代表整个视频功能四维100%。
- 视频实际挂载入口新增当前句学习SFC打开/关闭、会议字幕、读音失败重试、原文/双语导出及取消、YouTube隐藏轨道捕获与复用、原生全屏字幕轨道、模型下载失败重试、匿名媒体绑定等流程。72项runtime测试通过；联合4文件132项的runtime覆盖为语句/行91.63%、函数138/139、分支597/730。余下模型菜单错误回调被固定浏览器能力与禁用按钮共同保护，未通过修改常量制造入口。
- streamingTranscript的partial语义仍被完整音频分段输出和预览过滤使用，因此保留；“删除live类”不等于可以删除所有带流式或partial名称的共享行为。

证据：`video-orphan-cleanup-regression.log`、`video-cleanup-coverage/coverage-summary.json`、`video-complete-menu-cleanup.log`、`video-composition-coverage/coverage-summary.json`、`video-composition-compile.log`。

## 设置、应用出口与取消验证补充（2026-10-23 11:15 UTC）

- PDF OCR 页面在渲染Promise结算之后、调用方await恢复之前收到取消时，原实现仍执行同步PNG编码并返回过期图像。用实际Promise和queueMicrotask顺序复现，原版1失败/48通过；编码前检查取消信号后保留原reason、跳过编码并在finally释放画布，3文件126项通过。没有修改AbortSignal getter或制造不可达状态。
- ImageOcrSettings补充真实模板控件、可见性轮询合并、状态失败重试、下载部分成功、实时字节进度、关闭后迟到失败；MangaSettings补充父配置更新、实际原/译图预览、站点搜索、非法输入和20条上限。27项通过，两个设置组件语句/行/函数100%，分支分别92.22%和97.33%。第三方select/switch和linkedom缺失的原生details.open反射行为仅作为浏览器边界补足，未替换组件setup或模板。
- MangaEntry补充真实启动按钮的俄/韩语言资源说明、圈选入口禁用反馈、失败重试和导航后迟到拒绝；46项通过，94行/10函数/120分支四维100%。ImageTranslationSettingsPreview在上述父设置流程中原图/译图互换，23行/2函数/18分支四维100%。
- 网页图片入口实际组合漫画画布与同源背景适配器，验证OCR准备、阶段进度、交互层遮挡、暂停后的迟到准备、完整缓存复用和宿主原图保持；220项通过。这一批只加载单个runtime测试，覆盖率为语句/行95.33%、函数106/109、分支92.79%，其他文件已覆盖的入口不计入本批分母结论。
- 四类Worker测试经正式app出口启动，继续运行原有真实消息队列与资源所有权断言；没有新增只比较再导出相等的测试。4个出口各有1条可执行导出语句且无函数或分支，归因均100%。包括图片/设置一起的6文件360项通过。
- 文档页面装配测试补足公共选区捕获回调和onUnmount释放，124项通过，page.ts的8行/2函数/2分支四维100%。视频后台装配通过真实handler执行浏览器存储、模型准备与发送方归属的读音消息；YouTube页面适配器通过真实Response、Fetch/XHR端口和启停事件验证原响应未消费及宿主方法恢复。38项通过，两个模块分别14行/3函数/3分支、25行/10函数/10分支四维100%。
- HLS完整MP4读取补充未决ReadableStream在用户取消和20秒截止时的清理，底层cancel永不结算也不占用reader；23项通过，语句/行/函数100%，分支84.82%，仅为该文件定向结果。

证据：`pdf-ocr-cancel-red.log`、`pdf-ocr-cancel-green.log`、`image-settings-coverage/coverage-summary.json`、`manga-entry-composition-coverage/coverage-summary.json`、`preview-ocr-coverage/coverage-summary.json`、`image-runtime-composition-coverage.log`、`media-app-entry-regression.log`、`worker-app-entry-coverage/coverage-summary.json`、`document-page-composition.log`、`video-browser-adapters-coverage/coverage-summary.json`、`hls-cancellation-coverage.log`、`media-checkpoint7-compile.log`。

## 阅读生成链独立交叉审查（2026-10-23 11:38 UTC）

只读审阅共享Harness六个拆分模块与userscript轻量生成器，并对照锁定的原AI SDK实现。16个旧函数体token一致；其余组合入口、输入校验和错误归一逐函数核对。发现并交由原负责人修复Gemini后置空文本签名/字符串工具参数、生成失败统计、轮转重放与按attempt重复统计、Claude思考签名和并行工具结果分组。独立fetch/ReadableStream探针已复验：401轮转成功两端均2请求/1次success；开始输出后网络失败两端均1请求/1次error；Claude后续消息体一致。探针位于research，不计正式测试覆盖率或发布测试总量。

用量计时包括全部Key尝试。新轻量HTTP失败不等待provider正文，保留status/headers归一，但400等错误缺少旧SDK读取的provider详细说明；此明确兼容差已交主任务评估，不能宣称全部错误文案等价。此审查没有验证在线供应商、私有代理或真实账号。详见`harness-independent-review.md`、`harness-independent-review.json`、`harness-independent-final-source.json`及`reading-parity-probe-*.json`。

## Standalone静态资源编码（2026-10-23）

检查实际3,641,566字节的standalone后，确认CSS、英文/中文词典和两张关于页JPEG已经gzip压缩；进一步压缩相同字节的文本表示可以避免删功能。新增独立构建编码器与运行时解码器，使用不含引号、反斜杠或非ASCII字符的Base85，保留自识别前缀、0至3字节填充，拒绝非法长度、字符、超32位块和非零尾填充。其余旧Base64仍按原atob路径恢复。root只对接这五份既有纯数据链，不压缩或动态执行代码，不改许可、图片像素、CSS或消息内容。

15项单元测试覆盖所有字节、0至1024长度与带offset视图、UTF-8/gzip恢复、旧Base64兼容和非法表示；两文件四维100%。实际五份产物解码后的SHA256均与改变编码前的独立探针相同；纯字符串表示合计减少51,653字节。编码落地时整包实测3,592,434字节；S11 后续源码合并后的大小为上表3,595,448字节，不将同时发生的其他源码改动归因给此编码器。

实际生产codec在Node20/ARM64完成5轮预热后15轮交替对照。最大CSS的299,620字节gzip数据：原atob加Uint8Array.from解码中位25.82ms，新解码1.87ms；包含pako恢复33.52→9.62ms。其他四项亦未观测处理回退。查表只占256字节，初始化中位0.00042ms。这是本机Node微基准，不是实浏览器启动提速结论；浏览器DecompressionStream未在此测量，调用与fallback语义保持。类型检查与diff检查通过。

证据：`static-base85-opportunity.json`、`probe-static-base85.mjs`、`data-encoding-coverage/coverage-summary.json`、`data-encoding-compile.log`、`codec-benchmark/run.mjs`、`codec-benchmark/results.json`。代码边界为`userscript/dataEncoding.ts`和`userscript/buildDataEncoding.ts`；构建对接由主任务验证。

## PDF性能验证

18个实际页面的相同提取输入，5轮预热后15轮交替运行基线与当前，每轮克隆输入并在计时前GC。初版修复额外开销约11%，没有接受该回退。CPU profile定位到公式判断和正文邻居判断在几何筛选前反复全文分词；调整等价条件顺序、去掉无脚标候选时的额外空间桶扫描及逐图形重建数组后，最终中位75.00→49.52ms，约降低34.0%。优化前后的修复版输出SHA256完全相同；基线输出因真实布局bug不同，未伪称与基线行为相同。

计时段内GC事件基线105次、当前51次。heapUsed差值6.41MB→16.61MB受回收次数影响，不能用它推断实际分配量、峰值或常驻内存增减。该基准仅覆盖纯布局分析，不代表完整导入、浏览器渲染或所有PDF均提速34%。脚本及全部样本见`benchmark-pdf-layout.mjs`、`pdf-layout-alternating.json`，CPU profile证据为`pdf-layout-perf.cpuprofile`。

## 已完成验证（阶段记录）

新增证据：`local-worker-expanded-red.log`、`local-translation-runtime-coverage.log`、`offscreen-composition-coverage/coverage-summary.json`、`video-live-cleanup-regression.log`、`video-live-cleanup-compile.log`。

日志位于 `/Users/thinkstu/Desktop/copy/research/release-audit-20261023/media/`。

| 证据 | 结果与范围 |
| --- | --- |
| `learning-center-complete-coverage/coverage-summary.json` | 两个真实SFC组件91测试：TranslationCenter 287行/62函数/344分支，VideoSentenceLearning 326行/54函数/424分支，四维均100%，未忽略源码 |
| `pdf-reader-interaction-coverage/coverage-summary.json` / `pdf-reader-highlight-retry.log` | 真实PdfReader菜单/选区/材料恢复/样式/弹窗，行与语句100%；进一步83测试通过，完整分支仍待补齐 |
| `pdf-glyph-font-state-before.log` / `pdf-glyph-invalid-outlines.log` | 字体状态归属旧1失败，新57项导入回归通过 |
| `pdf-condition-order-corpus.log` / `corpus-overlaps-after-strokes.json` | 13项通过：12项生成的典型论文布局用例，加1项遍历四份真实完整PDF的语料测试；四份真实语料重叠列表为空，沿用原断言和原文件，不能称为13份真实PDF |
| `strict5-owner-coverage/coverage-summary.json` | 五个严格模块3048行/202函数/3031分支四维100%，28文件1458通过、4既有skip |
| `coverage-probe/area-raw-coverage.json` / `area-workflow-coverage.log` | 区域翻译24项真实控件验证；余1个不可达编译器注释分支已定位，未忽略源码 |
| `video-object-position-before.log` / `video-object-position-after.log` | Edge实际computed样式回放，原5失败，新2文件79通过 |
| `audio-duration-after.log` / `full-capture-coverage/coverage-summary.json` | 3文件102通过，fullCapture四维100%；实际超限PCM与未决关闭回归 |
| `audio-clock-jump-after.log` / `realtime-capture-coverage/coverage-summary.json` | 中间阶段capture33项通过；随后证实没有生产首次入口，类与专用测试已删除，不计最终功能覆盖 |
| `pdf-live-search-before.log` / `pdf-live-search-after.log` | 旧实现丢失当前命中身份；修复后阅读器78项通过 |
| `pdf-narrow-gutter-before.log` / `pdf-narrow-gutter-after.log` | 真实双栏坐标回归先失败后通过，2文件200通过、1既有skip |
| `subtitle-malformed-after.log` / `subtitle-data-coverage/coverage-summary.json` | 2文件416通过，youtubeSubtitleData四维100% |
| `asr-negation-before.log` / `asr-negation-after.log` | 否定缩约旧逻辑4失败，新逻辑3文件123通过 |
| `pdf-inline-strokes-before.log` / `pdf-vector-accents-before.log` | 行内数学笔画与向量重音的原逻辑失败证据 |
| `subtitle-transport.log` | 5文件190测试通过：包含真实未决流、总时限、取消、3槽释放、页面卸载、UTF-8跨chunk与12000条长字幕 |
| `subtitle-coverage.log` / `subtitle-coverage/coverage-summary.json` | 新模块subtitleTransport四项100%，4文件152测试通过；仅此模块的测量 |
| `local-assets.log` | 3文件53测试通过：模型镜像回退、漫画/Hindi拒绝正文回收、迟到清理拒绝 |
| `cache-reading-regression.log` | 4文件111测试通过：TTS查询预算、Chrome共享租约、PDF材料定位、文档预览 |
| `document-core-regression.log` | 5文件110通过、1个原有明确skip：文本/字幕解析和二进制导出 |
| `cleanup-regression.log` | 8文件死API清理回归通过；包含原有明确skip，须以日志为准 |
| `bridge-after.log` | 3文件69通过：MAIN-world字节/时间预算、宿主响应不受影响、卸载后迟到不克隆 |
| `history-cursor-after.log` | 3文件173通过、1既有skip：历史游标、导入恢复、迟到提交/淘汰所有权 |
| `followup-coverage/coverage-summary.json` | history.ts、image-translation/core.ts、youtubeTimedTextBridgeCore.ts四维分别100% |
| `document-app-regression.log` | 3文件179通过：深色富文本预览、文档操作与批次组件 |
| `pdf-region-cleanup.log` | 2文件93通过、1既有skip：旋转区域导出和二进制格式 |
| `pdf-layout-input-before.log` / `pdf-layout-input-after.log` | 冻结原图形的失败与修复证据；重复解析输出稳定 |
| `pdf-column-transition-before.log` / `pdf-table-final-row-before.log` | 通栏转双栏、缺底线末行回归在原逻辑失败 |
| `nasa-page-11.png` / `nasa-page-35.png` / `corpus-overlaps-current.json` | 原始PDF页面与全语料重叠实测，不把首失败后未执行的页算通过 |
| `ocr-groups-alternating.json` | 真实OCR normalizer与基线比较；15轮交替、输出相等和内存/时间观测 |
| `text-ending-before.log`, `subtitle-tags-before.log`, `bridge-before.log`, `history-cursor-before.log` | 新回归在修复前失败的根因证据 |

另已完成图片运行时217项、PDF/OCR/文档初始化314项等定向回归；这些运行存在重叠，不将各批测试数相加宣称独立总量。完整回归与构建仍待主任务汇总。

## 验证界限

当前使用受资源限制的Vitest真实实现+可替换边界端口；真实ReadableStream不依赖简化text mock。没有在此分任务访问用户真实PDF、账号、在线翻译供应商、真实长视频或实体移动设备。模型大文件相关既有虚拟容量夹具不证明真实模型下载/推理质量，资源清理回归使用真实流。基线全部函数体已语义审阅，但仍不能将本阶段报告作为发布完成声明；真实PDF语料已通过，但不涵盖用户所有文档、未知嵌入字体或实站在线供应商。
