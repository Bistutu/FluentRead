/**
 * @file src/features/video-subtitle/reading/writtenTransliteration.ts
 * 文件职责：为俄语、现代希腊语与阿拉伯语提供本地拉丁字母标注。
 * 主要内容：俄语保留大小写、软硬音符及已有重音；现代希腊语处理双字母、清浊组合及已有重音；阿拉伯语只转换已写出的元音和显式双辅音，不猜测缺失短元音。
 * 模块边界：纯字符串规则，无词典、DOM 或网络；规则参考 Unicode CLDR 文字映射，来源及 Unicode 许可保留于 public/third-party-notices/reading-annotation-NOTICE.md。
 */
const russian = Object.fromEntries([...('абвгдеёжзийклмнопрстуфхцчшщъыьэюя')].map((key,index) => [key, ['a','b','v','g','d','e','ë','ž','z','i','j','k','l','m','n','o','p','r','s','t','u','f','h','c','č','š','šč','ʺ','y','ʹ','è','ju','ja'][index]]));
const greek: Record<string,string> = {α:'a',β:'v',γ:'g',δ:'d',ε:'e',ζ:'z',η:'i',θ:'th',ι:'i',κ:'k',λ:'l',μ:'m',ν:'n',ξ:'x',ο:'o',π:'p',ρ:'r',σ:'s',ς:'s',τ:'t',υ:'i',φ:'f',χ:'ch',ψ:'ps',ω:'o'};
const arabic: Record<string,string> = {'ء':'ʾ','آ':'ʾā','أ':'ʾ','إ':'ʾ','ؤ':'ʾ','ئ':'ʾ','ا':'ā','ب':'b','ت':'t','ث':'ṯ','ج':'ǧ','ح':'ḥ','خ':'ḫ','د':'d','ذ':'ḏ','ر':'r','ز':'z','س':'s','ش':'š','ص':'ṣ','ض':'ḍ','ط':'ṭ','ظ':'ẓ','ع':'ʿ','غ':'ġ','ف':'f','ق':'q','ك':'k','ل':'l','م':'m','ن':'n','ه':'h','ة':'ẗ','و':'w','ي':'y','ى':'ā','َ':'a','ُ':'u','ِ':'i','ً':'an','ٌ':'un','ٍ':'in','ْ':'','ٰ':'ā','ـ':'','،':',','؛':';','؟':'?','٠':'0','١':'1','٢':'2','٣':'3','٤':'4','٥':'5','٦':'6','٧':'7','٨':'8','٩':'9'};
function cased(text: string, table: Record<string,string>, normalization: 'NFC'|'NFD' = 'NFD'): string {
  const allUppercase = text === text.toUpperCase();
  return [...text.normalize(normalization)].map(character => {
    const value = table[character.toLowerCase()];
    return character !== character.toLowerCase() ? allUppercase ? value.toUpperCase() : value.charAt(0).toUpperCase() + value.slice(1) : value;
  }).join('').normalize('NFC');
}
function greekWord(word: string): string {
  const letters = [...word.normalize('NFD').matchAll(/(\p{L})(\p{M}*)/gu)].map(match => ({base:match[1], marks:match[2]}));
  if (letters.length === 0) return word;
  const allUppercase = word === word.toUpperCase();
  let result = '';
  for (let i=0; i<letters.length; i++) {
    const current=letters[i];
    const next=letters[i+1];
    const pair=current.base.toLowerCase() + (next?.base.toLowerCase() || '');
    let value: string | undefined;
    let stress=current.marks.includes('\u0301');
    const pairedVowel = !current.marks && next && !next.marks.includes('\u0308');
    if (pairedVowel && ['αι','ει','οι','υι','ου'].includes(pair)) {
      value=pair==='αι' ? 'e' : pair==='ου' ? 'ou' : 'i';
      stress=next.marks.includes('\u0301');
      i++;
    } else if (pairedVowel && ['αυ','ευ','ηυ'].includes(pair)) {
      const following=letters[i+2]?.base.toLowerCase();
      value=(pair==='αυ' ? 'a' : pair==='ευ' ? 'e' : 'i') + (!following || /[θκξπστφχψ]/u.test(following) ? 'f' : 'v');
      stress=next.marks.includes('\u0301');
      i++;
    } else if (['μπ','ντ','γκ','γγ','γξ','γχ','τσ','τζ'].includes(pair)) {
      value=({μπ:i===0?'b':'mb',ντ:i===0?'d':'nd',γκ:i===0?'g':'ng',γγ:'ng',γξ:'nx',γχ:'nch',τσ:'ts',τζ:'tz'} as Record<string,string>)[pair];
      i++;
    } else {
      value=current.base.toLowerCase()==='γ' && /[εηιυ]/u.test(next?.base.toLowerCase() || '') ? 'y' : greek[current.base.toLowerCase()];
    }
    value ??= current.base;
    if (current.marks.includes('\u0308')) value+='\u0308';
    if (stress) value=value.replace(/([aeiou]\u0308?)/u, vowel => vowel+'\u0301');
    if (current.base!==current.base.toLowerCase()) value=allUppercase ? value.toUpperCase() : value.charAt(0).toUpperCase()+value.slice(1);
    result+=value;
  }
  return result.normalize('NFC');
}

export function transliterateWritten(text: string, language: 'ru'|'el'|'ar'): string {
  if (language === 'ru') return text.normalize('NFC').replace(/[А-Яа-яЁё]+/gu, word => cased(word, russian, 'NFC')).normalize('NFC');
  if (language === 'el') return text.replace(/[\p{Script=Greek}\p{M}]+/gu, greekWord);
  // presentation forms 归一化；双辅音只复制显式 shadda，不虚构省略的短元音。
  return text.normalize('NFKC').replace(/([\u0621-\u064a])([\u064b-\u0650]*)\u0651/gu, '$1$1$2')
    .replace(/ً[اى]/gu,'an').replace(/َا/gu,'ā').replace(/ُو/gu,'ū').replace(/ِي/gu,'ī')
    .split('').map(character => arabic[character] ?? character).join('').normalize('NFC');
}
