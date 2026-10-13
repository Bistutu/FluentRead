/**
 * Unicode compatibility regression quotation from Yifan Shi, Wei Zhang and Tianyi Cui,
 * "A Programming Paradigm for Spatiotemporal Composability", arXiv:2608.25512v1,
 * https://arxiv.org/abs/2608.25512v1 (actual parsed id596).
 * This short unchanged test quotation is not part of the product or covered by FluentRead's source license.
 * Source lists arXiv's non-exclusive distribution license: https://arxiv.org/licenses/nonexclusive-distrib/1.0/.
 * UTF-8 SHA-256 fa77f916a1840cdb4c782068bff30d7d48658c4ace8b9383993aa5a03dbf0e49.
 */
import {findDocumentLiteralTerms} from '@/src/core/translation/documentLiterals';
import {protectGlossaryText, type GlossaryProtectedMatch} from '@/src/core/glossary/protection';
export const documentLongMathParagraph = "(2) Here 𝑝𝑚 ∩ (𝑑𝑛 ∪ 𝑝𝑛) = ⌀ and some 𝑘 ∈ 𝑝𝑛 ∩ 𝑑𝑚. Ψ𝑡 is one of 𝑚’s iterations or the accumulator 𝑔𝑚𝑡, in either case a composite of the maps Definition 56 admits for 𝑚: lifts of operation maps, forward or inverse, at keys of 𝑑𝑚 ∪ 𝑝𝑚, extensions and restrictions at keys of 𝑝𝑚, instantiations, and the O-Retires those yield. The constituents of 𝑔𝑛𝑡 are the inverses Definition 56 admits for 𝑛: lifts of operation inverses at keys of 𝑑𝑛 ∪ 𝑝𝑛, restrictions at keys of 𝑝𝑛, and O-Retires. Commute the constituents of Ψ𝑡 past those of 𝑔𝑛𝑡 one pair at a time. A pair at distinct keys is a pair of keylocal maps and commutes; an instantiation or an O-Retire writes a fresh entry or a control field, which no table map reads, and commutes with every constituent in sight; a pair of operation maps at one shared key is covered by that key’s commutativity, which the witness of its coeffect supplies (Definition 46), read at the tables through the lift of Definition 56. What remains is an operation map of 𝑚 at a key 𝑘 ∈ 𝑝𝑛 ∩ 𝑑𝑚 against the extension or restriction of 𝑛 at 𝑘. Such a map exists in Ψ𝑡 only under a committed view of 𝑚 resolving 𝑘 (Lemma 59(2)), whose L- Begin required an 𝖠𝖼𝗍𝗂𝗏𝖾 provider of 𝑘; the commitment pins that provider for as long as 𝑚 is installed, by the argument of (1) read at 𝑚, and two registered provisions cannot share 𝑘, so the provider is 𝑛 and 𝑛 was 𝖠𝖼𝗍𝗂𝗏𝖾 within the open episode. Its transition had therefore finished by 𝑡, and 𝑔𝑛𝑡 carries the restriction at 𝑘 the extension 𝑚 resolved yielded, composed to the left of 𝑛’s operation inverses at 𝑘 by the LIFO order of Definition 18. On one side the operation map of 𝑚 commutes leftward, past constituents at other keys and, by commutativity of 𝑘, past 𝑛’s operation inverses at 𝑘, until the restriction absorbs it, a write to the value at 𝑘 followed by the removal of 𝑘 being the removal alone; on the other side it meets a state 𝑔𝑛𝑡 has removed 𝑘 from and produces no transition. Both composites therefore agree at 𝛾𝑡.";
/** 分块边界故意使用逐次字面值标记，包含集合运算符；不受文档表达式合并或用户词库影响。 */
export const protectedDocumentLongMathParagraph = () => {
    const matches: GlossaryProtectedMatch[] = [];
    const packet = protectGlossaryText(documentLongMathParagraph, findDocumentLiteralTerms(documentLongMathParagraph), '0', [], match => {matches.push(match);});
    return {...packet, matches};
};
