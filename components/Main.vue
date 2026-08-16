<template>
  <section v-show="props.activeSection === 'settings-general'" id="settings-general" class="settings-section">
  <!-- 开关 -->
  <el-row class="margin-bottom margin-left-2em settings-status-row">
    <el-col :span="18" class="lightblue rounded-corner">
      <div class="settings-status-copy">
        <span class="settings-status-kicker">{{ config.on ? '正在工作' : '已暂停' }}</span>
        <strong>插件状态</strong>
        <small>{{ config.on ? '网页翻译与快捷功能均已启用' : '重新启用后即可继续翻译网页' }}</small>
      </div>
    </el-col>

    <el-col :span="6" class="flex-end settings-status-control">
      <span class="settings-status-badge" :class="{ active: config.on }"><i />{{ config.on ? '已启用' : '已暂停' }}</span>
      <el-switch class="settings-switch" v-model="config.on" aria-label="插件状态" size="large" @change="handlePluginStateChange" />
    </el-col>
  </el-row>

  <!-- 占位符 -->
  <div v-if="!config.on">
    <el-empty description="插件处于禁用状态" />
  </div>

  <div v-show="config.on">
    <!--    翻译模式-->
    <el-row class="margin-bottom margin-left-2em settings-preference-row">
      <el-col :span="12" class="lightblue rounded-corner">
        <span class="popup-text popup-vertical-left">翻译模式</span>
      </el-col>
      <el-col :span="12">
        <el-select v-model="config.display" aria-label="翻译模式" placeholder="请选择翻译模式">
          <el-option class="select-left" v-for="item in options.display" :key="item.value" :label="item.label"
            :value="item.value" />
        </el-select>
      </el-col>
    </el-row>

    <!-- 默认目标语言 -->
    <el-row class="margin-bottom margin-left-2em settings-preference-row">
      <el-col :span="12" class="lightblue rounded-corner">
        <span class="popup-text popup-vertical-left">默认目标语言</span>
      </el-col>
      <el-col :span="12">
        <el-select v-model="config.to" aria-label="默认目标语言" placeholder="请选择目标语言">
          <el-option class="select-left" v-for="item in options.to" :key="item.value" :label="item.label"
            :value="item.value" />
        </el-select>
      </el-col>
    </el-row>

    <!--    译文样式选择器-->
    <el-row v-show="config.display === 1" class="margin-bottom margin-left-2em settings-preference-row">
      <el-col :span="12" class="lightblue rounded-corner">
        <el-tooltip class="box-item" effect="dark" content="选择双语模式下译文的显示样式，提供多种美观的效果" placement="top-start"
          :show-after="500">
          <span class="popup-text popup-vertical-left">译文样式<el-icon class="icon-margin">
              <InfoFilled />
            </el-icon></span>
        </el-tooltip>
      </el-col>
      <el-col :span="12">
        <el-select v-model="config.style" aria-label="译文样式" placeholder="请选择译文显示样式">
          <el-option-group v-for="group in styleGroups" :key="group.value" :label="group.label">
            <el-option v-for="item in group.options" :key="item.value" :label="item.label" :value="item.value"
              :class="item.class" />
          </el-option-group>
        </el-select>
      </el-col>
    </el-row>

    <section v-show="config.display === 1" class="style-preview-card" aria-live="polite">
      <div class="style-preview-heading">
        <div><span>实时预览</span><strong>译文样式</strong></div>
      </div>
      <div class="style-preview-example">
        <p class="style-preview-source">Reading should feel calm and effortless.</p>
        <p :key="config.style" class="style-preview-text" :class="currentStyleClass">阅读应该轻松、自然，不打断你的节奏。</p>
      </div>
      <small class="style-preview-note">切换上方选项即可预览译文在网页中的显示效果。</small>
    </section>
  </div>
  </section>

  <div v-if="!config.on && props.activeSection !== 'settings-general'" class="disabled-section">
    <strong>插件当前已关闭</strong>
    <p>请先在“通用设置”中启用插件，再调整该分类。</p>
  </div>

  <div v-show="config.on" class="settings-main-sections">

    <!-- 翻译服务 -->
    <section v-show="props.activeSection === 'settings-services'" id="settings-services" class="settings-section">
      <ServiceCatalog
        :service="selectedConfigurationService"
        :default-service="config.service"
        :selected-model="config.model[selectedConfigurationService]"
        :services="configurationCompute.filteredServices"
        :model-options="configurationCompute.model"
        :show-model="configurationCompute.showModel"
        @update:service="setConfigurationService"
        @update:model="config.model[selectedConfigurationService] = $event"
      >
        <template #configuration>
          <ServiceConfiguration
            :config="config"
            :service="selectedConfigurationService"
            :compute="configurationCompute"
            :options="options"
            :is-valid-azure-endpoint="isValidAzureEndpoint"
          />
        </template>
      </ServiceCatalog>

    </section>



    <!-- 鼠标悬浮快捷键 -->
    <section v-show="props.activeSection === 'settings-shortcuts'" id="settings-shortcuts" class="settings-section">
    <el-row class="settings-control-row" :class="{ 'custom-hotkey-row': config.hotkey === 'custom' }">
      <el-col :span="14" class="settings-control-label lightblue rounded-corner">
        <el-tooltip class="box-item" effect="dark" content="按住指定快捷键并悬停在文本上进行翻译" placement="top-start" :show-after="500">
        <span class="popup-text popup-vertical-left">
          鼠标悬浮快捷键
          <el-icon class="icon-margin">
            <InfoFilled />
          </el-icon>
        </span>
        </el-tooltip>
      </el-col>
      <el-col :span="10" class="settings-control-field flex-end">
        <div class="hotkey-config">
          <el-select 
            v-model="config.hotkey" 
            aria-label="鼠标悬浮快捷键"
            placeholder="请选择快捷键" 
            size="small" 
            style="width: 100%"
            @change="handleMouseHotkeyChange"
          >
            <el-option v-for="item in options.keys" :key="item.value" :label="item.label" :value="item.value" :disabled="item.disabled" :class="{ 'select-divider': item.disabled }" />
          </el-select>
          
          <!-- 自定义快捷键显示（选择自定义时总是显示） -->
          <div v-if="config.hotkey === 'custom'" class="custom-hotkey-display">
            <span class="hotkey-text" v-if="config.customHotkey">
              {{ getCustomMouseHotkeyDisplayName() }}
            </span>
            <span class="hotkey-text placeholder-text" v-else>
              点击设置自定义快捷键
            </span>
            <el-button size="small" type="text" @click="openCustomMouseHotkeyDialog" class="edit-button">
              <el-icon><Edit /></el-icon>
            </el-button>
          </div>
        </div>
      </el-col>
    </el-row>

    <!-- 全文翻译快捷键选择 -->
    <el-row v-if="config.on" class="settings-control-row" :class="{ 'custom-hotkey-row': config.floatingBallHotkey === 'custom' }">
      <el-col :span="14" class="settings-control-label lightblue rounded-corner">
        <el-tooltip class="box-item" effect="dark" content="（测试版）设置快捷键以便快速切换全文翻译状态，无需鼠标点击悬浮球" placement="top-start" :show-after="500">
        <span class="popup-text popup-vertical-left">
          全文翻译快捷键
          <el-icon class="icon-margin">
            <InfoFilled />
          </el-icon>
        </span>
        </el-tooltip>
      </el-col>
      <el-col :span="10" class="settings-control-field flex-end">
        <div class="hotkey-config">
          <el-select 
            v-model="config.floatingBallHotkey" 
            aria-label="全文翻译快捷键"
            placeholder="选择快捷键" 
            size="small" 
            style="width: 100%"
            @change="handleHotkeyChange"
          >
            <el-option v-for="item in options.floatingBallHotkeys" :key="item.value" :label="item.label" :value="item.value" />
          </el-select>
          
          <!-- 自定义快捷键显示（选择自定义时总是显示） -->
          <div v-if="config.floatingBallHotkey === 'custom'" class="custom-hotkey-display">
            <span class="hotkey-text" v-if="config.customFloatingBallHotkey">
              {{ getCustomHotkeyDisplayName() }}
            </span>
            <span class="hotkey-text placeholder-text" v-else>
              点击设置自定义快捷键
            </span>
            <el-button size="small" type="text" @click="openCustomHotkeyDialog" class="edit-button">
              <el-icon><Edit /></el-icon>
            </el-button>
          </div>
        </div>
      </el-col>
    </el-row>


    <!-- 划词翻译模式选择 -->
    <el-row v-if="config.on" class="settings-control-row">
      <el-col :span="14" class="settings-control-label lightblue rounded-corner">
        <el-tooltip class="box-item" effect="dark" content="选中文本后显示翻译入口；不再依赖鼠标悬停，可选择直接弹出、显示图标或显示小点" placement="top-start" :show-after="500">
      <span class="popup-text popup-vertical-left">
        划词翻译
        <el-icon class="icon-margin">
          <InfoFilled />
        </el-icon>
      </span>
        </el-tooltip>
      </el-col>
      <el-col :span="10" class="settings-control-field flex-end">
        <el-select v-model="config.selectionTranslatorMode" aria-label="划词翻译模式" placeholder="选择模式" size="small" style="width: 100%">
          <el-option label="关闭" value="disabled" />
          <el-option label="双语显示" value="bilingual" />
          <el-option label="只显示译文" value="translation-only" />
        </el-select>
      </el-col>
    </el-row>
    <el-row v-if="config.on && config.selectionTranslatorMode !== 'disabled'" class="settings-control-row">
      <el-col :span="14" class="settings-control-label lightblue rounded-corner">
        <span class="popup-text popup-vertical-left">划词触发方式</span>
      </el-col>
      <el-col :span="10" class="settings-control-field flex-end">
        <el-select v-model="config.selectionTranslatorTrigger" aria-label="划词翻译触发方式" placeholder="选择触发方式" size="small" style="width: 100%">
          <el-option label="直接弹出" value="direct" />
          <el-option label="显示图标" value="icon" />
          <el-option label="显示小点" value="dot" />
        </el-select>
      </el-col>
    </el-row>
    </section>

    <!-- token -->
    <!-- 高级选项-->
    <section v-show="props.activeSection === 'settings-advanced'" id="settings-advanced" class="settings-section">

        <!-- 主题设置 -->
        <el-row class="settings-control-row">
          <el-col :span="12" class="settings-control-label lightblue rounded-corner">
            <span class="popup-text popup-vertical-left">主题设置</span>
          </el-col>
          <el-col :span="12" class="settings-control-field">
            <el-select v-model="config.theme" placeholder="请选择主题模式">
              <el-option class="select-left" v-for="item in options.theme" :key="item.value" :label="item.label"
                         :value="item.value" />
            </el-select>
          </el-col>
        </el-row>

        <!-- 缓存开关 -->
        <el-row class="settings-control-row">
          <el-col :span="20" class="settings-control-label lightblue rounded-corner">
            <el-tooltip class="box-item" effect="dark" content="开启缓存可以提高翻译速度，减少重复请求，但可能导致翻译结果不是最新的" placement="top-start" :show-after="500">
        <span class="popup-text popup-vertical-left">缓存翻译结果<el-icon class="icon-margin">
            <InfoFilled />
          </el-icon></span>
            </el-tooltip>
          </el-col>

          <el-col :span="4" class="settings-control-field flex-end">
            <el-switch v-model="config.useCache" class="settings-toggle" aria-label="缓存翻译结果" />
          </el-col>
        </el-row>

        <!-- AI 智能上下文 -->
        <el-row class="settings-control-row">
          <el-col :span="20" class="settings-control-label ai-context-label lightblue rounded-corner">
            <el-tooltip class="box-item" effect="dark"
                        content="开启后，AI 翻译会参考当前网页的标题、描述和相关正文片段；仅对大模型翻译服务生效。"
                        placement="top-start" :show-after="500">
              <span class="popup-text popup-vertical-left">AI 智能上下文<el-icon class="icon-margin">
                  <InfoFilled />
                </el-icon></span>
            </el-tooltip>
            <small class="settings-control-hint">提升术语和歧义表达的语境准确度；首次请求还会额外生成摘要并增加一次调用。</small>
          </el-col>

          <el-col :span="4" class="settings-control-field flex-end">
            <el-switch v-model="config.enableAIContext" :disabled="!canUseAIContext" class="settings-toggle" aria-label="AI 智能上下文" />
          </el-col>
        </el-row>

        <!-- 悬浮球开关 -->
      <el-row v-if="config.on" class="settings-control-row">
        <el-col :span="20" class="settings-control-label lightblue rounded-corner">
          <el-tooltip class="box-item" effect="dark" content="（测试版）控制是否显示屏幕边缘的即时翻译悬浮球，用于对整个网页进行翻译" placement="top-start" :show-after="500">
          <span class="popup-text popup-vertical-left">
            全文翻译悬浮球
            <el-icon class="icon-margin">
              <InfoFilled />
            </el-icon>
          </span>
          </el-tooltip>
        </el-col>

        <el-col :span="4" class="settings-control-field flex-end">
          <el-switch v-model="floatingBallEnabled" class="settings-toggle" aria-label="全文翻译悬浮球" />
        </el-col>
      </el-row>


        <!-- 禁用动画设置 -->
        <el-row class="settings-control-row">
          <el-col :span="20" class="settings-control-label lightblue rounded-corner">
            <el-tooltip class="box-item" effect="dark"
                        content="动画效果（默认开）：禁用后将关闭加载/悬浮等动画，以节省GPU资源和电量。适合低配置设备或希望节省资源的用户。"
                        placement="top-start" :show-after="500">
              <span class="popup-text popup-vertical-left">动画效果<el-icon class="icon-margin">
                  <InfoFilled />
                </el-icon></span>
            </el-tooltip>
          </el-col>
          <el-col :span="4" class="settings-control-field flex-end">
            <el-switch v-model="config.animations" class="settings-toggle" aria-label="动画效果" />
          </el-col>
        </el-row>

        <!-- 输入框翻译功能 -->
        <el-row class="settings-control-row">
          <el-col :span="12" class="settings-control-label lightblue rounded-corner">
            <el-tooltip class="box-item" effect="dark"
                        content="输入框翻译：在任何文本输入框中使用指定方式触发翻译当前输入的内容。"
                        placement="top-start" :show-after="500">
              <span class="popup-text popup-vertical-left">输入框翻译<el-icon class="icon-margin">
                  <InfoFilled />
                </el-icon></span>
            </el-tooltip>
          </el-col>
          <el-col :span="12" class="settings-control-field">
            <el-select v-model="config.inputBoxTranslationTrigger" placeholder="请选择触发方式">
              <el-option class="select-left" v-for="item in options.inputBoxTranslationTrigger" :key="item.value" 
                         :label="item.label" :value="item.value" />
            </el-select>
          </el-col>
        </el-row>

        <!-- 输入框翻译目标语言 -->
        <el-row v-if="config.inputBoxTranslationTrigger !== 'disabled'" class="settings-control-row">
          <el-col :span="12" class="settings-control-label lightblue rounded-corner">
            <span class="popup-text popup-vertical-left">翻译目标语言</span>
          </el-col>
          <el-col :span="12" class="settings-control-field">
            <el-select v-model="config.inputBoxTranslationTarget" placeholder="请选择目标语言">
              <el-option class="select-left" v-for="item in options.inputBoxTranslationTarget" :key="item.value" 
                         :label="item.label" :value="item.value" />
            </el-select>
          </el-col>
        </el-row>

        <!-- 翻译并发数 -->
        <el-row class="settings-control-row">
          <el-col :span="12" class="settings-control-label lightblue rounded-corner">
            <el-tooltip class="box-item" effect="dark" content="控制同时进行的最大翻译任务数，数值越高翻译速度越快，但可能占用更多系统资源" placement="top-start"
                        :show-after="500">
          <span class="popup-text popup-vertical-left">翻译并发数<el-icon class="icon-margin">
              <InfoFilled />
            </el-icon></span>
            </el-tooltip>
          </el-col>
          <el-col :span="12" class="settings-control-field">
            <el-input-number
                v-model="config.maxConcurrentTranslations"
                :min="1"
                :max="100"
                :step="1"
                style="width: 100%"
                @change="handleConcurrentChange"
                controls-position="right"
            />
          </el-col>
        </el-row>

        <!-- 使用代理转发 -->
        <el-row v-show="compute.showProxy" class="settings-control-row">
          <el-col :span="8" class="settings-control-label lightblue rounded-corner">
            <el-tooltip class="box-item" effect="dark" content="使用代理可以解决网络无法访问的问题，如不熟悉代理设置请留空！" placement="top-start"
                        :show-after="500">
              <span class="popup-text popup-vertical-left">代理地址<el-icon class="icon-margin">
                  <InfoFilled />
                </el-icon></span>
            </el-tooltip>
          </el-col>
          <el-col :span="16" class="settings-control-field">
            <el-input v-model="config.proxy[config.service]" placeholder="默认不使用代理" />
          </el-col>
        </el-row>

        <!-- 角色和模板 -->
        <el-row v-show="compute.showAI" class="settings-control-row">
          <el-col :span="8" class="settings-control-label lightblue rounded-corner">
            <el-tooltip class="box-item" effect="dark" content="以系统身份 system 发送的对话，常用于指定 AI 要扮演的角色"
              placement="top-start" :show-after="500">
              <span class="popup-text popup-vertical-left">system<el-icon class="icon-margin">
                  <InfoFilled />
                </el-icon></span>
            </el-tooltip>
          </el-col>
          <el-col :span="16" class="settings-control-field">
            <el-input type="textarea" v-model="config.system_role[config.service]" maxlength="8192"
              placeholder="system message " />
          </el-col>
        </el-row>
        <el-row v-show="compute.showAI" class="settings-control-row">
          <el-col :span="8" class="settings-control-label lightblue rounded-corner">
            <el-tooltip class="box-item" effect="dark"
              content="以用户身份 user 发送的对话，其中{{to}}表示目标语言，{{origin}}表示待翻译的文本内容，两者不可缺少。"
              placement="top-start" :show-after="500">
              <span class="popup-text popup-vertical-left">user<el-icon class="icon-margin">
                  <InfoFilled />
                </el-icon></span>
            </el-tooltip>
          </el-col>
          <el-col :span="16" class="settings-control-field">
            <el-input type="textarea" v-model="config.user_role[config.service]" maxlength="8192"
              placeholder="user message template" />
          </el-col>
        </el-row>
        <!-- 恢夏默认模板按钮 -->
        <el-row v-show="compute.showAI" class="margin-bottom margin-left-2em">
          <el-col :span="24" style="text-align: right;">
            <el-button type="primary" link @click="resetTemplate">
              <el-icon>
                <Refresh />
              </el-icon>
              恢复默认模板
            </el-button>
          </el-col>
        </el-row>

    </section>

    <section v-show="props.activeSection === 'settings-data'" id="settings-data" class="settings-section data-section">
        <!-- 配置导入导出 -->
        <el-row class="margin-bottom margin-left-2em">
          <el-col :span="24">
            <el-divider content-position="center">配置管理</el-divider>
          </el-col>
        </el-row>

        <section class="config-history-panel" aria-label="最近配置">
          <div class="config-history-heading">
            <div>
              <span class="config-history-kicker">配置版本</span>
              <h3>最近 5 次配置</h3>
              <p>修改会自动保存，保留最近的稳定快照，可随时恢复。</p>
            </div>
            <div class="config-history-actions">
              <el-button
                size="small"
                :disabled="historyBusy || !canUndo"
                aria-label="撤销配置恢复"
                @click="runHistoryAction('undo')"
              >撤销</el-button>
              <el-button
                size="small"
                :disabled="historyBusy || !canRedo"
                aria-label="重做配置恢复"
                @click="runHistoryAction('redo')"
              >重做</el-button>
            </div>
          </div>

          <div v-if="historyEntries.length" class="config-history-list">
            <article
              v-for="entry in historyEntries"
              :key="entry.version"
              class="config-history-entry"
              :class="{ current: entry.version === currentHistoryVersion }"
            >
              <div class="config-history-version"><b>v{{ entry.version }}</b><span v-if="entry.version === currentHistoryVersion">当前</span></div>
              <div class="config-history-detail">
                <strong>{{ historySummary(entry) }}</strong>
                <small>{{ formatHistoryTime(entry.savedAt) }}</small>
              </div>
              <el-button
                size="small"
                text
                type="primary"
                :disabled="historyBusy || entry.version === currentHistoryVersion"
                :aria-label="`恢复配置 v${entry.version}`"
                @click="runHistoryAction('restore', entry.version)"
              >恢复</el-button>
            </article>
          </div>
          <div v-else class="config-history-empty">还没有可恢复的配置版本。</div>
        </section>

        <el-row class="margin-bottom margin-left-2em">
          <el-col :span="12">
            <el-button type="primary" @click="handleExport">
              <el-icon>
                <Download />
              </el-icon>
              导出配置
            </el-button>
          </el-col>
          <el-col :span="12">
            <el-button type="success" @click="handleImport">
              <el-icon>
                <Upload />
              </el-icon>
              导入配置
            </el-button>
          </el-col>
        </el-row>

        <!-- 导出配置 -->
        <el-row v-if="showExportBox" class="margin-bottom margin-left-2em">
          <el-col :span="24">
            <el-input v-model="exportData" type="textarea" :rows="8" readonly />
          </el-col>
        </el-row>

        <!-- 导入配置 -->
        <el-row v-if="showImportBox" class="margin-bottom margin-left-2em">
          <el-col :span="24">
            <el-input v-model="importData" type="textarea" :rows="8" placeholder="请在此处粘贴您的JSON配置" />
            <div style="margin-top: 10px; text-align: right;">
              <el-button @click="saveImport">保存</el-button>
            </div>
          </el-col>
        </el-row>
    </section>
    <!--    -->
  </div>

  <!-- 自定义快捷键对话框 -->
  <CustomHotkeyInput
    v-model="showCustomHotkeyDialog"
    :current-value="config.customFloatingBallHotkey"
    @confirm="handleCustomHotkeyConfirm"
    @cancel="handleCustomHotkeyCancel"
  />

  <!-- 自定义鼠标悬浮快捷键对话框 -->
  <CustomHotkeyInput
    v-model="showCustomMouseHotkeyDialog"
    :current-value="config.customHotkey"
    @confirm="handleCustomMouseHotkeyConfirm"
    @cancel="handleCustomMouseHotkeyCancel"
  />



