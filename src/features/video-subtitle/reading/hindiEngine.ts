/**
 * @file src/features/video-subtitle/reading/hindiEngine.ts
 * 文件职责：以静态 TypeScript 执行 gomanize 1.2.1 的印地语读音规则，替代携带 Go 运行时的 WASM。
 * 主要内容：忠实保留原版字素解析、辅音串、分阶段规则、词典优先、默认/学习型 schwa 双候选与字节级四元组排序；仅适配当前 lexicon:true、rerank:true 选项。
 * 模块边界：纯文本算法，只接收已校验数据字符串；不联网、不访问缓存或 DOM，不执行下载内容。
 * 来源：移植 budhash/gomanize commit 3e519d5cfb689c2444545396e4cfab24d3a2d84a（MIT，Copyright (c) 2023-2026 Budhaditya (budhash@gmail.com)）。
 * 具体来源和完整授权见 public/third-party-notices/reading-annotation-NOTICE.md 与 reading-gomanize-MIT.txt；Dakshina 派生数据另按 CC BY-SA 4.0 授权。
 */

type Kind = 'consonant' | 'conjunct' | 'vowel' | 'modifier' | 'number' | 'symbol';
interface SymbolInfo {kind: Kind; roman: string; matra?: boolean; halant?: boolean}
interface Unit {text: string; runes: string[]; start: number; kind: Kind; roman: string; matra: boolean; afterHalant: boolean; schwa: 0 | 1 | 2; run?: Run; runIndex: number}
interface Run {units: Unit[]; deletedAt: number}
interface Word {original: string; runes: string[]; units: Unit[]}
interface TreeNode {leaf?: number; f?: string; v?: string; yes?: TreeNode; no?: TreeNode}
export interface HindiEngineData {lexiconTsv: string; romanNgramsTsv: string; schwaTreeJson: string}

const symbols: Record<string, SymbolInfo> = Object.create(null);
function add(kind: Kind, values: Record<string, string>, matra = false): void {
  for (const [text, roman] of Object.entries(values)) symbols[text] = {kind, roman, matra};
}
add('modifier', {'ँ':'n','ं':'n','ः':'h'});
add('vowel', {'ऄ':'a','अ':'a','आ':'aa','इ':'i','ई':'i','उ':'u','ऊ':'u','ऋ':'ri','ऌ':'l','ऍ':'æ','ऎ':'e','ए':'e','ऐ':'ai','ऑ':'o','ऒ':'o','ओ':'o','औ':'au','ॠ':'ri','ॡ':'ll'});
add('consonant', {'क':'k','ख':'kh','ग':'g','घ':'gh','ङ':'n','च':'ch','छ':'chh','ज':'j','झ':'jh','ञ':'ny','ट':'t','ठ':'th','ड':'d','ढ':'dh','ण':'n','त':'t','थ':'th','द':'d','ध':'dh','न':'n','ऩ':'nh','प':'p','फ':'f','ब':'b','भ':'bh','म':'m','य':'y','र':'r','ऱ':'rh','ल':'l','ळ':'l','ऴ':'lh','व':'v','श':'sh','ष':'sh','स':'s','ह':'h','ॐ':'om','क़':'q','ख़':'kh','ग़':'gh','ज़':'z','ड़':'d','ढ़':'dh','फ़':'f','य़':'yh'});
add('symbol', {'़':'','ऽ':''});
add('vowel', {'ा':'a','ि':'i','ी':'i','ु':'u','ू':'u','ृ':'ri','ॄ':'ri','ॅ':'æ','ॆ':'e','े':'e','ै':'ai','ॉ':'o','ॊ':'o','ो':'o','ौ':'au','ॢ':'l','ॣ':'ll'}, true);
symbols['्'] = {kind:'symbol', roman:'', halant:true};
add('conjunct', {'ज्ञ':'gy'});
add('number', Object.fromEntries(Array.from('०१२३४५६७८९', (c, i) => [c, String(i)])));
for (const [pre, base] of Object.entries({'क़':'क','ख़':'ख','ग़':'ग','ज़':'ज','ड़':'ड','ढ़':'ढ','फ़':'फ','य़':'य'})) symbols[pre] = symbols[base + '़'];
for (const [pre, base] of Object.entries({'ऩ':'न','ऱ':'र','ऴ':'ळ'})) symbols[base + '़'] = symbols[pre];
const multi = ['ज्ञ','क़','ख़','ग़','ज़','ड़','ढ़','फ़','य़'];
const consonants = new Set(Array.from('कखगघङचछजझञटठडढणतथदधनपफबभमयरलवशषसहळ'));
const modelMatras = new Set(Array.from('ािीुूृेैोौंःँॉ'));
const isConsonant = (unit: Unit | undefined): unit is Unit & {kind: 'consonant' | 'conjunct'} => unit?.kind === 'consonant' || unit?.kind === 'conjunct';
const isText = (unit: Unit | undefined, text: string) => unit?.text === text;

