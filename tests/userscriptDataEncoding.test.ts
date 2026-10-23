/** Static resource byte encoding preserves existing gzip payloads and rejects ambiguous new encodings. */
import {expect, it} from 'vitest';
import {gzipSync, gunzipSync} from 'node:zlib';
import {encodeUserscriptData} from '@/userscript/buildDataEncoding';
import {decodeUserscriptData, USERSCRIPT_DATA_ALPHABET} from '@/userscript/dataEncoding';

it('keeps every byte value and every padding width, including offset Uint8Array views', () => {
    const bytes = Uint8Array.from({length: 1028}, (_, index) => index & 0xff);
    for (let length = 0; length <= 1024; length += 1) {
        const input = bytes.subarray(3, 3 + length);
        const encoded = encodeUserscriptData(input);
        expect(encoded).toMatch(/^~85:[0-3]/u);
        expect(encoded).not.toMatch(/["'\\\s\u0080-\uffff]/u);
        expect(decodeUserscriptData(encoded)).toEqual(input);
    }
    expect(decodeUserscriptData(encodeUserscriptData(new Uint8Array(4).fill(255)))).toEqual(new Uint8Array(4).fill(255));
    expect(new Set(USERSCRIPT_DATA_ALPHABET).size).toBe(85);
});

it('restores gzip CSS, UTF-8 dictionary data and binary images without changing decoded bytes', () => {
    const fixtures = [Buffer.from('.example::before{content:"中文 日本語 😀";background:url("data:image/png;base64,AA==")}'),
        Buffer.from(JSON.stringify({中文: '语言', text: 'French é and escaped \\n', math: '∑x²', astral: '😀'})),
        Buffer.from(Array.from({length: 4096}, (_, index) => index * 73 & 255))];
    for (const input of fixtures) {
        const gzip = gzipSync(input, {level: 9});
        const restored = decodeUserscriptData(encodeUserscriptData(gzip));
        expect(Buffer.from(restored)).toEqual(gzip);
        expect(gunzipSync(restored)).toEqual(input);
    }
});

it('keeps the existing atob Base64 path including whitespace, omitted padding and invalid input', () => {
    expect(decodeUserscriptData('')).toEqual(new Uint8Array());
    expect(decodeUserscriptData(' \nAAH/\t')).toEqual(Uint8Array.of(0, 1, 255));
    expect(decodeUserscriptData('/w')).toEqual(Uint8Array.of(255));
    expect(() => decodeUserscriptData('not base64!')).toThrow();
    expect(() => decodeUserscriptData('~86:000000')).toThrow();
});

it.each(['~85:', '~85:x00000', '~85:-00000', '~85:400000', '~85:10000', '~85:1', '~85:3000000',
    '~85:00000"', '~85:00000\\', '~85:00000中', '~85:0~~~~~', '~85:100001'])('rejects malformed or noncanonical resource encoding %s', value => {
    expect(() => decodeUserscriptData(value)).toThrow(/Invalid userscript resource/u);
});
