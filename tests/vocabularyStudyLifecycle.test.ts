import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import vue from '@vitejs/plugin-vue';
import {createServer, type Plugin, type ViteDevServer} from 'vite';
import {afterEach, describe, expect, it, vi} from 'vitest';
import type {VocabularyEntry} from '@/src/features/vocabulary/learningModel';
import type {ReadingRequest, ReadingProgress, ReadingResponse} from '@/src/features/reading-assistant/types';

const KEY = '__frSentenceStudyLifecycle';
const runtime = createRequire(import.meta.url)('vue') as typeof import('vue');
interface StreamCall {
  request: ReadingRequest;
  callbacks: {progress(value: ReadingProgress): void; result(value: ReadingResponse): void; error(error: Error): void};
  cancel: ReturnType<typeof vi.fn>;
}
let server: ViteDevServer | undefined;
let unmount: (() => void) | undefined;
afterEach(async () => {
  unmount?.(); unmount = undefined;
  await server?.close(); server = undefined;
  delete (globalThis as Record<string, unknown>)[KEY];
});

async function mountStudy(overrides: Partial<VocabularyEntry> = {}) {
  const calls: StreamCall[] = [];
  const entry: VocabularyEntry = {
    id:'sentence-a', kind:'sentence', term:'Good ideas deserve attention.', updatedAt:10,
    identityKey:'en:good ideas deserve attention.', sourceLanguage:'en', normalizedTerm:'good ideas deserve attention.', phonetic:'', partOfSpeech:'',
    createdAt:10, lastSeenAt:10, encounterCount:1, masteryLevel:0, status:'new', nextReviewAt:10, lastReviewedAt:null, reviewCount:0, lapseCount:0, schemaVersion:1,
    contexts:[{text:'Good ideas deserve attention. Practice makes progress.', capturedAt:10}],
    translations:{'zh-hans':{text:'好想法值得关注。', updatedAt:10}},
    ...overrides,
  };
  const props = runtime.reactive({entry, reference:'好想法值得关注。'});
  const sendMessage = vi.fn(async (message: {note: string}) => ({success:true, data:{...props.entry, note:message.note, noteUpdatedAt:11, updatedAt:11}}));
  const state = {
    config:{on:true, harness:{enabled:true, contextMode:'paragraph'}},
    subscribeConfig:()=>()=>undefined,
    browser:{runtime:{sendMessage}},
    streamReading(request: ReadingRequest, callbacks: StreamCall['callbacks']) {
      const call = {request, callbacks, cancel:vi.fn()}; calls.push(call); return {cancel:call.cancel};
    },
  };
  (globalThis as Record<string, unknown>)[KEY] = state;
  const mocks: Plugin = {
    name:'sentence-study-lifecycle-mocks', enforce:'pre',
    resolveId(id) {
      if (id === 'webextension-polyfill') return '\0study-browser';
      if (/(?:@\/src|\/src)\/services\/config\/store(?:\.ts)?$/u.test(id)) return '\0study-config';
      if (/(?:@\/src|\/src)\/features\/reading-assistant\/(?:ui\/answer\/)?public(?:\.ts)?$/u.test(id)) return '\0study-reading';
      if (/(?:@\/src|\/src)\/ui\/i18n(?:\.ts)?$/u.test(id)) return '\0study-i18n';
      return null;
    },
    load(id) {
      if (id === '\0study-browser') return `export default globalThis.${KEY}.browser;`;
      if (id === '\0study-config') return `export const {config, subscribeConfig} = globalThis.${KEY};`;
      if (id === '\0study-reading') return `export const {streamReading} = globalThis.${KEY}; export const ReadingAnswer = {render:()=>null};`;
      if (id === '\0study-i18n') return 'export const useUiI18n=()=>({t:key=>key,translateLegacy:text=>text});';
      return null;
    },
  };
  server = await createServer({configFile:false, appType:'custom', logLevel:'silent', root:process.cwd(), plugins:[mocks,vue()], resolve:{alias:{'@':resolve(process.cwd())}}, server:{hmr:false,middlewareMode:true}, ssr:{noExternal:['webextension-polyfill']}});
  const loaded = await server.ssrLoadModule('/src/features/vocabulary/ui/VocabularyStudy.vue');
  const component = loaded.default; component.ssrRender = undefined; component.render = () => null;
  const renderer = runtime.createRenderer<Record<string, never>, Record<string, unknown>>({
    patchProp:()=>undefined, insert:()=>undefined, remove:()=>undefined,
    createElement:()=>({}), createText:()=>({}), createComment:()=>({}),
    setText:()=>undefined, setElementText:()=>undefined, parentNode:()=>null,
    nextSibling:()=>null, querySelector:()=>null, setScopeId:()=>undefined,
    cloneNode:()=>({}), insertStaticContent:()=>[{},{}],
  });
  let panel: any;
  const updated = vi.fn((entry: VocabularyEntry) => {props.entry = entry;});
  const app = renderer.createApp({setup:()=>()=>runtime.h(component,{...props,onUpdated:updated,ref:(instance:any)=>{if(instance)panel=instance.$.setupState;}})});
  app.provide(runtime.ssrContextKey,{modules:new Set<string>()}); app.config.warnHandler=()=>undefined;
  app.mount({}); unmount=()=>app.unmount(); await runtime.nextTick();
  const finish = (text: string, call = calls.at(-1)!) => call.callbacks.result({success:true,text,service:'fixture',model:'fixture',sessionId:'study-a'});
  return {panel,props,calls,sendMessage,updated,finish,tick:runtime.nextTick};
}