</template>

<script lang="ts" setup>

// Main 处理配置信息
import { computed, ref, watch, onUnmounted } from 'vue'
import { models, options, resolveConfiguredModel, servicesType, defaultOption } from "../entrypoints/utils/option";
import { Config, normalizeConfig } from "@/entrypoints/utils/model";
import { InfoFilled, Refresh, Edit, Upload, Download } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import browser from 'webextension-polyfill';
import { defineAsyncComponent } from 'vue';
const CustomHotkeyInput = defineAsyncComponent(() => import('@/components/CustomHotkeyInput.vue'));
import ServiceCatalog from '@/components/ServiceCatalog.vue';
import ServiceConfiguration from '@/components/ServiceConfiguration.vue';
import { parseHotkey } from '@/entrypoints/utils/hotkey';
import {
  isCustomBodyMapping,
  isValidCustomBody,
} from '@/entrypoints/utils/custom-body';
import {DEEPLX_ENDPOINT_PRESETS, parseDeepLXEndpoints} from '@/entrypoints/utils/deeplx';
import { isConfigImportValid, sanitizeConfigForExport } from '@/entrypoints/utils/config-transfer';
import {
  config as runtimeConfig,
  configHistoryReady,
  configReady,
  getConfigHistorySnapshot,
  requestConfigHistoryAction,
  saveConfig,
  requestConfigSave,
  subscribeConfigHistory,
  subscribeConfig,
  type ConfigHistoryAction,
  type ConfigHistoryEntry,
  type ConfigHistoryState,
} from '@/entrypoints/utils/config';

