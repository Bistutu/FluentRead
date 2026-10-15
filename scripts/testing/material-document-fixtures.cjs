/**
 * @file scripts/testing/material-document-fixtures.cjs
 * 文件职责：为材料工作区生产验收生成有效 Word 与 ePub 原文件，并通过真实文档界面验证连续阅读。
 * 主要内容：九十段 DOCX 的第二页、双章节 ePub 的第二章，覆盖导入、主动加入材料、位置持久化和新页面恢复后的原文 DOM 与截图。
 * 模块边界：只使用调用方已经隔离的页面与后台协议，不启动浏览器、不直接写数据库、不调用供应商、不修改生产源码。
 */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const {createRequire} = require('node:module');
const JSZip = createRequire(path.resolve(__dirname, '../../package.json'))('jszip');

const DOCX_FILE = 'material-docx-page-resume.docx';
const EPUB_FILE = 'material-epub-chapter-resume.epub';
const docxParagraph = number => `Material DOCX paragraph ${String(number).padStart(3, '0')}: a unique original passage keeps the reading position connected to this document.`;
const chapterTitle = number => `Material chapter ${number}: ${number === 1 ? 'Finding the source' : 'Returning to the source'}`;
const epubParagraph = number => `EPUB chapter ${number} original passage: ${number === 1 ? 'This first chapter introduces the question and must not appear after restoring chapter two.' : 'This second chapter contains the exact passage that must return with its saved material.'}`;

async function writeDocuments(artifacts) {
    await fs.mkdir(artifacts, {recursive: true});
    const docx = new JSZip();
    docx.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
    docx.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
    docx.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${Array.from({length: 90}, (_, index) => `<w:p><w:r><w:t>${docxParagraph(index + 1)}</w:t></w:r></w:p>`).join('')}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body></w:document>`);
    const epub = new JSZip();
    epub.file('mimetype', 'application/epub+zip', {compression: 'STORE'});
    epub.file('META-INF/container.xml', '<?xml version="1.0" encoding="UTF-8"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>');
    epub.file('OEBPS/content.opf', '<?xml version="1.0" encoding="UTF-8"?><package xmlns="http://www.idpf.org/2007/opf" version="2.0" unique-identifier="BookId"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="BookId">urn:uuid:4f662fe8-cbf2-45fd-98d5-75214853abf2</dc:identifier><dc:title>Material chapter resume fixture</dc:title><dc:language>en</dc:language><dc:creator>FluentRead deterministic fixture</dc:creator></metadata><manifest><item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/><item id="chapter1" href="chapter1.xhtml" media-type="application/xhtml+xml"/><item id="chapter2" href="chapter2.xhtml" media-type="application/xhtml+xml"/></manifest><spine toc="ncx"><itemref idref="chapter1"/><itemref idref="chapter2"/></spine></package>');
    epub.file('OEBPS/toc.ncx', `<?xml version="1.0" encoding="UTF-8"?><ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1"><head><meta name="dtb:uid" content="urn:uuid:4f662fe8-cbf2-45fd-98d5-75214853abf2"/><meta name="dtb:depth" content="1"/><meta name="dtb:totalPageCount" content="0"/><meta name="dtb:maxPageNumber" content="0"/></head><docTitle><text>Material chapter resume fixture</text></docTitle><navMap>${[1, 2].map(number => `<navPoint id="chapter${number}" playOrder="${number}"><navLabel><text>${chapterTitle(number)}</text></navLabel><content src="chapter${number}.xhtml"/></navPoint>`).join('')}</navMap></ncx>`);
    for (const number of [1, 2]) epub.file(`OEBPS/chapter${number}.xhtml`, `<?xml version="1.0" encoding="UTF-8"?><html xmlns="http://www.w3.org/1999/xhtml" xml:lang="en"><head><title>${chapterTitle(number)}</title></head><body><h1>${chapterTitle(number)}</h1><p>${epubParagraph(number)}</p><p>Chapter ${number} closing sentence: the material keeps its own original context.</p></body></html>`);
    const docxPath = path.join(artifacts, DOCX_FILE), epubPath = path.join(artifacts, EPUB_FILE);
    await fs.writeFile(docxPath, await docx.generateAsync({type: 'nodebuffer', compression: 'DEFLATE'}));
    await fs.writeFile(epubPath, await epub.generateAsync({type: 'nodebuffer', compression: 'DEFLATE'}));
    return {docxPath, epubPath};
}

