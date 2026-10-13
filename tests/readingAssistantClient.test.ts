import {beforeEach, describe, expect, it, vi} from 'vitest';
import {clearHarnessSessions, deleteHarnessSession, getHarnessSession, listHarnessSessions, streamReading, clearLearningMemories, deleteLearningMemory, listLearningMemories, saveLearningMemory} from '@/src/features/reading-assistant/client';

const state = vi.hoisted(() => ({
  message: vi.fn(), connect: vi.fn(), port: null as any,
}));
vi.mock('webextension-polyfill', () => ({default: {runtime: {sendMessage: state.message, connect: state.connect}}}));

beforeEach(() => {
  state.message.mockReset();
  state.port = {postMessage: vi.fn(), disconnect: vi.fn(), onMessage: {addListener: vi.fn()}, onDisconnect: {addListener: vi.fn()}};
  state.connect.mockReset().mockReturnValue(state.port);
});

describe('reading assistant client', () => {
  it('streams progress/result, ignores late messages, and disconnects after result', () => {
    const progress = vi.fn(); const result = vi.fn();
    const handle = streamReading({type: 'fluentReadHarness', action: 'run', requestId: 'r1', selection: {text: 'x', context: '', sentence: ''}, intent: 'meaning', question: ''}, {progress, result});
    const onMessage = state.port.onMessage.addListener.mock.calls[0][0];
    onMessage({type: 'progress', requestId: 'other', progress: {kind: 'text', text: 'ignored'}});
    onMessage({type: 'progress', requestId: 'r1', progress: {kind: 'text', text: 'partial'}});
    onMessage({type: 'result', requestId: 'r1', response: {success: true, text: 'done', service: 'openai', model: 'm'}});
    onMessage({type: 'progress', requestId: 'r1', progress: {kind: 'text', text: 'late'}});
    expect(progress).toHaveBeenCalledOnce(); expect(result).toHaveBeenCalledOnce(); expect(state.port.disconnect).toHaveBeenCalled();
    const onDisconnect = state.port.onDisconnect.addListener.mock.calls[0][0]; onDisconnect();
    state.port.disconnect.mockImplementation(() => { throw new Error('disconnect race'); });
    const second = streamReading({type: 'fluentReadHarness', action: 'run', requestId: 'r1b', selection: {text: 'x', context: '', sentence: ''}, intent: 'meaning', question: ''}, {result});
    state.port.onMessage.addListener.mock.calls.at(-1)[0]({type: 'result', requestId: 'r1b', response: {success: true, text: 'done', service: 'openai', model: 'm'}});
    second.cancel();
    handle.cancel(); expect(state.message).not.toHaveBeenCalled();
  });
  it('cancels by disconnecting and sends compatibility cancel, while disconnect reports errors', () => {
    const error = vi.fn(); const handle = streamReading({type: 'fluentReadHarness', action: 'run', requestId: 'r2', selection: {text: 'x', context: '', sentence: ''}, intent: 'meaning', question: ''}, {error});
    const onDisconnect = state.port.onDisconnect.addListener.mock.calls[0][0]; onDisconnect(); expect(error).toHaveBeenCalledOnce();
    handle.cancel(); expect(state.message).not.toHaveBeenCalled();
    state.port = {postMessage: vi.fn(() => {throw new Error('send') }), disconnect: vi.fn(), onMessage: {addListener: vi.fn()}, onDisconnect: {addListener: vi.fn()}}; state.connect.mockReturnValue(state.port);
    streamReading({type: 'fluentReadHarness', action: 'run', requestId: 'r3', selection: {text: 'x', context: '', sentence: ''}, intent: 'meaning', question: ''}, {error}); expect(error).toHaveBeenCalledTimes(2);
  });
  it('covers active cancellation, rejected cancel messages and connect failures', async () => {
    state.message.mockRejectedValue(new Error('background unavailable'));
    state.port.disconnect.mockImplementation(() => { throw new Error('already disconnected'); });
    const handle = streamReading({type: 'fluentReadHarness', action: 'run', requestId: 'r4', selection: {text: 'x', context: '', sentence: ''}, intent: 'meaning', question: ''}, {});
    handle.cancel();
    expect(state.message).toHaveBeenCalledWith({type: 'fluentReadHarness', action: 'cancel', requestId: 'r4'});
    state.connect.mockImplementation(() => { throw new Error('connect failed'); });
    expect(() => streamReading({type: 'fluentReadHarness', action: 'run', requestId: 'r5', selection: {text: 'x', context: '', sentence: ''}, intent: 'meaning', question: ''}, {})).toThrow('connect failed');
    await Promise.resolve();
  });
  it('wraps paged session operations and rejects backend failures', async () => {
    state.message.mockResolvedValueOnce({success: true, sessions: [], hasMore: true}).mockResolvedValueOnce({success: true, session: null}).mockResolvedValueOnce({success: true}).mockResolvedValueOnce({success: true});
    await expect(listHarnessSessions(20)).resolves.toEqual({success: true, sessions: [], hasMore: true});
    await expect(getHarnessSession('s')).resolves.toBeNull(); await expect(deleteHarnessSession('s')).resolves.toBeUndefined(); await expect(clearHarnessSessions()).resolves.toBeUndefined();
    expect(state.message).toHaveBeenNthCalledWith(1, {type: 'fluentReadHarness', action: 'sessions-list', offset: 20});
    state.message.mockResolvedValueOnce({success: false, error: 'denied'}); await expect(listHarnessSessions()).rejects.toThrow('denied');
    state.message.mockResolvedValueOnce({success: false}); await expect(listHarnessSessions()).rejects.toThrow('会话操作失败');
  });
  it('wraps learning memory CRUD and snapshots only whitelisted fields from reactive input', async () => {
    const memory = {id: 'a0000000-0000-4000-8000-000000000001', content: '先解释主干', kind: 'preference' as const, createdAt: 1, updatedAt: 1};
    state.message.mockResolvedValueOnce({success: true, memories: [memory]}).mockResolvedValueOnce({success: true, memory}).mockResolvedValueOnce({success: true, memory}).mockResolvedValueOnce({success: true}).mockResolvedValueOnce({success: true});
    expect(await listLearningMemories()).toEqual([memory]);
    expect(await saveLearningMemory({content: memory.content, kind: memory.kind})).toEqual(memory);
    expect(await saveLearningMemory({...memory, token: 'never send'} as any)).toEqual(memory);
    await deleteLearningMemory(memory.id); await clearLearningMemories();
    expect(state.message.mock.calls.map(call => call[0])).toEqual([
      {type: 'fluentReadHarness', action: 'memory-list'},
      {type: 'fluentReadHarness', action: 'memory-save', input: {content: memory.content, kind: memory.kind}},
      {type: 'fluentReadHarness', action: 'memory-save', input: {content: memory.content, kind: memory.kind, id: memory.id}},
      {type: 'fluentReadHarness', action: 'memory-delete', id: memory.id},
      {type: 'fluentReadHarness', action: 'memory-clear'},
    ]);
    state.message.mockResolvedValueOnce({success: false, error: '学习记忆不能超过 2000 个字符'});
    await expect(saveLearningMemory({content: 'x'.repeat(2001), kind: 'note'})).rejects.toThrow('2000');
  });
});
