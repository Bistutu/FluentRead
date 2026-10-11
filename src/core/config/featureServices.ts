/**
 * @file src/core/config/featureServices.ts
 * 文件职责：定义功能与翻译服务的对应关系，供设置中心统一展示与修改现有配置字段。
 * 主要内容：区分继承默认、独立翻译服务与仅支持 AI 的功能，单独允许阅读使用B站免费讲解而不开放写作，集中解析当前服务和有效模型，并在切换输入框或 AI 服务时清空旧功能模型。
 * 模块边界：只操作调用方传入的配置草稿，不保存数据、不调用供应商、不维护第二份功能状态；各运行时继续读取原有配置字段。
 */
import type {Config} from './model';
import {resolveConfiguredModel} from './catalog';
import {isHarnessService, isReadingService, resolveHarnessModel} from './harness';
import type {CustomOpenAIProvider} from './customOpenAI';

export const featureServiceDefinitions = [
    {id: 'hover', field: 'hoverTranslationService', inherit: true, aiOnly: false},
    {id: 'selection', field: 'selectionTranslationService', inherit: true, aiOnly: false},
    {id: 'input', field: 'inputBoxTranslationService', inherit: true, aiOnly: false},
    {id: 'video', field: 'videoService', inherit: true, aiOnly: false},
    {id: 'document', field: 'documentService', inherit: true, aiOnly: false},
    {id: 'image', field: 'imageTranslationService', inherit: true, aiOnly: false},
    {id: 'area', field: 'areaTranslationService', inherit: true, aiOnly: false},
    {id: 'reading', field: 'harness', inherit: true, aiOnly: true},
    {id: 'writing', field: 'writing', inherit: true, aiOnly: true},
] as const;
export type FeatureServiceDefinition = typeof featureServiceDefinitions[number];

/** 阅读验证过的匿名模型不能被自动提升为写作能力。 */
export function isFeatureServiceSupported(feature: FeatureServiceDefinition, service: string, customProviders: readonly CustomOpenAIProvider[] = []): boolean {
    return !feature.aiOnly || (feature.id === 'reading' ? isReadingService(service, customProviders) : isHarnessService(service, customProviders));
}

export function getFeatureService(config: Config, feature: FeatureServiceDefinition): string {
    const value = config[feature.field];
    return typeof value === 'string' ? value : value.service;
}

export function setFeatureService(config: Config, feature: FeatureServiceDefinition, service: string): void {
    if (getFeatureService(config, feature) === service) return;
    if (feature.field === 'harness' || feature.field === 'writing') {
        config[feature.field].service = service;
        config[feature.field].model = '';
    } else {
        config[feature.field] = service;
        if (feature.field === 'inputBoxTranslationService') config.inputBoxTranslationModel = '';
    }
}

export function getFeatureModel(config: Config, feature: FeatureServiceDefinition): string {
    if (feature.id === 'reading') return resolveHarnessModel(config).model;
    const service = getFeatureService(config, feature) || config.service;
    if (feature.field === 'documentService' && getFeatureService(config, feature)) {
        return resolveConfiguredModel(config.documentModel[service], config.documentCustomModel[service]);
    }
    const model = feature.field === 'writing'
        ? config[feature.field].model
        : feature.field === 'inputBoxTranslationService' ? config.inputBoxTranslationModel : '';
    return model || resolveConfiguredModel(config.model[service], config.customModel[service]);
}
