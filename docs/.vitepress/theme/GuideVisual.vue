<script setup lang="ts">
import { computed, ref } from 'vue'
import { useData } from 'vitepress'
import BrandReader from './BrandReader.vue'
import BrowserGuide from './BrowserGuide.vue'
import FeatureDemo from './FeatureDemo.vue'
import TransferFlow from './TransferFlow.vue'
import DemoSteps from './DemoSteps.vue'
import SettingsGuide from './SettingsGuide.vue'
import { useDemoPlayback } from './useDemoPlayback'
const props = defineProps<{ kind: string; en?: boolean; compact?: boolean }>()
const { lang } = useData()
const english = computed(() => props.en ?? lang.value.startsWith('en'))
const t = (zh: string, en: string) => (english.value ? en : zh)
const root = ref<HTMLElement | null>(null)
const { step, playing, running, reduced, select, replay } = useDemoPlayback(
  root,
  6,
  true,
  [1800, 1200, 1200, 1800, 1800, 1800]
)
const changed = computed(() => step.value >= 3)
const words = computed(
  () =>
    ({
      install: [
        t('固定图标，打开菜单', 'Pin the icon and open the menu'),
        t('点图标看示意', 'Open the example menu'),
      ],
      hover: [
        t('翻译鼠标所指的段落', 'Translate just this paragraph'),
        t('模拟按下 Control', 'Simulate Control'),
      ],
      selection: [
        t('划词翻译 · 选中句子看译文', 'SELECTION · TRANSLATE A SENTENCE'),
        t('打开示例词卡', 'Open the example card'),
      ],
      image: [
        t('图片翻译 · 原图与译文', 'IMAGE · ORIGINAL & TRANSLATION'),
        t('查看译图', 'Show translation'),
      ],
      area: [
        t('圈出需要的那一块', 'Select just the area you need'),
        t('查看圈选结果', 'Show selected-area result'),
      ],
      document: [
        t('导入文档并查看双语译文', 'Import a file to read alongside its translation'),
        t('查看双语结果', 'Show bilingual result'),
      ],
      video: [
        t('视频翻译 · 双语字幕', 'VIDEO · BILINGUAL CAPTIONS'),
        t('显示双语字幕', 'Show bilingual captions'),
      ],
      input: [
        t('翻译输入框中的文字', 'Translate text in an input field'),
        t('翻译示例', 'Translate example'),
      ],
      writing: [
        t('先检查，再插入回复', 'Review the draft before inserting your reply'),
        t('查看示例草稿', 'Show example draft'),
      ],
      provider: [
        t('选择适合你的翻译服务', 'Choose your translation provider'),
        t('查看服务连接示意', 'Show a provider connection'),
      ],
      appearance: [
        t('调整译文显示样式', 'Customize translation appearance'),
        t('切换译文样式', 'Change translation style'),
      ],
      backup: [
        t('导出与恢复配置备份', 'Export and restore settings'),
        t('查看恢复流程', 'Show restore flow'),
      ],
      learning: [
        t('收藏句子并在学习中心复习', 'Save a sentence for review'),
        t('收藏示例句子', 'Save example sentence'),
      ],
      glossary: [
        t('指定专业词汇的译法', 'Set translations for your terms'),
        t('应用示例术语', 'Apply example term'),
      ],
      share: [
        t('将原文与译文制作成分享卡片', 'Create a bilingual share card'),
        t('查看分享卡', 'Show share card'),
      ],
      shortcuts: [
        t('使用快捷键翻译和恢复原文', 'Translate and restore with shortcuts'),
        t('查看操作结果', 'Show action result'),
      ],
      stats: [
        t('了解自己的翻译用量', 'See your translation activity'),
        t('切换查看范围', 'Change time range'),
      ],
      rules: [
        t('设置网站自动翻译', 'Enable automatic translation for a site'),
        t('添加示例网站', 'Add example site'),
      ],
      privacy: [
        t('翻译内容的数据传递方式', 'How translation data is transferred'),
        t('查看数据流程', 'Show data flow'),
      ],
      sync: [
        t('保存配置与恢复备份', 'Save and restore settings'),
        t('查看恢复方向', 'Show the restore direction'),
      ],
      compare: [
        t('对比不同服务的翻译结果', 'Compare translations of the same sentence'),
        t('查看对比结果', 'Show comparison'),
      ],
      userscript: [
        t('脚本管理器 → 流畅阅读', 'Script manager → FluentRead'),
        t('查看脚本启用示意', 'Show the enabled script'),
      ],
      email: [
        t('阅读邮件原文与译文', 'Read an email in two languages'),
        t('查看双语邮件', 'Show bilingual email'),
      ],
      settings: [
        t('搜索并修改设置', 'Find and change a setting'),
        t('查看目标语言设置', 'Show target language setting'),
      ],
    } as Record<string, string[]>)
)
const text = computed(() => words.value[props.kind] || words.value.shortcuts)
const workflows = computed<Record<string, string[]>>(() => ({
  compare: [
    t('输入原文', 'Enter text'),
    t('选择服务并翻译', 'Compare providers'),
    t('对照结果', 'Read the results'),
  ],
  sync: [
    t('连接云存储', 'Connect storage'),
    t('保存配置', 'Save settings'),
    t('恢复或合并', 'Restore or merge'),
  ],
  settings: [
    t('搜索设置', 'Find a setting'),
    t('修改选项', 'Change an option'),
    t('自动保存', 'Saved automatically'),
  ],
  userscript: [
    t('安装脚本管理器', 'Install a manager'),
    t('安装流畅阅读', 'Install FluentRead'),
    t('启用脚本', 'Enable the script'),
  ],
  email: [t('打开邮件', 'Open an email'), t('翻译正文', 'Translate'), t('对照阅读', 'Read both')],
  image: [
    t('悬停图片', 'Hover an image'),
    t('点击翻译', 'Click translate'),
    t('查看译图', 'Read the result'),
  ],
  area: [
    t('按下圈选快捷键', 'Use the shortcut'),
    t('拖动选择区域', 'Select an area'),
    t('查看译文', 'Read translation'),
  ],
  video: [
    t('播放视频', 'Play a video'),
    t('开启双语字幕', 'Enable captions'),
    t('双语观看', 'Watch both'),
  ],
  input: [
    t('输入文字', 'Enter text'),
    t('连按空格键', 'Press Space repeatedly'),
    t('使用译文', 'Use the translation'),
  ],
  writing: [
    t('打开写作助手', 'Open the assistant'),
    t('生成回复草稿', 'Create a draft'),
    t('检查后插入', 'Review & insert'),
  ],
  share: [
    t('查看划词结果', 'Translate a selection'),
    t('制作分享卡', 'Create a card'),
    t('保存图片', 'Save image'),
  ],
  learning: [
    t('选中文字', 'Select text'),
    t('收藏词句', 'Save a word or sentence'),
    t('学习中心复习', 'Review saved items'),
  ],
  provider: [
    t('选择翻译服务', 'Choose a provider'),
    t('配置服务连接', 'Configure connection'),
    t('按功能分配服务', 'Assign providers'),
  ],
  appearance: [
    t('打开界面风格', 'Open Appearance'),
    t('选择译文样式', 'Choose a style'),
    t('预览译文', 'Preview the result'),
  ],
  backup: [
    t('打开备份与恢复', 'Open Backup & restore'),
    t('导出备份', 'Export backup'),
    t('从备份恢复', 'Restore from backup'),
  ],
  privacy: [
    t('选择待译文字', 'Select text'),
    t('发送到所选服务', 'Send to the provider'),
    t('接收译文', 'Receive translation'),
  ],
  glossary: [
    t('添加术语', 'Add a term'),
    t('指定译法与范围', 'Set translation & scope'),
    t('检查命中结果', 'Preview matches'),
  ],
  rules: [
    t('打开网站规则', 'Open site rules'),
    t('添加网站偏好', 'Add a preference'),
    t('检查生效规则', 'Preview applied rules'),
  ],
  stats: [
    t('打开翻译统计', 'Open statistics'),
    t('选择查看范围', 'Choose a view'),
    t('查看请求与耗时', 'Review requests & timing'),
  ],
  shortcuts: [
    t('打开网页', 'Open a page'),
    t('按下快捷键', 'Press the shortcut'),
    t('翻译或恢复', 'Translate or restore'),
  ],
}))
const workflow = computed(() => workflows.value[props.kind] ?? workflows.value.shortcuts)
const activeStage = computed(() => (step.value === 0 ? 0 : step.value < 3 ? 1 : 2))
</script>
<template>
  <BrowserGuide
    v-if="
      kind === 'install' ||
      kind === 'pin' ||
      kind === 'first-translation' ||
      kind === 'hover' ||
      kind === 'selection' ||
      kind === 'chrome-local'
    "
    :key="kind"
    :kind="kind"
    :en="english"
  />
  <BrandReader v-else-if="kind === 'webpage'" :en="english" />
  <FeatureDemo v-else-if="kind === 'document'" kind="document" :en="english" />
  <SettingsGuide
    v-else-if="
      [
        'settings',
        'provider',
        'appearance',
        'compare',
        'backup',
        'glossary',
        'rules',
        'stats',
        'learning',
      ].includes(kind)
    "
    :kind="kind"
    :en="english"
  />
  <div
    ref="root"
    v-else
    class="gv"
    :class="[`gv-${kind}`, { compact, changed }]"
    :data-visual="kind"
    :data-step="step"
    :data-playing="playing"
    :data-running="running"
  >
    <div class="gv-heading">
      <span>{{ text[0] }}</span>
      <span class="gv-example">{{ t('操作示意', 'Walkthrough') }}</span>
    </div>
    <DemoSteps
      :labels="workflow"
      :active="activeStage"
      :label="t('操作流程', 'Workflow')"
      :playing="playing"
      :reduced="reduced"
      :en="english"
      @select="select($event, [0, 1, 3])"
    />
    <div class="gv-stage">
      <template v-if="kind === 'sync'">
        <TransferFlow kind="sync" :en="english" :running="running" />
        <p class="gv-flow-note">
          {{
            changed
              ? t(
                  '先预览云端配置，再确认恢复或合并到本机。',
                  'Preview the backup before restoring or merging it.'
                )
              : t(
                  '核对本机配置后，确认保存到所选云存储。',
                  'Review local settings before saving them to cloud storage.'
                )
          }}
        </p>
      </template>
      <template v-else-if="kind === 'settings' || kind === 'userscript'">
        <div class="gv-connection">
          <span>
            {{
              kind === 'settings'
                ? t('设置搜索', 'Search settings')
                : t('脚本管理器', 'Script manager')
            }}
          </span>
          <b>{{ kind === 'settings' ? t('⌕ 目标语言', '⌕ Target language') : t('流畅阅读', 'FluentRead') }}</b>
          <div class="gv-rule-row">
            <span>
              {{
                kind === 'settings'
                  ? changed
                    ? t('简体中文', 'English')
                    : t('选择目标语言', 'Choose a target')
                  : changed
                  ? t('已启用', 'Enabled')
                  : t('安装后开启脚本', 'Enable after installation')
              }}
            </span>
            <span
              v-if="kind === 'userscript'"
              class="gv-toggle"
              :class="{ enabled: changed }"
              aria-hidden="true"
            ></span>
          </div>
          <small>
            {{
              kind === 'settings'
                ? t(
                    '搜索定位设置，修改后自动保存。',
                    'Search to locate a setting. Changes save automatically.'
                  )
                : t(
                    '先安装兼容的脚本管理器，再安装脚本。',
                    'Install a compatible manager, then the script.'
                  )
            }}
          </small>
        </div>
      </template>
      <template v-else-if="kind === 'email'">
        <div class="gv-sentence">
          <span>{{ t('邮件正文 · 示例', 'Email body · example') }}</span>
          <p>
            {{ t('Thanks for your help. Let’s talk tomorrow.', '谢谢你的帮助。我们明天再聊。') }}
          </p>
          <p v-if="changed" class="gv-output">
            {{ t('谢谢你的帮助。我们明天再聊。', 'Thanks for your help. Let’s talk tomorrow.') }}
          </p>
          <span class="gv-key">
            {{
              t('① 打开邮件 → ② 翻译正文 → ③ 对照阅读', '① Open email → ② Translate → ③ Compare')
            }}
          </span>
        </div>
      </template>
      <template v-else-if="kind === 'image'">
        <div class="gv-comic">
          <span class="gv-comic-label">{{ t('漫画气泡翻译示例', 'Comic dialogue example') }}</span>
          <div class="gv-comic-bubble" :class="{ 'gv-local-result': changed }">
            {{
              changed
                ? t('我发现了一个新故事！', 'I found a new story!')
                : t('I found a new story!', '我发现了一个新故事！')
            }}
          </div>
          <svg viewBox="0 0 340 130" aria-hidden="true">
            <path d="M18 112h304M240 112V62h47v50M247 72h12m14 0h7m-33 15h12m14 0h7" />
            <circle cx="92" cy="38" r="20" />
            <path
              d="M73 33c4-22 38-24 40 0M86 41h1m12 0h1M87 50q6 5 11-1M81 60q-22 6-27 42m46-42q24 7 26 34M78 70l-7 42m36-42 6 42M59 91l36-3"
            />
            <path
              class="gv-comic-book"
              d="M101 82q17-8 34 0v32q-17-8-34 0-17-8-34 0V82q17-8 34 0v32"
            />
            <path d="M153 106q17-36 31-12t28 7M28 111l7-16 8 16" />
          </svg>
          <small>
            {{
              changed
                ? t('原文：I found a new story!', 'Original: 我发现了一个新故事！')
                : t('英文原图', 'Chinese original')
            }}
          </small>
        </div>
      </template>
      <template v-else-if="kind === 'area'">
        <div class="gv-poster">
          <div class="gv-poster-shape" aria-hidden="true"></div>
          <div class="gv-crop outlined">
            <span class="gv-poster-small">FIELD NOTES / 2026</span>
            <b>{{ t('Stay curious', '保持好奇') }}</b>
            <span>{{ t('The world is yours to explore.', '世界，值得探索。') }}</span>
          </div>
          <small>{{ t('圈选区域中的原文', 'Original text inside the selection') }}</small>
        </div>
        <div v-if="changed" class="gv-result">
          <strong>{{ t('识别与翻译', 'Recognition & translation') }}</strong>
          <p>Stay curious → {{ t('保持好奇', 'Stay curious') }}</p>
        </div>
      </template>
      <template v-else-if="kind === 'video'">
        <div class="gv-video">
          <span class="gv-video-tag">
            {{ t('视频 / 会议字幕示例', 'Video / meeting caption example') }}
          </span>
          <div class="gv-video-landscape" aria-hidden="true"></div>
          <span class="gv-video-play" aria-hidden="true">▷</span>
          <div class="gv-caption">
            <p>{{ t('Let’s review the plan together.', '我们一起回顾一下计划。') }}</p>
            <p v-if="changed" class="gv-local-result">
              {{ t('我们一起回顾一下计划。', 'Let’s review the plan together.') }}
            </p>
          </div>
          <span class="gv-timeline" aria-hidden="true"></span>
        </div>
      </template>
      <template v-else-if="['input', 'writing'].includes(kind)">
        <div class="gv-editor">
          <span>
            {{ kind === 'writing' ? t('回复草稿', 'Reply draft') : t('输入框', 'Input field') }}
          </span>
          <p>
            {{
              kind === 'writing'
                ? t('感谢你的建议，我们会在下一版改进。', '感谢你的建议，我们会在下一版改进。')
                : t('谢谢你的回复，我们明天继续讨论。', '谢谢你的回复，我们明天继续讨论。')
            }}
          </p>
          <p v-if="changed" class="gv-output">
            {{
              kind === 'writing'
                ? 'Thank you for your suggestion. We will improve this in the next update.'
                : 'Thank you for your reply. Let’s continue tomorrow.'
            }}
          </p>
          <div>
            <small>
              {{
                changed
                  ? t(
                      '检查后再插入 · 不会自动发送',
                      'Review before inserting · never sends automatically'
                    )
                  : t('输入需要翻译的文字', 'Start with your own thoughts')
              }}
            </small>
            <span aria-hidden="true">↗</span>
          </div>
        </div>
      </template>
      <template v-else-if="kind === 'share'">
        <div v-if="changed" class="gv-share-card">
          <blockquote>
            {{ t('Every language opens a new door.', '每一种语言都打开一扇新的门。') }}
          </blockquote>
          <p>{{ t('每一种语言都打开一扇新的门。', 'Every language opens a new door.') }}</p>
          <small>{{ t('流畅阅读', 'FluentRead') }} / example.com</small>
        </div>
        <div v-else class="gv-sentence">
          <span>{{ t('你选中的好句子', 'Your selected sentence') }}</span>
          <p>{{ t('Every language opens a new door.', '每一种语言都打开一扇新的门。') }}</p>
          <span class="gv-key">
            {{
              t(
                '① 查看划词结果 → ② 制作卡片 → ③ 保存图片',
                '① Translate a selection → ② Create a card → ③ Save image'
              )
            }}
          </span>
        </div>
      </template>
      <template v-else-if="kind === 'learning'">
        <div class="gv-sentence">
          <span>{{ t('原文', 'Original') }}</span>
          <p>
            <mark :class="{ 'gv-selected': step >= 1 }">
              {{ t('Every language opens a new door.', '每一种语言都打开一扇新的门。') }}
            </mark>
          </p>
          <div v-if="changed" class="gv-result">
            <strong>{{ t('✓ 已收藏', '✓ Saved') }}</strong>
            <p>{{ t('每一种语言都打开一扇新的门。', 'Every language opens a new door.') }}</p>
          </div>
          <span v-else class="gv-key">
            {{
              t(
                '选中句子后在翻译结果中点击收藏',
                'Select a sentence and save it from the translation result'
              )
            }}
          </span>
        </div>
      </template>
      <template v-else-if="['backup', 'privacy'].includes(kind)">
        <TransferFlow
          :kind="kind === 'backup' ? 'backup' : 'privacy'"
          :en="english"
          :running="running"
        />
        <p class="gv-flow-note">
          {{
            kind === 'backup'
              ? changed
                ? t(
                    '① 选择备份文件 → ② 预览内容 → ③ 确认导入',
                    '① Choose backup → ② Preview → ③ Confirm import'
                  )
                : t('① 选择备份内容 → ② 导出文件', '① Choose data → ② Export file')
              : t(
                  '使用云端翻译时，待译文字发送给所选服务。',
                  'Cloud translation sends the selected text to your chosen provider.'
                )
          }}
        </p>
      </template>
      <template v-else-if="kind === 'stats'">
        <div class="gv-chart" :aria-label="t('示例用量图', 'Example activity chart')">
          <span
            v-for="(height, i) in changed
              ? [30, 70, 50, 85, 55, 100, 65]
              : [20, 35, 55, 40, 80, 65, 95]"
            :key="i"
            :style="{ height: `${height}%` }"
          ></span>
        </div>
        <p class="gv-flow-note">
          {{
            t(
              '示例数据 · 实际统计在扩展设置中查看',
              'Example data · see actual activity in extension settings'
            )
          }}
        </p>
      </template>
      <template v-else>
        <div class="gv-shortcut">
          <kbd>Alt</kbd>
          <span>+</span>
          <kbd>T</kbd>
          <span>→</span>
          <b>
            {{
              changed ? t('恢复原文', 'Restore original') : t('翻译当前网页', 'Translate this page')
            }}
          </b>
        </div>
        <p class="gv-flow-note">
          {{
            t('Mac 使用 Option；可在设置中修改。', 'Use Option on Mac. Customize it in settings.')
          }}
        </p>
      </template>
    </div>
    <div v-if="kind !== 'privacy'" class="gv-controls">
      <small>{{ t('自动演示 · 示例内容', 'Auto demo · sample content') }}</small>
      <div>
        <button
          v-if="!reduced"
          type="button"
          :aria-label="
            playing ? t('暂停图解演示', 'Pause walkthrough') : t('播放图解演示', 'Play walkthrough')
          "
          @click="playing = !playing"
        >
          {{ playing ? t('暂停', 'Pause') : t('播放', 'Play') }}
        </button>
        <button type="button" @click="replay">{{ t('重播', 'Replay') }}</button>
      </div>
    </div>
  </div>
</template>