const props = withDefaults(defineProps<{
  activeSection?: string
}>(), {
  activeSection: 'settings-general',
})

// 初始化深色模式媒体查询
const darkModeMediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

// 更新主题函数
function updateTheme(theme: string) {
  if (theme === 'auto') {
    // 自动模式下，直接使用系统主题
    document.documentElement.classList.toggle('dark', darkModeMediaQuery.matches);
  } else {
    // 手动模式下，使用选择的主题
    document.documentElement.classList.toggle('dark', theme === 'dark');
  }
}

// 配置信息
const config = ref(new Config());
const selectedDeepLXPreset = ref('');
const persistConfig = (value: unknown) => requestConfigSave(value, browser.runtime.sendMessage.bind(browser.runtime));
let lastSerialized = '';

const appendDeepLXPreset = (endpoint: string | undefined) => {
  if (!endpoint) {
    return;
  }

  const endpoints = parseDeepLXEndpoints(config.value.deeplx);
  if (!endpoints.includes(endpoint)) {
    config.value.deeplx = [...endpoints, endpoint].join('\n');
  }
  selectedDeepLXPreset.value = '';
};

let hydrated = false;
let applyingExternalConfig = false;
const unsubscribeConfig = subscribeConfig((nextConfig) => {
  const serialized = JSON.stringify(nextConfig);
  if (serialized === lastSerialized) return;
  lastSerialized = serialized;
  applyingExternalConfig = true;
  try {
    Object.assign(config.value, nextConfig);
  } finally {
    applyingExternalConfig = false;
  }
});

