import {describe, expect, it} from 'vitest';
import {Config} from '@/src/core/config/model';
import {customModelString} from '@/src/core/config/catalog';
import {removeConfiguredModel} from '@/src/core/config/modelEditing';
import {createApiKeyRequirementKey, getLegacyApiKeyRequirementKey} from '@/src/core/config/validation';
import {withModelThinkingPreference} from '@/src/core/config/modelThinking';
import {withModelRequestLimit} from '@/src/core/config/requestLimits';

function preferences(config: Config, service: string, model: string) {
    config.requireApiKey[createApiKeyRequirementKey(service, model)] = true;
    config.requireApiKey[getLegacyApiKeyRequirementKey(service, model)] = true;
    config.modelThinking = withModelThinkingPreference(config.modelThinking, service, model, true);
    config.modelRequestLimits = withModelRequestLimit(config.modelRequestLimits, service, model, {enabled: true});
}

describe('shared model removal command', () => {
    it('removes provider models and their preferences while restoring both active selections', () => {
        const config = new Config(), service = 'custom:fixture';
        config.customOpenAIProviders = [{id: service, name: 'Fixture', endpoint: 'https://fixture.example/v1', models: ['removed', 'retained']}];
        config.model[service] = 'removed'; config.documentModel[service] = 'removed'; preferences(config, service, 'removed');
        removeConfiguredModel(config, service, 'removed', 'built-in');
        expect(config.customOpenAIProviders[0].models).toEqual(['retained']);
        expect(config.model[service]).toBe('retained'); expect(config.documentModel[service]).toBe('retained');
        expect(config.modelRequestLimits[service]).toBeUndefined();
        expect(config.requireApiKey[createApiKeyRequirementKey(service, 'removed')]).toBeUndefined();
        expect(config.requireApiKey[getLegacyApiKeyRequirementKey(service, 'removed')]).toBeUndefined();
        removeConfiguredModel(config, service, 'retained', 'built-in');
        expect(config.model[service]).toBeUndefined(); expect(config.documentModel[service]).toBeUndefined();
    });
    it('preserves other providers and independent selections', () => {
        const config = new Config(), service = 'custom:fixture';
        config.customOpenAIProviders = [{id: service, name: 'Fixture', endpoint: 'https://fixture.example/v1', models: ['removed', 'retained']},
            {id: 'custom:other', name: 'Other', endpoint: 'https://other.example/v1', models: ['other']}];
        config.model[service] = 'retained'; config.documentModel[service] = 'retained';
        removeConfiguredModel(config, service, 'removed', '');
        expect(config.model[service]).toBe('retained'); expect(config.customOpenAIProviders[1].models).toEqual(['other']);
    });
    it('selects remaining custom or built-in models and clears inactive custom aliases', () => {
        const config = new Config(), service = 'deepseek';
        config.customModels[service] = ['removed', 'retained'];
        config.model[service] = customModelString; config.customModel[service] = 'removed';
        config.documentModel[service] = customModelString; config.documentCustomModel[service] = 'removed'; preferences(config, service, 'removed');
        removeConfiguredModel(config, service, 'removed', 'deepseek-chat');
        expect(config.customModels[service]).toEqual(['retained']); expect(config.customModel[service]).toBe('retained'); expect(config.documentCustomModel[service]).toBe('retained');
        removeConfiguredModel(config, service, 'retained', 'deepseek-chat');
        expect(config.customModels[service]).toBeUndefined(); expect(config.model[service]).toBe('deepseek-chat'); expect(config.documentModel[service]).toBe('deepseek-chat');
        config.customModel[service] = 'unused'; config.documentCustomModel[service] = 'unused';
        removeConfiguredModel(config, service, 'unused', 'deepseek-chat'); expect(config.customModel[service]).toBeUndefined(); expect(config.documentCustomModel[service]).toBeUndefined();
        removeConfiguredModel(config, service, 'absent', 'deepseek-chat'); expect(config.model[service]).toBe('deepseek-chat');
    });
});
