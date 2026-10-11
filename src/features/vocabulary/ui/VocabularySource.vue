<!--
 * @file src/features/vocabulary/ui/VocabularySource.vue
 * 文件职责：在收藏列表、学习页和复习卡中统一展示真实来源及视频片段位置。
 * 主要内容：使用领域校验后的可靠地址打开来源，展示原始时间范围；没有可靠地址时保留标题与位置并提示恢复，明确说明网站失效或本地材料可按标题重新找到。
 * 模块边界：只渲染传入语境，不请求网络、不推测网站可用性或操控播放器，回出处链接由 vocabulary/source.ts 生成。
 -->
<template>
    <div v-if="source.href || source.unavailable" class="vocabulary-source">
        <a v-if="source.href" :href="source.href" target="_blank" rel="noopener noreferrer"><span v-if="context?.pageTitle" data-i18n-ignore>{{ context.pageTitle }}</span><span v-else>{{ context?.video ? '回到视频片段' : '查看收藏来源' }}</span><span v-if="source.timeLabel"> · {{ source.timeLabel }}</span> ↗</a>
        <template v-else><span v-if="context?.pageTitle" data-i18n-ignore>{{ context.pageTitle }}</span><span v-else>视频来源暂不可用</span><span v-if="source.timeLabel"> · {{ source.timeLabel }}</span></template>
        <p v-if="source.unavailable">没有可跳转的原始地址。可按材料标题找回视频，再定位到这个时间范围。</p>
        <p v-else-if="context?.video">若原视频已删除或无法访问，可按材料标题找回。<span v-if="context.video.platform === 'x'">片段定位需要启用 FluentRead 视频字幕。</span></p>
    </div>
</template>
<script setup lang="ts">
import {computed} from 'vue';
import type {VocabularyContext} from '../learningModel';
import {vocabularySourceLink} from '../source';
const props = defineProps<{context?: VocabularyContext}>();
const source = computed(() => vocabularySourceLink(props.context));
</script>
<style scoped>
.vocabulary-source {font-size:12px; line-height:1.7; overflow-wrap:anywhere; color:var(--muted);}
.vocabulary-source a {color:var(--brand);}
.vocabulary-source p {margin:4px 0 0; font-size:11px;}
</style>