void configReady
  .then(() => {
    Object.assign(config.value, runtimeConfig);
    lastSerialized = JSON.stringify(config.value);
    hydrated = true;
    updateTheme(config.value.theme || 'auto');
  })
  .catch((error) => console.warn('[FluentRead] 无法读取本地配置', error));

watch(config, (newValue) => {
  if (!hydrated || applyingExternalConfig) return;
  const serialized = JSON.stringify(newValue);
  if (serialized === lastSerialized) return;
  lastSerialized = serialized;
  void persistConfig(newValue).catch((error) => console.warn('[FluentRead] 保存设置失败', error));
}, { deep: true, flush: 'sync' });

// 设置页关闭前提交最新快照，避免 Firefox 销毁页面时丢失最后一次修改。
onUnmounted(() => {
  if (hydrated) {
    void saveConfig(config.value).catch((error) => console.warn('[FluentRead] 设置页关闭前本地保存失败', error));
    void persistConfig(config.value).catch((error) => console.warn('[FluentRead] 设置页关闭前后台保存失败', error));
  }
  window.removeEventListener('pagehide', saveOnPageHide);
});

function saveOnPageHide() {
  if (hydrated) {
    void saveConfig(config.value).catch((error) => console.warn('[FluentRead] 设置页 pagehide 本地保存失败', error));
    void persistConfig(config.value).catch((error) => console.warn('[FluentRead] 设置页 pagehide 后台保存失败', error));
  }
}
window.addEventListener('pagehide', saveOnPageHide);

