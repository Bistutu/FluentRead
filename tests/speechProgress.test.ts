import {describe,expect,it} from 'vitest';
import {audioSpeechProgress,boundarySpeechProgress,parseSpeechCues,parseSpeechProgress,speechTextSlices,speechTextTokens,parseSpeechPlaybackPosition,seekSpeechTime} from '@/src/core/tts/speechProgress';
describe('音频时间与安全跟读切片',()=>{
    it('仅接受有序有效句段，损坏或超大数据不参与跟读',()=>{
        const cue={startChar:0,endChar:5,startTime:0,endTime:1};expect(parseSpeechCues([cue])).toEqual([cue]);
        for(const value of [null,{},Array(2049).fill(cue),[null],[{...cue,startChar:-1}],[{...cue,endChar:0}],[{...cue,startTime:-1}],[{...cue,endTime:0}],[{...cue,endTime:NaN}],[{...cue,startChar:.1}]])expect(parseSpeechCues(value)).toEqual([]);
        expect(parseSpeechCues([cue,{...cue,startChar:6,endChar:8,startTime:1,endTime:2}])).toHaveLength(2);
        expect(parseSpeechCues([cue,cue])).toEqual([]);
    });
    it('跨消息进度字段严格校验，只返回安全值',()=>{
        const p={start:0,end:10,fraction:.4,estimated:true};expect(parseSpeechProgress(p)).toEqual(p);
        for(const value of [null,{},'text',{...p,start:-1},{...p,start:.1},{...p,end:0},{...p,end:.1},{...p,fraction:NaN},{...p,fraction:-1},{...p,fraction:2},{...p,estimated:'yes'}])expect(parseSpeechProgress(value)).toBeNull();
    });
    it('使用实际媒体时间和局部句段时长，保留估算标识并处理跳转',()=>{
        const text='Hello world';const cue={startChar:6,endChar:11,startTime:1,endTime:3};
        expect(audioSpeechProgress(text,2,3,[cue])).toEqual({start:6,end:11,fraction:.5,estimated:true});
        expect(audioSpeechProgress(text,1.5,3)).toEqual({start:6,end:11,fraction:0,estimated:true});
        expect(audioSpeechProgress('你好世界',1,4)).toEqual({start:1,end:2,fraction:0,estimated:true});
        expect(audioSpeechProgress('H2D可以打印TPU纤维',3,12)).toEqual({start:3,end:4,fraction:0,estimated:true});
        expect(audioSpeechProgress("it's 中文",1,7)).toEqual({start:0,end:4,fraction:.25,estimated:true});
        expect(audioSpeechProgress('…  ',1,2)).toEqual({start:0,end:3,fraction:.5,estimated:true});
        expect(audioSpeechProgress(text,.5,3,[cue])?.fraction).toBe(0);
        expect(audioSpeechProgress(text,10,3)?.fraction).toBe(1);expect(audioSpeechProgress(text,0,3)?.fraction).toBe(0);
        expect(audioSpeechProgress(text,2,3,[{...cue,startChar:20,endChar:30}])).toBeNull();
        for(const [t,d] of [[-1,2],[NaN,2],[0,Infinity],[0,0]])expect(audioSpeechProgress(text,t,d)).toBeNull();
        expect(audioSpeechProgress('',0,2)).toBeNull();
    });
    it('浏览器真实词边界不估算字符范围，缺失长度时定位当前词',()=>{
        expect(boundarySpeechProgress('Hello world',6,5)).toEqual({start:6,end:11,fraction:1,estimated:false});
        expect(boundarySpeechProgress('Hello world',6,0)?.end).toBe(11);expect(boundarySpeechProgress('Hi there',2,0)).toEqual({start:3,end:8,fraction:1,estimated:false});
        expect(boundarySpeechProgress('Hi',0,100)?.end).toBe(2);
        for(const n of [-1,.1,20])expect(boundarySpeechProgress('Hi',n,1)).toBeNull();
        expect(boundarySpeechProgress('For this release, we agree.',9,2)).toEqual({start:9,end:16,fraction:1,estimated:false});
        expect(boundarySpeechProgress('For this release, we agree.',11,1)?.start).toBe(9);
        expect(boundarySpeechProgress('Hello! ',5,1)).toBeNull();
    });
    it('分词连续保留空白、缩写、混排和 emoji，分段时间间隙保持前一个词',()=>{
        const text="  We’re publishing H2D，中文\n🙂 release.";
        const tokens=speechTextTokens(text);
        expect(tokens.map(token=>token.text).join('')).toBe(text);
        expect(tokens.filter(token=>token.word).map(token=>token.text)).toEqual(['We’re','publishing','H2D','中','文','release']);
        expect(speechTextTokens('word')[0]).toEqual({text:'word',start:0,end:4,word:true});
        expect(speechTextTokens('')).toEqual([]);
        const cues=[{startChar:0,endChar:5,startTime:0,endTime:1},{startChar:6,endChar:11,startTime:2,endTime:3}];
        expect(audioSpeechProgress('Hello world',1.5,3,cues)).toEqual({start:0,end:5,fraction:1,estimated:true});
        expect(audioSpeechProgress('Hello world',2.5,3,cues)?.start).toBe(6);
    });
    it('音频时钟严格解析，5 秒跳转限制首尾且拒绝未加载时长',()=>{
        expect(parseSpeechPlaybackPosition({currentTime:2,duration:12,privateField:'discard'})).toEqual({currentTime:2,duration:12});
        expect(parseSpeechPlaybackPosition({currentTime:20,duration:12})).toEqual({currentTime:12,duration:12});
        for(const value of [null,{},'time',{currentTime:-1,duration:12},{currentTime:NaN,duration:12},{currentTime:0,duration:Infinity},{currentTime:0,duration:0}])expect(parseSpeechPlaybackPosition(value)).toBeNull();
        expect(seekSpeechTime(2,12,-5)).toBe(0);
        expect(seekSpeechTime(2,12,5)).toBe(7);
        expect(seekSpeechTime(10,12,5)).toBe(12);
        expect(seekSpeechTime(0,NaN,5)).toBeNull();
        expect(seekSpeechTime(0,12,NaN)).toBeNull();
    });
    it('原文与空白完整保留，跨富文本片段按绝对索引扫色',()=>{
        const p={start:2,end:8,fraction:.5,estimated:true};
        const slices=speechTextSlices('  Hello world',0,p);expect(slices).toEqual({before:'  ',active:'Hello ',after:'world',fraction:.5});
        const part=speechTextSlices('lo world',5,p);expect(part).toEqual({before:'',active:'lo ',after:'world',fraction:0});
        expect(speechTextSlices('untouched',20,p)).toEqual({before:'',active:'',after:'untouched',fraction:0});
        expect(speechTextSlices('exact text',0,null)).toEqual({before:'',active:'',after:'exact text',fraction:0});
        expect(speechTextSlices('lo ',5,{...p,fraction:1}).fraction).toBe(1);
    });
});