async function assertMaterialControl(page, format, report) {
    const measurement = await page.locator('.material-save-button').evaluate(button => {
        const rect = button.getBoundingClientRect(), hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
        return {x: rect.x, y: rect.y, width: rect.width, height: rect.height, viewportWidth: innerWidth, viewportHeight: innerHeight, unobscured: hit === button || button.contains(hit)};
    });
    assert(measurement.width <= 180 && measurement.height >= 24 && measurement.x >= 0 && measurement.y >= 0 && measurement.x + measurement.width <= measurement.viewportWidth && measurement.y + measurement.height <= measurement.viewportHeight && measurement.unobscured, `${format}: material button must be fully visible and unobscured: ${JSON.stringify(measurement)}`);
    (report.materialControlMeasurements ||= []).push({format, ...measurement});
}

async function runMaterialDocumentFixtures({open, origin, message, waitRecord, shot, artifacts, report}) {
    const {docxPath, epubPath} = await writeDocuments(artifacts);
    report.materialDocumentFixtures ||= [];
    const importMaterial = async (filePath, format) => {
        const page = await open(`${origin}/document.html`);
        await page.locator('input[type=file]').first().setInputFiles(filePath);
        await page.locator(`[data-document-reader="${format === 'docx' ? 'docx' : 'rich'}"]`).waitFor({state: 'visible', timeout: 30000});
        const add = page.getByRole('button', {name: '加入学习材料', exact: true});
        await add.waitFor({state: 'visible', timeout: 30000});
        await assertMaterialControl(page,format,report);
        await add.click();
        await page.getByRole('button', {name: '更新学习位置', exact: true}).waitFor({timeout: 15000});
        const matches = (await message({action: 'list'})).filter(record => record.kind === 'document' && record.source.title === path.basename(filePath));
        assert.equal(matches.length, 1, `${format}: the imported original must map to exactly one material`);
        const record = matches[0];
        assert(record.source.fingerprint, `${format}: the material must retain the original file fingerprint`);
        assert.equal(await page.locator('.reading-content').getAttribute('data-fluentread-material-fingerprint'), record.source.fingerprint);
        return {page, record};
    };
    const assertDocxPageTwo = async page => {
        await page.waitForFunction(({first, last}) => {
            const reader = document.querySelector('.reading-content');
            const rows = Array.from(document.querySelectorAll('[data-document-reader="docx"] .docx-source')).map(node => node.textContent.trim());
            return reader?.dataset.fluentreadMaterialPage === '2' && reader.dataset.fluentreadMaterialSection === 'docx:0'
                && rows.length === 10 && rows[0] === first && rows[9] === last;
        }, {first: docxParagraph(81), last: docxParagraph(90)}, {timeout: 15000});
        assert.match(await page.getByRole('navigation', {name: '文档阅读分页', exact: true}).innerText(), /第\s*2\s*\/\s*2\s*页/u);
        assert.equal(await page.locator('.docx-source').filter({hasText: docxParagraph(1)}).count(), 0, 'DOCX restore must exclude first-page paragraphs');
    };
    const {page: docxPage, record: docxRecord} = await importMaterial(docxPath, 'docx');
    assert.equal(await docxPage.locator('.docx-source').count(), 80, 'DOCX fixture must occupy two native reader pages');
    assert.equal((await docxPage.locator('.docx-source').first().innerText()).trim(), docxParagraph(1));
    await docxPage.getByRole('navigation', {name: '文档阅读分页', exact: true}).getByRole('button', {name: '下一页', exact: true}).click();
    await assertDocxPageTwo(docxPage);
    const savedDocx = await waitRecord(docxRecord.id, record => record?.locator?.page === 2 && record.locator.section === 'docx:0' && record.locator.quote === docxParagraph(81));
    await shot('material-docx-saved-page-2', docxPage);
    await docxPage.close();
    const resumedDocx = await open(`${origin}/document.html?__fluentread_material=${encodeURIComponent(docxRecord.id)}`);
    await resumedDocx.getByRole('button', {name: '更新学习位置', exact: true}).waitFor({timeout: 30000});
    await assertDocxPageTwo(resumedDocx);
    assert.equal(await resumedDocx.locator('.reading-content').getAttribute('data-fluentread-material-fingerprint'), savedDocx.source.fingerprint);
    await shot('material-docx-resumed-page-2', resumedDocx);
    report.cases.push('real-docx-page-2-native-dom-and-fingerprint-resume');
    report.materialDocumentFixtures.push({format: 'docx', file: docxPath, materialId: docxRecord.id, fingerprint: savedDocx.source.fingerprint, page: 2, section: 'docx:0', firstOriginal: docxParagraph(81), lastOriginal: docxParagraph(90), visibleOriginalParagraphs: 10});
    await resumedDocx.setViewportSize({width:390,height:1000});assert.equal(await resumedDocx.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);const narrowDocxButton=await resumedDocx.getByRole('button',{name:'更新学习位置',exact:true}).boundingBox();assert(narrowDocxButton&&narrowDocxButton.width<=180&&narrowDocxButton.x>=0&&narrowDocxButton.x+narrowDocxButton.width<=390);await assertMaterialControl(resumedDocx,'docx',report);await shot('material-docx-390',resumedDocx);
    await resumedDocx.close();

    const assertEpubChapterTwo = async page => {
        await page.waitForFunction(({heading, original, excluded}) => {
            const reader = document.querySelector('.reading-content');
            const body = document.querySelector('iframe.rich-preview-frame')?.contentDocument?.body;
            const current = document.querySelector('.document-outline-item.chapter[aria-current="location"]');
            const text = body?.textContent || '';
            return reader?.dataset.fluentreadMaterialSection === 'epub:1' && reader.dataset.fluentreadMaterialPage === '1'
                && current?.textContent.trim() === heading && body?.querySelector('h1')?.textContent.trim() === heading
                && text.includes(original) && !text.includes(excluded);
        }, {heading: chapterTitle(2), original: epubParagraph(2), excluded: epubParagraph(1)}, {timeout: 15000});
    };
    const {page: epubPage, record: epubRecord} = await importMaterial(epubPath, 'epub');
    await epubPage.waitForFunction(original => document.querySelector('iframe.rich-preview-frame')?.contentDocument?.body?.textContent.includes(original), epubParagraph(1), {timeout: 15000});
    const sidebar = epubPage.locator('.sidebar-toggle');
    if (await sidebar.getAttribute('aria-expanded') !== 'true') await sidebar.click();
    await epubPage.getByRole('tab', {name: '目录', exact: true}).click();
    assert.equal(await epubPage.locator('.document-outline-item.chapter').count(), 2, 'EPUB fixture must expose both original chapters');
    await epubPage.locator('.document-outline-item.chapter').filter({hasText: chapterTitle(2)}).click();
    await assertEpubChapterTwo(epubPage);
    const savedEpub = await waitRecord(epubRecord.id, record => record?.locator?.section === 'epub:1' && record.locator.page === 1 && record.locator.quote === chapterTitle(2));
    await shot('material-epub-saved-chapter-2', epubPage);
    await epubPage.close();
    const resumedEpub = await open(`${origin}/document.html?__fluentread_material=${encodeURIComponent(epubRecord.id)}`);
    await resumedEpub.getByRole('button', {name: '更新学习位置', exact: true}).waitFor({timeout: 30000});
    await assertEpubChapterTwo(resumedEpub);
    assert.equal(await resumedEpub.locator('.reading-content').getAttribute('data-fluentread-material-fingerprint'), savedEpub.source.fingerprint);
    await shot('material-epub-resumed-chapter-2', resumedEpub);
    report.cases.push('real-epub-chapter-2-original-dom-and-fingerprint-resume');
    report.materialDocumentFixtures.push({format: 'epub', file: epubPath, materialId: epubRecord.id, fingerprint: savedEpub.source.fingerprint, page: 1, section: 'epub:1', originalHeading: chapterTitle(2), originalPassage: epubParagraph(2)});
    await resumedEpub.setViewportSize({width:390,height:1000});assert.equal(await resumedEpub.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);const narrowEpubButton=await resumedEpub.getByRole('button',{name:'更新学习位置',exact:true}).boundingBox();assert(narrowEpubButton&&narrowEpubButton.width<=180&&narrowEpubButton.x>=0&&narrowEpubButton.x+narrowEpubButton.width<=390);await assertMaterialControl(resumedEpub,'epub',report);await shot('material-epub-390',resumedEpub);
    await resumedEpub.close();
    return report.materialDocumentFixtures;
}
module.exports = {runMaterialDocumentFixtures, assertMaterialControl};
