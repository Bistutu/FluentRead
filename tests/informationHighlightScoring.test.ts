import {describe, expect, it, vi} from 'vitest';
import {alignQwenByteTokens, floatLogits, scoreCausalChunk, scoredTokenSpans, surprisalBits} from '@/src/core/information-highlight/scoring';
import {createSurprisalResultCache, scoreLocalSurprisal, type CausalScoringEngine, type ScoringTensor} from '@/src/features/information-highlight/offscreen/scorer';

describe('input-token surprisal and original UTF-16 alignment', () => {
    it('computes full-vocabulary likelihood in log space including extremely unlikely input tokens', () => {
        expect(surprisalBits([0, 0, 0, 0], 0, 4, 2)).toBe(2);
        expect(surprisalBits([1000, 0], 0, 2, 1)).toBeCloseTo(1000 / Math.LN2);
        expect(surprisalBits([0, -1000], 0, 2, 0)).toBe(0);
        for (const [data, offset, vocabulary, target] of [[[], 0, 0, 0], [[0], -1, 1, 0], [[0], 0, 1, -1], [[0], 0, 1, 1], [[0], .5, 1, 0], [[0], 0, 1, .5], [[0], 0, 2, 0], [[NaN], 0, 1, 0]] as Array<[number[], number, number, number]>) {
            expect(() => surprisalBits(data, offset, vocabulary, target)).toThrow('BAD_LOGITS');
        }
    });
    it('scores the next chunk first token with the preceding chunk final row and excludes the final prediction', () => {
        const ids = [0, 1, 0, 1, 0];
        const first = scoreCausalChunk([0, 1, 2, 0], 2, ids, 0, 2);
        const second = scoreCausalChunk([0, 3, 4, 0], 2, ids, 2, 4);
        const final = scoreCausalChunk([9, 0], 2, ids, 4, 5);
        expect([...first, ...second, ...final]).toHaveLength(4);
        expect(first[1]).toBe(surprisalBits([2, 0], 0, 2, 0));
        expect(final).toEqual([]);
        for (const [start, end, data] of [[-1, 2, [0, 0, 0, 0]], [0, 0, []], [0, 6, []], [.5, 2, []], [0, 2.5, []], [0, 2, [0]]] as Array<[number, number, number[]]>) expect(() => scoreCausalChunk(data, 2, ids, start, end)).toThrow('BAD_LOGITS');
    });
    it('decodes float16 bit patterns rather than treating Uint16 values as logits', () => {
        const values = floatLogits('float16', new Uint16Array([0, 0x8000, 0x3c00, 0xc000, 1, 0x7c00, 0xfc00, 0x7c01]));
        expect(Array.from(values)).toEqual([0, -0, 1, -2, 2 ** -24, Infinity, -Infinity, NaN]);
        const native = [1.5]; expect(floatLogits('float16', native)).toBe(native);
        expect(floatLogits('float32', native)).toBe(native); expect(floatLogits('float64', native)).toBe(native);
        expect(() => floatLogits('int32', native)).toThrow('BAD_LOGITS');
    });
    it('maps real fixed Qwen pieces through NFC, split UTF8 bytes, ZWJ emoji, CRLF and added-token literals', () => {
        const text = 'e\u0301 👨‍👩‍👧‍👦\r\n  空格\t!';
        const pieces = ['Ã©','ĠðŁĳ','¨','âĢ','į','ðŁĳ©','âĢ','į','ðŁĳ§','âĢ','į','ðŁĳ¦','čĊ','Ġ','Ġç','©','º','æł¼','ĉ','!'];
        const offsets = alignQwenByteTokens(text, pieces);
        expect(offsets[0]).toEqual({start: 0, end: 2});
        expect(offsets[1]).toEqual({start: 2, end: 14});
        expect(offsets[2]).toEqual({start: 3, end: 14});
        expect(offsets.at(-1)).toEqual({start: text.length - 1, end: text.length});
        expect(alignQwenByteTokens('<|endoftext|>文本 <tool_call>', ['<|endoftext|>', 'æĸĩæľ¬', 'Ġ', '<tool_call>'], new Map([['<|endoftext|>', '<|endoftext|>'], ['<tool_call>', '<tool_call>']]))).toEqual([{start: 0, end: 13}, {start: 13, end: 15}, {start: 15, end: 16}, {start: 16, end: 27}]);
        expect(alignQwenByteTokens('', [])).toEqual([]);
        expect(() => alignQwenByteTokens('abc', ['ab'])).toThrow('ALIGNMENT');
        expect(() => alignQwenByteTokens('a', ['b'])).toThrow('ALIGNMENT');
        expect(() => alignQwenByteTokens('a', [''])).toThrow('ALIGNMENT');
        expect(() => alignQwenByteTokens('a', ['😀'])).toThrow('ALIGNMENT');
        const original = String.prototype.normalize;
        const normalize = vi.spyOn(String.prototype, 'normalize').mockImplementation(function (this: string) {return String(this).length > 1 ? 'wrong' : original.call(this, 'NFC');});
        expect(() => alignQwenByteTokens('ab', ['a','b'])).toThrow('ALIGNMENT'); normalize.mockRestore();
    });
    it('merges shared grapheme spans by adding their NLL contribution', () => {
        expect(scoredTokenSpans([{start: 0, end: 2}, {start: 1, end: 3}, {start: 3, end: 4}], [1, 2, 3])).toEqual([{start: 0, end: 3, score: 3}, {start: 3, end: 4, score: 3}]);
        expect(() => scoredTokenSpans([], [1])).toThrow('SCORE_COUNT');
        for (const span of [{start: -1, end: 1}, {start: .5, end: 1}, {start: 0, end: 0}, {start: 0, end: .5}]) expect(() => scoredTokenSpans([span], [1])).toThrow('ALIGNMENT');
        expect(() => scoredTokenSpans([{start: 0, end: 1}], [NaN])).toThrow('ALIGNMENT');
        expect(() => scoredTokenSpans([{start: 0, end: 1}], [-1])).toThrow('ALIGNMENT');
    });
});