// 设置页左侧列表只切换正在编辑的服务，不改变网页翻译实际使用的默认服务。
const configurationService = ref<string | null>(null);
const selectedConfigurationService = computed(
  () => configurationService.value ?? config.value.service,
);

const setConfigurationService = (value: string) => {
  configurationService.value = value;
};

type ServiceSource = { value: string };

const actualService = computed(() => config.value.service);
const aiContextModel = computed(() => resolveConfiguredModel(
  config.value.model[config.value.service],
  config.value.customModel[config.value.service],
));
const canUseAIContext = computed(() => servicesType.isUseAIContext(config.value.service, aiContextModel.value));
const filteredServices = computed(() =>
  options.services.filter((item: any) =>
    !([item.google].includes(item.value) && config.value.display !== 1),
  ),
);

// 两个页面都需要相同的服务能力判断，但数据源不同：实际翻译使用默认服务，
// 设置页右侧表单使用正在配置的服务。统一从这里生成，避免两套逻辑继续漂移。
const createServiceCompute = (serviceSource: ServiceSource) => ({
  showAI: computed(() => servicesType.isAI(serviceSource.value)),
  showMachine: computed(() => servicesType.isMachine(serviceSource.value)),
  showProxy: computed(() => servicesType.isUseProxy(serviceSource.value)),
  showModel: computed(() => servicesType.isUseModel(serviceSource.value)),
  showCustomBody: computed(() => servicesType.isUseCustomBody(serviceSource.value)),
  showToken: computed(() => servicesType.isUseToken(serviceSource.value)),
  showAkSk: computed(() => servicesType.isUseAkSk(serviceSource.value)),
  showYoudao: computed(() => servicesType.isYoudao(serviceSource.value)),
  showTencent: computed(() => servicesType.isTencent(serviceSource.value)),
  model: computed(() => models.get(serviceSource.value) || []),
  showCustom: computed(() => servicesType.isCustom(serviceSource.value)),
  showDeepLX: computed(() => serviceSource.value === 'deeplx'),
  showCustomModel: computed(
    () =>
      servicesType.isAI(serviceSource.value) &&
      config.value.model[serviceSource.value] === '自定义模型',
  ),
  filteredServices,
  showRobotId: computed(() => servicesType.isCoze(serviceSource.value)),
  showNewAPI: computed(() => servicesType.isNewApi(serviceSource.value)),
  showAzureOpenaiEndpoint: computed(() => servicesType.isAzureOpenai(serviceSource.value)),
  showDeepseekApiType: computed(() => serviceSource.value === 'deepseek'),
  showDeepseekThinkingMode: computed(
    () => serviceSource.value === 'deepseek' && config.value.deepseekApiType !== 'responses',
  ),
});

const compute = ref(createServiceCompute(actualService));
// config.service 仍表示实际默认翻译服务；这里仅用于设置页正在编辑的服务。
const configurationCompute = ref(createServiceCompute(selectedConfigurationService));

// 监听主题变化
watch(() => config.value.theme, (newTheme) => {
  updateTheme(newTheme || 'auto');
});

// 使用 onchange 监听系统主题变化
darkModeMediaQuery.onchange = (e) => {
  if (config.value.theme === 'auto') {
    updateTheme('auto');
  }
};

// 组件卸载时清理
onUnmounted(() => {
  darkModeMediaQuery.onchange = null;
  unsubscribeConfig();
  unsubscribeHistory();
});

// 计算样式分组
const styleGroups = computed(() => {
  const groups = options.styles.filter(item => item.disabled);
  return groups.map(group => ({
    ...group,
    options: options.styles.filter(item => !item.disabled && item.group === group.value)
  }));
});

const currentStyleClass = computed(() =>
  options.styles.find(item => item.value === config.value.style && !item.disabled)?.class || 'fluent-display-default'
);

// 恢复默认模板
const resetTemplate = () => {
  ElMessageBox.confirm(
    '确定要恢复默认的 system 和 user 模板吗？此操作将覆盖当前的自定义模板。',
    '恢复默认模板',
    {
      confirmButtonText: '确定',
      cancelButtonText: '取消',
      type: 'warning',
    }
  ).then(() => {
    config.value.system_role[config.value.service] = defaultOption.system_role;
    config.value.user_role[config.value.service] = defaultOption.user_role;
    ElMessage({
      message: '已成功恢复默认翻译模板',
      type: 'success',
      duration: 2000
    });
  }).catch(() => {
    // 用户取消操作，不做任何处理
  });
};

// 悬浮球开关的计算属性
const floatingBallEnabled = computed({
  get: () => !config.value.disableFloatingBall && config.value.on,
  set: (value) => {
    config.value.disableFloatingBall = !value;
    // 向所有激活的标签页发送消息
    browser.tabs.query({}).then(tabs => {
      tabs.forEach(tab => {
        if (tab.id) {
          browser.tabs.sendMessage(tab.id, { 
            type: 'toggleFloatingBall',
            isEnabled: value 
          }).catch(() => {
            // 忽略发送失败的错误（可能是页面未加载内容脚本）
          });
        }
      });
    });
  }
});

// 监听划词翻译模式变化
watch(() => config.value.selectionTranslatorMode, (newMode) => {
  config.value.disableSelectionTranslator = newMode === 'disabled';
  // 向所有激活的标签页发送消息
  browser.tabs.query({}).then(tabs => {
    tabs.forEach(tab => {
      if (tab.id) {
        browser.tabs.sendMessage(tab.id, { 
          type: 'updateSelectionTranslatorMode',
          mode: newMode 
        }).catch(() => {
          // 忽略发送失败的错误（可能是页面未加载内容脚本）
        });
      }
    });
  });
});

// 处理插件状态变化
const handlePluginStateChange = (val: boolean) => {
  // 总开关只控制当前运行状态，不覆盖用户对悬浮球和划词翻译的偏好。
  browser.tabs.query({}).then(tabs => {
    tabs.forEach(tab => {
      if (!tab.id) return;
      browser.tabs.sendMessage(tab.id, {
        type: 'toggleFloatingBall',
        isEnabled: val && !config.value.disableFloatingBall,
      }).catch(() => {
        // 忽略发送失败的错误（可能是页面未加载内容脚本）
      });
      browser.tabs.sendMessage(tab.id, {
        type: 'updateSelectionTranslatorMode',
        mode: val ? config.value.selectionTranslatorMode : 'disabled',
      }).catch(() => {
        // 忽略发送失败的错误（可能是页面未加载内容脚本）
      });
    });
  });
};