function parse(input: string): Word {
  const original = input.replace(/\p{Cf}/gu, '');
  const runes = Array.from(original), units: Unit[] = [];
  let afterHalant = false;
  for (let pos = 0; pos < runes.length;) {
    let text = multi.find(candidate => runes.slice(pos, pos + Array.from(candidate).length).join('') === candidate) || runes[pos];
    if (text === runes[pos] && runes[pos + 1] === '़' && symbols[text + '़']) text += '़';
    const info = symbols[text], length = Array.from(text).length;
    if (info?.halant) {afterHalant = true; pos += length; continue;}
    const kind = info?.kind || 'symbol';
    units.push({text, runes:Array.from(text), start:pos, kind, roman:info?.roman ?? text, matra:info?.matra === true,
      afterHalant, schwa:kind === 'consonant' || kind === 'conjunct' ? 0 : 1, runIndex:0});
    afterHalant = false; pos += length;
  }
  let run: Run | undefined;
  for (const unit of units) {
    if (isConsonant(unit)) {
      run ??= {units:[], deletedAt:-1}; unit.run = run; unit.runIndex = run.units.length; run.units.push(unit);
    } else run = undefined;
  }
  return {original, runes, units};
}

function parseTree(source: string): TreeNode {
  const parsed: unknown = JSON.parse(source);
  if (!parsed || typeof parsed !== 'object' || !('tree' in parsed)) throw new Error('Hindi schwa data is invalid');
  let nodes = 0;
  const visit = (value: unknown, depth = 0): TreeNode => {
    if (!value || typeof value !== 'object' || ++nodes > 4096 || depth > 64) throw new Error('Hindi schwa tree is invalid');
    if ('leaf' in value && (value.leaf === 0 || value.leaf === 1)) return {leaf:value.leaf};
    if (!('f' in value) || !['cons','prev','next','next2','first','last'].includes(String(value.f))
      || !('v' in value) || typeof value.v !== 'string' || value.v.length > 8 || !('yes' in value) || !('no' in value)) throw new Error('Hindi schwa node is invalid');
    return {f:String(value.f), v:value.v, yes:visit(value.yes, depth + 1), no:visit(value.no, depth + 1)};
  };
  return visit(parsed.tree);
}

function modelDecision(word: Word, unit: Unit, tree: TreeNode): boolean | undefined {
  const {runes} = word, i = unit.start;
  if (!consonants.has(runes[i])) return undefined;
  let next = i + 1;
  if (runes[next] === '़') next++;
  if (runes[next] === '्' || modelMatras.has(runes[next])) return undefined;
  const features: Record<string, string> = {cons:runes[i] + (runes[i + 1] === '़' ? '़' : ''), prev:runes[i - 1] ?? '^',
    next:runes[i + 1] ?? '$', next2:runes[i + 2] ?? '$', first:runes.slice(0, i).some(r => consonants.has(r)) ? '0' : '1',
    last:runes.slice(next).some(r => consonants.has(r)) ? '0' : '1'};
  let node: TreeNode | undefined = tree;
  while (node && node.leaf === undefined) node = features[node.f!] === node.v ? node.yes : node.no;
  return node?.leaf !== 0;
}