describe('bounded causal inference ownership', () => {
    it('bounds warm result reuse by entry count and original UTF16 size, with true LRU promotion', () => {
        const result = {spans: [{start: 0, end: 1, score: 1}], engine: 'local'}, cache = createSurprisalResultCache();
        expect(cache.get('missing')).toBeUndefined();
        for (let i=0;i<256;i++) cache.put(`text-${i}`, result);
        expect(cache.get('text-0')).toBe(result); cache.put('last', result); expect(cache.get('text-1')).toBeUndefined(); expect(cache.get('text-0')).toBe(result);
        const changed = {spans: [], engine: 'updated'}; cache.put('text-0', changed); expect(cache.get('text-0')).toBe(changed);
        const sized = createSurprisalResultCache(); sized.put('a'.repeat(200000), result); sized.put('b'.repeat(200000), result); sized.put('x', result);
        expect(sized.get('a'.repeat(200000))).toBeUndefined(); expect(sized.get('b'.repeat(200000))).toBe(result);
        sized.put('a'.repeat(400001), result); expect(sized.get('a'.repeat(400001))).toBeUndefined(); expect(sized.get('x')).toBeUndefined();
    });
    function fixture(text = 'a'.repeat(70)) {
        const tensors: ScoringTensor[] = [], forwardInputs: Array<{ids: number[]; length: number; past: unknown}> = [];
        const tensor = (dims: number[], data: number[]) => {const value = {dims, type: 'float32', data, dispose: vi.fn()}; tensors.push(value); return value;};
        const engine: CausalScoringEngine = {bosId: 0, tokenize: vi.fn(() => ({ids: Array.from(text, () => 1), pieces: Array.from(text), addedTokens: new Map()})), yield: vi.fn(async () => {}),
            forward: vi.fn(async (ids, length, past) => {forwardInputs.push({ids, length, past}); return {logits: tensor([1, ids.length, 2], Array(ids.length * 2).fill(0)), 'present.0.key': tensor([1, 1, length, 1], [0])};}),
        };
        return {engine, tensors, forwardInputs, tensor};
    }
    it('scores every source token with one BOS, preserves cache context and disposes every tensor once', async () => {
        const {engine, tensors, forwardInputs} = fixture();
        const result = await scoreLocalSurprisal(engine, 'a'.repeat(70), new AbortController().signal);
        expect(result.spans).toHaveLength(70); expect(result.spans.every(span => span.score === 1)).toBe(true);
        expect(forwardInputs.map(input => input.length)).toEqual([32,64,71]); expect(forwardInputs[0].past).toBeNull(); expect(forwardInputs[1].past).toBeTruthy();
        expect(tensors.every(tensor => vi.mocked(tensor.dispose).mock.calls.length === 1)).toBe(true);
    });
    it('gives the context-free first token the median of the remaining scores and leaves single-token text untouched', async () => {
        const {engine, tensor} = fixture('abcde');
        // 行 r 的两路 logits 让目标 token 1 的意外度依次约为 17、1、3、2、5 bits；首行模拟仅有 BOS 时的先验。
        const bits = [17, 1, 3, 2, 5, 1], row = (value: number) => [Math.log(2 ** value - 1), 0];
        engine.forward = vi.fn(async (ids: number[], length: number) => ({logits: tensor([1, ids.length, 2], bits.slice(0, ids.length).flatMap(row)), 'present.0.key': tensor([1, 1, length, 1], [0])}));
        const result = await scoreLocalSurprisal(engine, 'abcde', new AbortController().signal);
        expect(result.spans.map(span => Math.round(span.score))).toEqual([3, 1, 3, 2, 5]);
        const single = fixture('a'); single.engine.forward = vi.fn(async (ids: number[], length: number) => ({logits: single.tensor([1, ids.length, 2], [...row(17), ...row(1)]), 'present.0.key': single.tensor([1, 1, length, 1], [0])}));
        expect(Math.round((await scoreLocalSurprisal(single.engine, 'a', new AbortController().signal)).spans[0].score)).toBe(17);
    });
    it('skips only an unused extra block at exact token boundaries and preserves all other batch shapes', async () => {
        for (const count of [1,32,64]) {
            const {engine, tensors, forwardInputs} = fixture('a'.repeat(count)); const result = await scoreLocalSurprisal(engine, 'a'.repeat(count), new AbortController().signal);
            expect(result.spans).toHaveLength(count); expect(result.spans.every(span => span.score === 1)).toBe(true);
            expect(forwardInputs.map(value => value.ids.length)).toEqual(count === 1 ? [2] : Array(count / 32).fill(32));
            expect(forwardInputs.at(-1)!.length).toBe(count === 1 ? 2 : count); expect(tensors.every(tensor => vi.mocked(tensor.dispose).mock.calls.length === 1)).toBe(true);
        }
    });
    it('cancels between chunks and after forward without leaking a cache or starting another chunk', async () => {
        for (const afterForward of [false, true]) {
            const fixtureValue = fixture(), controller = new AbortController();
            if (afterForward) {const forward = fixtureValue.engine.forward; fixtureValue.engine.forward = async (...args) => {const result = await forward(...args); controller.abort(); return result;};}
            else fixtureValue.engine.yield = async () => {controller.abort();};
            await expect(scoreLocalSurprisal(fixtureValue.engine, 'a'.repeat(70), controller.signal)).rejects.toMatchObject({name: 'AbortError'});
            expect(fixtureValue.forwardInputs).toHaveLength(1); expect(fixtureValue.tensors.every(tensor => vi.mocked(tensor.dispose).mock.calls.length === 1)).toBe(true);
        }
        const controller = new AbortController(); controller.abort(); await expect(scoreLocalSurprisal(fixture().engine, 'a', controller.signal)).rejects.toMatchObject({name: 'AbortError'});
    });
    it('rejects limits, missing BOS and invalid graphs rather than returning a truncated heatmap', async () => {
        const {engine, tensor} = fixture('a');
        await expect(scoreLocalSurprisal(engine, '', new AbortController().signal)).rejects.toThrow('TEXT_LIMIT');
        await expect(scoreLocalSurprisal(engine, 'a'.repeat(12001), new AbortController().signal)).rejects.toThrow('TEXT_LIMIT');
        for (const count of [0, 2049]) {engine.tokenize = () => ({ids: Array(count).fill(1), pieces: [], addedTokens: new Map()}); await expect(scoreLocalSurprisal(engine, 'a', new AbortController().signal)).rejects.toThrow('TOKEN_LIMIT');}
        engine.tokenize = () => ({ids: [1], pieces: ['a'], addedTokens: new Map()}); engine.bosId = -1;
        await expect(scoreLocalSurprisal(engine, 'a', new AbortController().signal)).rejects.toThrow('BOS'); engine.bosId = 0;
        for (const dims of [[], [2,2,2], [1,1,2]]) {engine.forward = async () => ({logits: tensor(dims, [0,0])}); await expect(scoreLocalSurprisal(engine, 'a', new AbortController().signal)).rejects.toThrow('BAD_LOGITS');}
        engine.forward = async () => ({}); await expect(scoreLocalSurprisal(engine, 'a', new AbortController().signal)).rejects.toThrow('BAD_LOGITS');
        engine.forward = async () => ({logits: tensor([1,2,2], [0,0,0,0])}); await expect(scoreLocalSurprisal(engine, 'a', new AbortController().signal)).rejects.toThrow('NO_CACHE');
        engine.forward = async () => {throw new Error('GPU');}; await expect(scoreLocalSurprisal(engine, 'a', new AbortController().signal)).rejects.toThrow('GPU');
        const last = fixture('a'); last.engine.yield = async () => {throw new Error('yield');}; await expect(scoreLocalSurprisal(last.engine, 'a', new AbortController().signal)).rejects.toThrow('yield'); expect(last.tensors.every(tensor => vi.mocked(tensor.dispose).mock.calls.length === 1)).toBe(true);
    });
});