// 处理悬浮球开关变化
const toggleFloatingBall = (val: boolean) => {
  // 向所有激活的标签页发送消息
  browser.tabs.query({}).then(tabs => {
    tabs.forEach(tab => {
      if (tab.id) {
        browser.tabs.sendMessage(tab.id, { 
          type: 'toggleFloatingBall',
          isEnabled: val 
        }).catch(() => {
          // 忽略发送失败的错误（可能是页面未加载内容脚本）
        });
      }
    });
  });
};

// 自定义快捷键相关
const showCustomHotkeyDialog = ref(false);
const showCustomMouseHotkeyDialog = ref(false);

// 处理快捷键选择变化
const handleHotkeyChange = (value: string) => {
  if (value === 'custom') {
    // 选择自定义后，如果没有设置过自定义快捷键，自动打开设置对话框
    if (!config.value.customFloatingBallHotkey) {
      // 延迟一下，让选择框先完成状态更新
      setTimeout(() => {
        openCustomHotkeyDialog();
      }, 100);
    }
  }
};

// 打开自定义快捷键对话框
const openCustomHotkeyDialog = () => {
  showCustomHotkeyDialog.value = true;
};

// 确认自定义快捷键
const handleCustomHotkeyConfirm = (hotkey: string) => {
  config.value.customFloatingBallHotkey = hotkey;
  config.value.floatingBallHotkey = 'custom';
  
  ElMessage({
    message: hotkey === 'none' ? '已禁用快捷键' : `快捷键已设置为: ${getCustomHotkeyDisplayName()}`,
    type: 'success',
    duration: 2000
  });
};

// 取消自定义快捷键
const handleCustomHotkeyCancel = () => {
  // 如果没有自定义快捷键，回退到默认选项
  if (!config.value.customFloatingBallHotkey) {
    config.value.floatingBallHotkey = 'Alt+T';
  }
};

// 获取自定义快捷键显示名称
const getCustomHotkeyDisplayName = () => {
  if (!config.value.customFloatingBallHotkey) return '';
  
  if (config.value.customFloatingBallHotkey === 'none') {
    return '已禁用';
  }
  
  const parsed = parseHotkey(config.value.customFloatingBallHotkey);
  return parsed.isValid ? parsed.displayName : config.value.customFloatingBallHotkey;
};

// 处理鼠标悬浮快捷键选择变化
const handleMouseHotkeyChange = (value: string) => {
  if (value === 'custom') {
    // 选择自定义后，如果没有设置过自定义快捷键，自动打开设置对话框
    if (!config.value.customHotkey) {
      // 延迟一下，让选择框先完成状态更新
      setTimeout(() => {
        openCustomMouseHotkeyDialog();
      }, 100);
    }
  }
};

// 打开自定义鼠标悬浮快捷键对话框
const openCustomMouseHotkeyDialog = () => {
  showCustomMouseHotkeyDialog.value = true;
};

// 确认自定义鼠标悬浮快捷键
const handleCustomMouseHotkeyConfirm = (hotkey: string) => {
  config.value.customHotkey = hotkey;
  config.value.hotkey = 'custom';
  
  ElMessage({
    message: hotkey === 'none' ? '已禁用快捷键' : `快捷键已设置为: ${getCustomMouseHotkeyDisplayName()}`,
    type: 'success',
    duration: 2000
  });
};

// 取消自定义鼠标悬浮快捷键
const handleCustomMouseHotkeyCancel = () => {
  // 如果没有自定义快捷键，回退到默认选项
  if (!config.value.customHotkey) {
    config.value.hotkey = 'Control';
  }
};

// 获取自定义鼠标悬浮快捷键显示名称
const getCustomMouseHotkeyDisplayName = () => {
  if (!config.value.customHotkey) return '';
  
  if (config.value.customHotkey === 'none') {
    return '已禁用';
  }
  
  const parsed = parseHotkey(config.value.customHotkey);
  return parsed.isValid ? parsed.displayName : config.value.customHotkey;
};

// 处理并发数量变化
const handleConcurrentChange = (currentValue: number | undefined) => {
  // 验证并发数量的有效性
  if (currentValue === undefined || currentValue < 1 || currentValue > 100) {
    ElMessage({
      message: '并发数量必须在 1-100 之间',
      type: 'warning',
      duration: 2000
    });
    // 恢复默认值
    config.value.maxConcurrentTranslations = 6;
    return;
  }
  
  ElMessage({
    message: `并发数量已更新为 ${currentValue}`,
    type: 'success',
    duration: 2000
  });
};

const showExportBox = ref(false);
const exportData = ref('');
const showImportBox = ref(false);
const importData = ref('');
const configHistory = ref<ConfigHistoryState>(getConfigHistorySnapshot());
const historyBusy = ref(false);
const historyEntries = computed(() => [...configHistory.value.entries].reverse());
const currentHistoryVersion = computed(() => configHistory.value.entries[configHistory.value.cursor]?.version ?? null);
const canUndo = computed(() => configHistory.value.cursor > 0);
const canRedo = computed(() => configHistory.value.cursor >= 0 && configHistory.value.cursor < configHistory.value.entries.length - 1);

const formatHistoryTime = (savedAt: string): string => {
  const date = new Date(savedAt);
  if (Number.isNaN(date.getTime())) return '时间未知';
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
};

const historySummary = (entry: ConfigHistoryEntry): string => {
  const target = options.to.find((item: any) => item.value === entry.config.to)?.label || entry.config.to;
  const service = options.services.find((item: any) => item.value === entry.config.service)?.label || entry.config.service;
  return `${target} · ${service}`;
};

void configHistoryReady.then(() => {
  configHistory.value = getConfigHistorySnapshot();
});
const unsubscribeHistory = subscribeConfigHistory((nextHistory) => {
  configHistory.value = nextHistory;
});

const runHistoryAction = async (action: ConfigHistoryAction, version?: number) => {
  if (historyBusy.value) return;
  historyBusy.value = true;
  try {
    const nextHistory = await requestConfigHistoryAction(
      action,
      version,
      browser.runtime.sendMessage.bind(browser.runtime),
    );
    configHistory.value = nextHistory;
    ElMessage({
      message: action === 'restore' ? `已恢复配置 v${version}` : action === 'undo' ? '已撤销配置恢复' : '已重做配置恢复',
      type: 'success',
      duration: 1600,
    });
  } catch (error) {
    ElMessage({
      message: `配置历史操作失败：${error instanceof Error ? error.message : '请稍后重试'}`,
      type: 'error',
    });
  } finally {
    historyBusy.value = false;
  }
};

// Azure OpenAI 端点地址验证函数
const isValidAzureEndpoint = (endpoint: string) => {
  if (!endpoint || endpoint.trim() === '') {
    return false;
  }

  // 检查是否包含必要的组件
  const hasAzureDomain = endpoint.includes('openai.azure.com');
  const hasChatCompletions = endpoint.includes('/chat/completions');
  const hasHttps = endpoint.startsWith('https://');

  return hasHttps && hasAzureDomain && hasChatCompletions;
};

