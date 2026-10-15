'use strict';

/**
 * @file scripts/testing/pdf-output-pages.cjs
 * 文件职责：为 PDF 实际下载验收按标准页标签区分原版页和完整译文续页。
 * 主要内容：原版页必须逐源页出现一次，续页必须紧跟所属源页且编号连续；旧端口无标签时仍要求严格的一对一页数，不用宽松子序列掩盖丢页或多页。
 * 模块边界：纯验证辅助，不生成文件、不修改产品、不启动浏览器；尺寸、正文指纹和全文保全仍由调用套件独立验证。
 */
function mapPdfLayoutPages(sourceCount, output) {
  if (!output.some(page => page.label != null)) return {ok: output.length === sourceCount,
    pages: output.slice(0, sourceCount), indices: Array.from({length: sourceCount}, (_, index) => index), continuations: [], labelled: false};
  const pages = [], indices = [], continuations = [];
  let source = 0, continuation = 0, ok = true;
  output.forEach((page, index) => {
    if (page.label === String(source + 1)) {
      source++; continuation = 0; pages.push(page); indices.push(index);
    } else if (source > 0 && page.label === `${source} · 译文续页 ${continuation + 1}`) {
      continuation++; continuations.push({index, sourcePage: source, continuation});
    } else ok = false;
  });
  return {ok: ok && source === sourceCount, pages, indices, continuations, labelled: true};
}

module.exports = {mapPdfLayoutPages};
