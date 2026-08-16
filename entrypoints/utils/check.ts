import { customModelString, services, servicesType } from "./option";
import { getMissingCredentialMessage } from "./configValidation";
import { sendErrorMessage } from "./tip";
import { config } from "@/entrypoints/utils/config";

// Check configuration before translation
export function checkConfig(): boolean {
    // 1. Check if the plugin is enabled
    if (!config.on) return false;

    // 2. Check if the service credentials are provided.
    const missingCredentialMessage = getMissingCredentialMessage(config.service, config);
    if (missingCredentialMessage) {
        sendErrorMessage(missingCredentialMessage);
        return false;
    }

    // 3. Check if a model is selected for AI services (except specific services like Coze)
    if (servicesType.isAI(config.service) && ![services.cozecn, services.cozecom].includes(config.service)) {
        const model = config.model[config.service];
        const customModel = config.customModel[config.service];
        if (!model || (model === customModelString && !customModel)) {
            sendErrorMessage("模型尚未配置，请前往设置页配置");
            return false;
        }
    }

    // Some translation services require "bilingual mode" to be enabled
    if (config.display === 0 && config.service === services.google) {
        sendErrorMessage("「谷歌翻译」仅支持双语模式，请切换翻译服务");
        return false;
    }

    return true;
}

// Check if the node needs to be translated
export function skipNode(node: Node): boolean {
    return !node || !node.textContent?.trim() || hasLoadingSpinner(node) || hasRetryTag(node);
}

// Check if the node or any of its children contains a loading spinner
export function hasLoadingSpinner(node: Node): boolean {
    if (node.nodeType === Node.TEXT_NODE) return false;

    // Type guard to check if the node is an Element
    if (node instanceof Element && node.classList.contains('fluent-read-loading')) return true;

    // Check children only if the node is an Element
    if (node instanceof Element) {
        return Array.from(node.children).some(child => hasLoadingSpinner(child));
    }

    return false;
}

// Check if the node or any of its children contains a retry tag
export function hasRetryTag(node: Node): boolean {
    if (node.nodeType === Node.TEXT_NODE) return false;

    // Type guard to check if the node is an Element
    if (node instanceof Element && node.classList.contains('fluent-read-failure')) return true;

    // Check children only if the node is an Element
    if (node instanceof Element) {
        return Array.from(node.children).some(child => hasRetryTag(child));
    }

    return false;
}

export function contentPostHandler(text: string) {
    // Never render model reasoning tags in translated page content.
    return text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
}
