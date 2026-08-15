import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";

const {mockConfig, microsoftMock, deeplxMock, googleMock} = vi.hoisted(() => ({
    mockConfig: {
        from: "auto",
        to: "zh-Hans",
    },
    microsoftMock: vi.fn(),
    deeplxMock: vi.fn(),
    googleMock: vi.fn(),
}));

vi.mock("@/entrypoints/utils/config", () => ({config: mockConfig}));
vi.mock("@/entrypoints/utils/option", () => ({
    services: {
        microsoft: "microsoft",
        deeplx: "deeplx",
        google: "google",
    },
}));
vi.mock("@/entrypoints/service/microsoft", () => ({translateMicrosoftTexts: microsoftMock}));
vi.mock("@/entrypoints/service/deeplx", () => ({translateDeepLXText: deeplxMock}));
vi.mock("@/entrypoints/service/google", () => ({translateGoogleText: googleMock}));

import freeTranslation, {
    FREE_TRANSLATION_ORDER,
    translateFreeText,
} from "@/entrypoints/service/free-translation";

beforeEach(() => {
    vi.clearAllMocks();
    mockConfig.from = "auto";
    mockConfig.to = "zh-Hans";
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe("免费翻译服务", () => {
    it("按微软、DeepLX、谷歌的顺序优先使用第一个可用服务", async () => {
        const calls: string[] = [];
        microsoftMock.mockImplementation(async () => {
            calls.push("microsoft");
            throw new Error("Microsoft unavailable");
        });
        deeplxMock.mockImplementation(async () => {
            calls.push("deeplx");
            throw new Error("DeepLX unavailable");
        });
        googleMock.mockImplementation(async () => {
            calls.push("google");
            return "谷歌译文";
        });

        await expect(translateFreeText("Hello")).resolves.toBe("谷歌译文");
        expect(calls).toEqual(["microsoft", "deeplx", "google"]);
        expect(microsoftMock).toHaveBeenCalledWith(["Hello"], "auto", "zh-Hans");
        expect(deeplxMock).toHaveBeenCalledWith("Hello", "deeplx");
        expect(googleMock).toHaveBeenCalledWith("Hello", "auto", "zh-Hans");
    });

    it("微软可用时不请求后续服务", async () => {
        microsoftMock.mockResolvedValue(["微软译文"]);

        await expect(freeTranslation({origin: "Hello"})).resolves.toBe("微软译文");
        expect(microsoftMock).toHaveBeenCalledOnce();
        expect(deeplxMock).not.toHaveBeenCalled();
        expect(googleMock).not.toHaveBeenCalled();
    });

    it("返回空译文时继续降级", async () => {
        microsoftMock.mockResolvedValue([""]);
        deeplxMock.mockResolvedValue("DeepLX 译文");

        await expect(translateFreeText("Hello")).resolves.toBe("DeepLX 译文");
        expect(microsoftMock).toHaveBeenCalledOnce();
        expect(deeplxMock).toHaveBeenCalledOnce();
        expect(googleMock).not.toHaveBeenCalled();
    });

    it("所有服务失败时汇总失败原因和固定顺序", async () => {
        microsoftMock.mockRejectedValue(new Error("HTTP 503"));
        deeplxMock.mockRejectedValue(new Error("连接失败"));
        googleMock.mockRejectedValue(new Error("HTTP 429"));

        await expect(translateFreeText("Hello")).rejects.toThrow(
            `免费翻译服务均不可用（${FREE_TRANSLATION_ORDER.join(" → ")}）：微软翻译: HTTP 503；DeepLX: 连接失败；谷歌翻译: HTTP 429`,
        );
    });

    it("支持批量消息，并为每条文本独立执行降级", async () => {
        microsoftMock.mockRejectedValue(new Error("unavailable"));
        deeplxMock.mockImplementation(async (text: string) => `${text} 的译文`);

        await expect(freeTranslation({origin: ["Hello", "World"]})).resolves.toEqual([
            "Hello 的译文",
            "World 的译文",
        ]);
        expect(deeplxMock).toHaveBeenCalledTimes(2);
    });
});