function applySchwa(word: Word, tree: TreeNode, learned: boolean): void {
  const units = word.units;
  const decide = (unit: Unit, deleted: boolean) => {unit.schwa = deleted ? 2 : 1; if (deleted && unit.run) unit.run.deletedAt = unit.runIndex;};
  // The original engine runs each complete rule over the word before the next rule (scope*100 + priority).
  if (learned) for (const unit of units) if (isConsonant(unit) && unit.schwa === 0) {
    const deleted = modelDecision(word, unit, tree); if (deleted !== undefined) decide(unit, deleted);
  }
  for (const unit of units) if (isConsonant(unit) && unit.schwa === 0 && unit === units.at(-1) && unit.roman === 'gy' && unit !== units[0]) unit.schwa = 1;
  for (const [i, unit] of units.entries()) if (isConsonant(unit) && unit.schwa === 0 && i === units.length - 1 && unit.roman === 'y' && isText(units[i - 1], 'ी')) unit.schwa = 1;
  for (const unit of units) if (isConsonant(unit) && unit.schwa === 0 && unit === units.at(-1) && unit.afterHalant && ['र','य','व'].includes(unit.runes[0])) unit.schwa = 1;
  for (const [i, unit] of units.entries()) {
    const next = units[i + 1], after = units[i + 2];
    if (isConsonant(unit) && unit.schwa === 0 && i > 0 && !unit.afterHalant && unit.run && unit.run.deletedAt < 0
      && isConsonant(next) && after && (after.kind === 'vowel' || after.kind === 'modifier')) decide(unit, true);
  }
  for (const [i, unit] of units.entries()) {
    const initialConjunct = i === 1 && units[0]?.kind === 'consonant' || i === 2 && units[0]?.kind === 'vowel'
      && units[1]?.kind === 'consonant' && units[0].runes.length === 1 && units[0].text >= 'अ' && units[0].text <= 'औ';
    if (isConsonant(unit) && unit.schwa === 0 && !(unit.afterHalant && initialConjunct) && unit.start === 1
      && (!unit.run || unit.run.deletedAt < 0) && isConsonant(units[i + 1]) && isConsonant(units[i + 2])
      && !units.slice(i + 3).some(u => u.kind === 'vowel')) decide(unit, true);
  }
  for (const [i, unit] of units.entries()) if (isConsonant(unit) && unit.schwa === 0 && i > 0 && units[i - 1]?.kind === 'vowel'
    && !isText(units[i - 1], 'ा') && (!unit.run || unit.run.deletedAt < 0) && isConsonant(units[i + 1])
    && isConsonant(units[i + 2]) && !units[i + 2].afterHalant && i + 2 === units.length - 1) decide(unit, true);
  for (const unit of units) if (isConsonant(unit) && unit.schwa === 0) unit.schwa = unit === units.at(-1) ? 2 : 1;
}

function applySounds(word: Word): void {
  const units = word.units;
  for (const [i, unit] of units.entries()) if (unit.roman === 'f' && isText(unit, 'फ') && units[i + 1]?.kind === 'vowel' && isText(units[i + 1], 'ू')) unit.roman = 'ph';
  for (const [i, unit] of units.entries()) if (unit.roman === 'v' && unit.afterHalant && ['s','sh','d','kh'].includes(units[i - 1]?.roman)) unit.roman = 'w';
  for (const [i, unit] of units.entries()) if (unit.roman === 'v' && i === 0 && units[1]?.kind === 'vowel' && isText(units[1], 'ा') && isConsonant(units[2]) && ['ल','ळ'].includes(units[2].runes[0])) unit.roman = 'w';
  for (const [i, unit] of units.entries()) if (unit.roman === 'v' && i > 0 && units[i + 1]?.kind === 'vowel' && units[i + 1].runes.length === 1
    && !['ि','ी','े','ै'].includes(units[i + 1].text) && !(units[i - 1]?.kind === 'vowel' && units[i - 2]?.runes[0] === 'व')) unit.roman = 'w';
  for (const [i, unit] of units.entries()) if (unit.kind === 'vowel' && isText(unit, 'ए') && units[i - 1]?.kind === 'vowel' && isText(units[i - 1], 'ि')) unit.roman = 'ye';
  for (const [i, unit] of units.entries()) if (unit.kind === 'vowel' && isText(unit, 'ा')) {
    const next = units[i + 1], after = units[i + 2];
    if (isConsonant(next) && i + 1 === units.length - 1 || next?.kind === 'modifier'
      && !(isText(next, 'ं') && isConsonant(after) && after.runes[0] === 'व')
      && (i + 1 === units.length - 1 || isConsonant(after) && i + 2 === units.length - 1)) unit.roman = 'aa';
  }
}