const handleExport = async () => {
  try {
    await configReady;
    exportData.value = JSON.stringify(
      sanitizeConfigForExport(runtimeConfig),
      null,
      2,
    );
    showExportBox.value = !showExportBox.value;
    showImportBox.value = false;
  } catch (error) {
    ElMessage({
      message: `导出配置失败：${error instanceof Error ? error.message : '配置格式错误'}`,
      type: 'error',
    });
  }
};

const handleImport = () => {
  showImportBox.value = !showImportBox.value;
  showExportBox.value = false;
};

const saveImport = async () => {
  try {
    const parsedConfig = JSON.parse(importData.value);
    if (!isConfigImportValid(parsedConfig)) {
      ElMessage({
        message: '配置无效或格式不正确, 请检查!',
        type: 'error',
      });
      return;
    }
    await persistConfig(normalizeConfig(parsedConfig));
    ElMessage({
      message: '配置导入成功!',
      type: 'success',
    });
    showImportBox.value = false;
    importData.value = '';
    // Optionally, reload the extension or relevant parts
  } catch (e) {
    ElMessage({
      message: '配置格式错误, 请检查!',
      type: 'error',
    });
  }
};

</script>

<style scoped>

.settings-section {
  min-width: 0;
}

.config-history-panel {
  margin: 0 0 18px;
  padding: 18px;
  border: 1px solid #f0d2dc;
  border-radius: 18px;
  background: linear-gradient(135deg, #fff8fa, #fff);
}
.config-history-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
.config-history-kicker { display: block; margin-bottom: 4px; color: var(--brand-strong); font-size: 10px; font-weight: 800; letter-spacing: .1em; }
.config-history-heading h3 { margin: 0 0 5px; color: var(--ink); font-size: 16px; }
.config-history-heading p { margin: 0; color: var(--muted); font-size: 11px; line-height: 1.55; }
.config-history-actions { display: flex; flex: 0 0 auto; gap: 6px; }
.config-history-list { display: grid; gap: 7px; margin-top: 15px; }
.config-history-entry { display: grid; grid-template-columns: 62px minmax(0, 1fr) auto; align-items: center; gap: 10px; min-height: 52px; padding: 8px 10px; border: 1px solid #eceef4; border-radius: 13px; background: rgba(255, 255, 255, .82); }
.config-history-entry.current { border-color: #efb4c4; background: #fff; box-shadow: 0 5px 16px rgba(239, 71, 118, .08); }
.config-history-version { display: flex; align-items: center; gap: 5px; }
.config-history-version b { color: var(--brand-strong); font-size: 12px; }
.config-history-version span { padding: 2px 5px; border-radius: 999px; color: var(--brand-strong); background: var(--brand-soft); font-size: 9px; font-weight: 750; }
.config-history-detail { display: flex; min-width: 0; flex-direction: column; gap: 3px; }
.config-history-detail strong { overflow: hidden; color: var(--ink); font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }
.config-history-detail small { color: var(--muted); font-size: 10px; }
.config-history-empty { margin-top: 14px; padding: 15px; border: 1px dashed #e3e6ee; border-radius: 12px; color: var(--muted); font-size: 11px; text-align: center; }

.settings-status-row {
  align-items: center;
  min-height: 92px !important;
  padding: 18px 20px !important;
  border: 1px solid #e4e8f0;
  border-radius: 18px;
  background: linear-gradient(135deg, #fff8fa, #fff);
}

.settings-status-copy {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.settings-status-kicker {
  color: #dc315f;
  font-size: 10px;
  font-weight: 800;
  letter-spacing: .08em;
}

.settings-status-copy strong { color: #172033; font-size: 16px; }
.settings-status-copy small { color: #737c8f; font-size: 11px; }
.ai-context-label { flex-direction: column; align-items: flex-start !important; gap: 4px; }
.ai-context-label small { color: #8b93a4; font-size: 10px; line-height: 1.45; }
.settings-status-control { align-items: center; gap: 13px; }
.settings-status-badge {
  display: inline-flex; align-items: center; gap: 6px; padding: 7px 10px; border: 1px solid #e1e5ed;
  border-radius: 999px; color: #7b8496; background: #f7f8fb; font-size: 10px; font-weight: 750;
}
.settings-status-badge i { width: 7px; height: 7px; border-radius: 50%; background: #aab2c0; }
.settings-status-badge.active { border-color: #bfead9; color: #18835d; background: #effbf6; }
.settings-status-badge.active i { background: #25aa78; box-shadow: 0 0 0 4px rgba(37, 170, 120, .12); }
.settings-switch { --el-switch-on-color: #ef4776; --el-switch-off-color: #cfd5df; }

.style-preview-card {
  margin: 6px 12px 24px;
  padding: 18px;
  border: 1px solid #e3e7ef;
  border-radius: 18px;
  background: linear-gradient(145deg, #fbfcff, #fff8fa);
}
.style-preview-heading { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.style-preview-heading div { display: flex; flex-direction: column; gap: 4px; }
.style-preview-heading span { color: #dc315f; font-size: 10px; font-weight: 800; letter-spacing: .08em; }
.style-preview-heading strong { color: #172033; font-size: 14px; }
.style-preview-example { margin-top: 14px; padding: 14px 16px; border: 1px solid #e5e8ef; border-radius: 14px; background: #fff; }
.style-preview-source { margin: 0 0 8px; color: #7f889b; font-size: 11px; }
.style-preview-text { margin: 0; color: #172033; font-size: 15px; line-height: 1.7; transition: all 160ms ease; }
.style-preview-note { display: block; margin-top: 10px; color: #8b93a4; font-size: 10px; }
.style-preview-text.fluent-display-default { color: #273247; }
.style-preview-text.fluent-display-bold { font-weight: 800; }
.style-preview-text.fluent-display-italic { font-style: italic; }
.style-preview-text.fluent-display-text-shadow { text-shadow: 1px 2px 3px rgba(23, 32, 51, .22); }
.style-preview-text.fluent-display-solid-underline { text-decoration: underline; text-decoration-color: #4d8eea; text-decoration-thickness: 2px; text-underline-offset: 4px; }
.style-preview-text.fluent-display-dot-underline { text-decoration: underline dotted #4d8eea 2px; text-underline-offset: 4px; }
.style-preview-text.fluent-display-wavy { text-decoration: underline wavy #ef4776 2px; text-underline-offset: 4px; }
.style-preview-text.fluent-display-card-mode { padding: 8px 10px; border-radius: 8px; background: #f4f6fb; }
.style-preview-text.fluent-display-modern-card { padding: 8px 10px; border-radius: 8px; background: linear-gradient(90deg, #fff0f4, #f1f4ff); }
.style-preview-text.fluent-display-paper { padding: 8px 10px; border: 1px solid #eadfca; background: #fffaf0; }
.style-preview-text.fluent-display-learning-mode { padding: 2px 6px; background: #fff1a8; }
.style-preview-text.fluent-display-marker { padding: 2px 6px; background: #d6f5b7; }
.style-preview-text.fluent-display-highlight-fade { padding: 2px 6px; background: linear-gradient(90deg, #fff0b8, transparent); }
.style-preview-text.fluent-display-lightyellow { padding: 4px 8px; background: #fff7db; }
.style-preview-text.fluent-display-lightblue { padding: 4px 8px; background: #eaf4ff; }
.style-preview-text.fluent-display-lightgray { padding: 4px 8px; background: #f1f3f5; }
.style-preview-text.fluent-display-quote { padding-left: 10px; border-left: 3px solid #ef4776; }
.style-preview-text.fluent-display-border { padding: 6px 9px; border: 1px solid #bfc8d8; border-radius: 6px; }
.style-preview-text.fluent-display-focus { padding: 5px 8px; border-radius: 6px; box-shadow: 0 0 0 3px rgba(239, 71, 118, .12); }
.style-preview-text.fluent-display-clean { border-bottom: 2px solid #ef4776; }
.style-preview-text.fluent-display-tech { padding: 5px 8px; border-radius: 5px; color: #245070; background: #edf6fb; font-family: ui-monospace, SFMono-Regular, monospace; }
.style-preview-text.fluent-display-elegant { font-family: Georgia, "Songti SC", serif; letter-spacing: .04em; }
.style-preview-text.fluent-display-dimmed { opacity: .62; }
.style-preview-text.fluent-display-transparent-mode { opacity: .82; }

.disabled-section {
  margin: 18px 12px 8px;
  padding: 28px;
  border: 1px dashed #d8dce6;
  border-radius: 16px;
  color: #677084;
  background: #f8f9fb;
  text-align: center;
}

.disabled-section strong {
  color: #263044;
  font-size: 15px;
}

.disabled-section p {
  margin: 7px 0 0;
  font-size: 11px;
}

.service-connection-section {
  margin-top: 22px;
  padding-top: 22px;
  border-top: 1px solid #e8eaf0;
}

.subsection-heading {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 18px;
  margin: 0 12px 16px;
}

.subsection-heading > div {
  display: flex;
  flex-direction: column;
}

.subsection-heading span {
  color: #dc315f;
  font-size: 10px;
  font-weight: 800;
  letter-spacing: .08em;
}

.subsection-heading strong {
  margin-top: 4px;
  color: #172033;
  font-size: 17px;
}

.subsection-heading p {
  margin: 0;
  color: #7c8495;
  font-size: 10px;
}

.data-section {
  min-height: 260px;
}

.select-left {
  text-align: left;
}

.flex-end {
  display: flex;
  justify-content: flex-end;
}

.select-divider {
  background: #f2f6fc;
  color: #409eff;
  font-size: 12px;
  padding: 4px 12px;
  cursor: default;
  font-weight: 500;
  letter-spacing: 1px;
  text-transform: uppercase;
  border-bottom: 1px solid #e4e7ed;
  margin: 4px 0;
  pointer-events: none;
  opacity: 0.9;
}

.icon-margin {
  margin-left: 0.25em;
}

/* 添加自适应样式 */
:deep(.el-select) {
  width: 100%;
}

:deep(.el-input) {
  width: 100%;
}

.margin-bottom {
  margin-bottom: 10px;
}

.margin-left-2em {
  margin-left: 1em;
  margin-right: 1em;
}

/* 设置滚动条样式 */
::-webkit-scrollbar {
  width: 6px;
  height: 6px;
}

::-webkit-scrollbar-thumb {
  background: #ddd;
  border-radius: 3px;
}

::-webkit-scrollbar-track {
  background: #f5f5f5;
  border-radius: 3px;
}

/* 自定义快捷键相关样式 */
.hotkey-config {
  display: flex;
  flex-direction: column;
  gap: 6px;
  width: 100%;
}

.custom-hotkey-display {
  display: flex;
  align-items: center;
  padding: 6px 6px 6px 10px;
  background: var(--el-color-primary-light-9);
  border: 1px solid var(--el-color-primary-light-7);
  border-radius: 4px;
  font-size: 12px;
  height: 32px;
  width: 100%;
  box-sizing: border-box;
  overflow: hidden;
}

.hotkey-text {
  font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
  font-weight: 600;
  color: var(--el-color-primary);
  font-size: 13px;
  flex: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
  max-width: calc(100% - 32px);
}

.edit-button {
  padding: 2px 4px;
  margin-left: 4px;
  color: var(--el-color-primary);
  width: 24px;
  height: 24px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}

.edit-button:hover {
  background: var(--el-color-primary-light-8);
}

.edit-button .el-icon {
  font-size: 12px;
}

.placeholder-text {
  color: var(--el-text-color-placeholder) !important;
  font-style: italic;
  font-family: inherit !important;
  font-weight: normal !important;
}

/* 自定义快捷键行样式 */
.custom-hotkey-row {
  border-color: #f2c2d0;
  background: var(--brand-soft);
}

.custom-hotkey-row:hover {
  border-color: #ef9ab1;
  background: #fff;
  transform: none;
  box-shadow: 0 8px 22px rgba(239, 71, 118, .08);
}

.custom-hotkey-row::before,
.custom-hotkey-row::after { display: none; }

/* 自定义标识徽章 */
.custom-badge {
  display: inline-flex;
  align-items: center;
  padding: 2px 6px;
  background: var(--el-color-primary);
  color: white;
  font-size: 10px;
  border-radius: 10px;
  font-weight: 500;
  margin-left: 6px;
  line-height: 1;
}

/* 错误样式 */
.input-error {
  border-color: var(--el-color-danger) !important;
}

.input-error:focus {
  border-color: var(--el-color-danger) !important;
  box-shadow: 0 0 0 2px rgba(245, 108, 108, 0.2) !important;
}

.error-text {
  color: var(--el-color-danger);
  font-size: 12px;
  margin-top: 4px;
  line-height: 1.4;
}

.deeplx-hint {
  color: var(--fr-secondary-text-color, #909399);
  font-size: 12px;
  line-height: 1.4;
  margin-top: 4px;
}

.deeplx-presets {
  margin-top: 6px;
  width: 100%;
}

.free-translation-order {
  display: flex;
  align-items: center;
  color: var(--el-color-primary);
  font-weight: 600;
}

@media (max-width: 480px) {
  .config-history-heading { align-items: stretch; flex-direction: column; }
  .config-history-actions { justify-content: flex-start; }
  .config-history-entry { grid-template-columns: 54px minmax(0, 1fr) auto; gap: 7px; padding-right: 7px; padding-left: 8px; }
}
</style>