describe('saved sentence explanation lifecycle', () => {
  it('grounds an explicit Chinese expression request in its latest useful saved sentence and cancels it when that sentence changes', async () => {
    const contexts = [{text:'我每天学习中文。', capturedAt:10}, {text:'学习', capturedAt:11}, {text:'这是无关的原句。', capturedAt:12}];
    const {panel,props,calls,sendMessage,finish,tick} = await mountStudy({kind:'expression', term:'学习', sourceLanguage:'zh-CN', contexts});
    expect(calls).toHaveLength(0); expect(panel.context.text).toBe(contexts[0].text);
    panel.run('understand');
    expect(calls[0].request.selection).toEqual({text:'学习', context:'我每天学习中文。', sentence:''});
    expect(calls[0].request.studyMode).toBe('understand');
    props.entry = {...props.entry,contexts:[{text:'明天继续学习。', capturedAt:13}]}; await tick();
    expect(calls[0].cancel).toHaveBeenCalledOnce(); finish('Late previous explanation',calls[0]);
    expect(panel.explanation).toBe(''); expect(calls).toHaveLength(1);
    panel.run('understand'); expect(calls[1].request.selection.context).toBe('明天继续学习。');
    expect(sendMessage).not.toHaveBeenCalled(); expect(contexts.map(context=>context.text)).toEqual(['我每天学习中文。','学习','这是无关的原句。']);
  });
  it('generates only on demand and preserves reading while saving a separate note', async () => {
    const {panel,props,calls,sendMessage,finish,tick} = await mountStudy();
    expect(calls).toHaveLength(0); expect(sendMessage).not.toHaveBeenCalled();
    panel.run('understand'); expect(calls[0].request.studyMode).toBe('sentence');
    expect(calls[0].request.selection.text).toBe(props.entry.term);
    calls[0].callbacks.progress({kind:'text',text:'Partial explanation'});
    props.entry = {...props.entry,note:'My own note',updatedAt:11}; await tick();
    expect(panel.busy).toBe(true); expect(calls[0].cancel).not.toHaveBeenCalled();
    finish('A concise explanation.'); await tick();
    expect(sendMessage).not.toHaveBeenCalled();
    await panel.saveExplanation(); await tick();
    expect(sendMessage).toHaveBeenCalledWith({type:'fluentReadVocabularyBook',action:'updateNote',entryId:'sentence-a',note:'A concise explanation.'});
    expect(props.entry.note).toBe('A concise explanation.');
    expect(props.entry.translations['zh-hans'].text).toBe('好想法值得关注。');
    expect(panel.explanation).toBe('A concise explanation.'); expect(panel.completedExplanation).toBe(false);
    expect(panel.notice).toContain('解释已保存');
  });

  it('rejects late responses after a source changes and cannot save canceled or failed output', async () => {
    const {panel,props,calls,sendMessage,finish,tick} = await mountStudy();
    panel.run('understand'); const old = calls[0];
    old.callbacks.progress({kind:'text',text:'Old partial answer'});
    props.entry = {...props.entry,term:'Practice makes progress.'}; await tick();
    expect(old.cancel).toHaveBeenCalledOnce(); expect(panel.explanation).toBe('');
    finish('A late answer.',old); expect(panel.explanation).toBe('');
    panel.run('understand'); const stopped = calls[1];
    stopped.callbacks.progress({kind:'text',text:'Interrupted explanation'}); panel.stop();
    finish('A canceled answer.',stopped); await panel.saveExplanation();
    expect(panel.explanation).toBe('Interrupted explanation'); expect(sendMessage).not.toHaveBeenCalled();
    panel.run('understand'); calls[2].callbacks.result({success:false,error:'Fixture unavailable'});
    await panel.saveExplanation(); expect(sendMessage).not.toHaveBeenCalled(); expect(panel.error).toBe('Fixture unavailable');
    panel.run('understand'); const leaving = calls[3]; unmount?.(); unmount=undefined;
    expect(leaving.cancel).toHaveBeenCalledOnce(); finish('After unmount.',leaving);
    expect(panel.completedExplanation).toBe(false);
  });
});
