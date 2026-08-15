import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";

const {mockConfig} = vi.hoisted(() => ({
    mockConfig: {
        from: "auto",
        to: "zh-Hans",
        service: "deeplx",
        deeplx: "",
        proxy: {} as Record<string, string>,
        token: {} as Record<string, string>,
    },
}));

vi.mock("@/entrypoints/utils/config", () => ({config: mockConfig}));

import deeplx, {
    getDeepLXRequestLanguages,
    normalizeDeepLXLanguage,
} from "@/entrypoints/service/deeplx";
import {DEFAULT_DEEPLX_ENDPOINT, getDeepLXEndpoints} from "@/entrypoints/utils/deeplx";

const fetchMock = vi.fn<typeof fetch>();

function mockResponse(body: unknown, overrides: Partial<Response> = {}): Response {
    return {
        ok: true,
        status: 200,
        statusText: "OK",
        text: vi.fn().mockResolvedValue(JSON.stringify(body)),
        ...overrides,
    } as unknown as Response;
}

beforeEach(() => {
    fetchMock.mockReset();
    mockConfig.from = "auto";
    mockConfig.to = "zh-Hans";
    mockConfig.deeplx = "";
    mockConfig.proxy = {};
    mockConfig.token = {};
    vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
});

describe("DeepLX endpoint configuration", () => {
    it("uses the verified public endpoint when no URL is configured", () => {
        expect(getDeepLXEndpoints("", "")).toEqual([DEFAULT_DEEPLX_ENDPOINT]);
    });

    it("parses comma- and newline-separated URLs and gives proxy URLs priority", () => {
        expect(getDeepLXEndpoints("https://one.example/translate,\nhttps://two.example/translate", ""))
            .toEqual(["https://one.example/translate", "https://two.example/translate"]);
        expect(getDeepLXEndpoints("https://configured.example/translate", "https://proxy.example/translate"))
            .toEqual(["https://proxy.example/translate"]);
    });
});

describe("DeepLX adapter", () => {
    it("sends the expected request and parses a successful response", async () => {
        fetchMock.mockResolvedValue(mockResponse({code: 200, data: "你好"}));

        await expect(deeplx({origin: "Hello"})).resolves.toBe("你好");

        expect(fetchMock).toHaveBeenCalledOnce();
        const [url, init] = fetchMock.mock.calls[0]!;
        expect(url).toBe(DEFAULT_DEEPLX_ENDPOINT);
        expect(init).toMatchObject({method: "POST"});
        expect(init?.headers).toEqual({"Content-Type": "application/json"});
        expect(JSON.parse(String(init?.body))).toEqual({
            text: "Hello",
            source_lang: "AUTO",
            target_lang: "ZH",
        });
    });

    it("falls back to the next configured URL after an HTTP failure", async () => {
        mockConfig.deeplx = "https://primary.example/translate,\nhttps://backup.example/translate";
        fetchMock
            .mockResolvedValueOnce(mockResponse({message: "busy"}, {
                ok: false,
                status: 503,
                statusText: "Service Unavailable",
                text: vi.fn().mockResolvedValue("busy"),
            }))
            .mockResolvedValueOnce(mockResponse({code: 200, data: "备用译文"}));

        await expect(deeplx({origin: "Hello"})).resolves.toBe("备用译文");
        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(fetchMock.mock.calls[1]?.[0]).toBe("https://backup.example/translate");
    });

    it("falls back after an invalid DeepLX response", async () => {
        mockConfig.deeplx = "https://invalid.example/translate,https://valid.example/translate";
        fetchMock
            .mockResolvedValueOnce(mockResponse({code: 200, data: ""}))
            .mockResolvedValueOnce(mockResponse({code: 200, data: "有效译文"}));

        await expect(deeplx({origin: "Hello"})).resolves.toBe("有效译文");
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("adds an optional bearer token without exposing it in the URL", async () => {
        mockConfig.token = {deeplx: "test-token"};
        fetchMock.mockResolvedValue(mockResponse({code: 200, data: "你好"}));

        await deeplx({origin: "Hello"});

        expect(fetchMock.mock.calls[0]?.[1]?.headers).toEqual({
            "Content-Type": "application/json",
            Authorization: "Bearer test-token",
        });
    });

    it("normalizes Chinese language variants", () => {
        expect(normalizeDeepLXLanguage("zh-Hans")).toBe("ZH");
        expect(normalizeDeepLXLanguage("zh-TW")).toBe("ZH-HANT");
        expect(getDeepLXRequestLanguages("auto", "zh-Hans")).toEqual({
            sourceLang: "AUTO",
            targetLang: "ZH",
        });
    });
});