function applyRender(word: Word): void {
  const units = word.units, last = units.at(-1), before = units.at(-2);
  if (last?.kind === 'modifier' && isText(last, 'ं') && before?.kind === 'vowel' && isText(before, 'ा') && units.filter(u => u.kind === 'consonant').length <= 1) last.roman = '';
  if (last?.kind === 'modifier' && isText(last, 'ँ') && word.original === 'माँ') last.roman = '';
  if (last?.kind === 'modifier' && isText(last, 'ं') && before?.kind === 'vowel' && isText(before, 'े')) last.roman = 'in';
  for (const [i, unit] of units.entries()) if (unit.kind === 'modifier' && isText(unit, 'ं') && isConsonant(units[i + 1]) && ['p','b','bh','m','ph'].includes(units[i + 1].roman)) unit.roman = 'm';
  for (const [i, unit] of units.entries()) if (unit.kind === 'modifier' && isText(unit, 'ं') && units[i - 1]?.kind === 'vowel' && isText(units[i - 1], 'ा')
    && isConsonant(units[i + 1]) && units[i + 1].runes[0] === 'व' && i + 1 === units.length - 1) {unit.roman = 'on'; units[i + 1].roman = '';}
}

function candidate(input: string, tree: TreeNode, learned: boolean): string {
  const word = parse(input);
  applySchwa(word, tree, learned); applySounds(word); applyRender(word);
  return word.units.map((unit, i) => {
    if (!isConsonant(unit)) return unit.roman;
    const next = word.units[i + 1];
    if (next?.kind === 'vowel') return unit.roman + (next.matra || ['अ','ऄ'].includes(next.text) ? '' : 'a');
    if (next?.afterHalant) return unit.roman;
    return unit.roman + (unit.schwa === 2 ? '' : 'a');
  }).join('');
}

function readTsv(source: string): Map<string, string> {
  const output = new Map<string, string>();
  for (const raw of source.split('\n')) {const line = raw.replace(/\r+$/u, ''), tab = line.indexOf('\t'); if (tab > 0 && tab < line.length - 1) output.set(line.slice(0, tab), line.slice(tab + 1));}
  return output;
}

/** 将已通过 SHA-256 验证的纯数据解析为同步转换器；候选排序严格遵守原 Go 的 UTF-8 字节语义及平分保持首项。 */
export function createHindiEngine(data: HindiEngineData): (text: string) => string {
  const lexicon = readTsv(data.lexiconTsv), counts = new Map<string, number>(), tree = parseTree(data.schwaTreeJson);
  let total = 0;
  for (const [gram, count] of readTsv(data.romanNgramsTsv)) if (/^[0-9]+$/u.test(count) && Number(count) > 0) {
    counts.set(gram, Number(count)); if (new TextEncoder().encode(gram).length === 1) total += Number(count);
  }
  if (!lexicon.size || !counts.size || !total) throw new Error('Hindi lexicon data is invalid');
  const score = (text: string) => {
    // Go strings.ToLower performs simple Unicode casing (not the expanding İ -> i + combining-dot mapping).
    const lower = Array.from(text, char => char === 'İ' ? 'i' : char.toLowerCase()).join('');
    const bytes = Array.from(new TextEncoder().encode('^' + lower + '$'), byte => String.fromCharCode(byte)).join('');
    let sum = 0;
    for (let i = 1; i < bytes.length; i++) {
      let penalty = 1, found = false;
      for (let order = 4; order >= 1; order--) {
        const start = i - order + 1; if (start < 0) continue;
        const denominator = order === 1 ? total : counts.get(bytes.slice(start, i)) || 0;
        const numerator = counts.get(bytes.slice(start, i + 1)) || 0;
        if (denominator > 0 && numerator > 0) {sum += Math.log(penalty * numerator / denominator); found = true; break;}
        penalty *= 0.4;
      }
      if (!found) sum += Math.log(penalty / (total + 1));
    }
    return sum / (bytes.length - 1);
  };
  const romanizeWord = (word: string) => {
    const known = lexicon.get(word); if (known !== undefined) return known;
    const first = candidate(word, tree, false), second = candidate(word, tree, true);
    return second !== first && score(second) > score(first) ? second : first;
  };
  return text => text.replace(/[^\p{White_Space}\p{P}]+/gu, romanizeWord);
}
