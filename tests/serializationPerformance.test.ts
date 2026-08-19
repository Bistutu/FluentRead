import {parseHTML} from 'linkedom';
import {describe, expect, it} from 'vitest';

import {
    applyTranslationsToSnapshot,
    createTranslationSourceSnapshot,
} from '@/entrypoints/translation-core/public';

describe('translation snapshot mapping performance', () => {
    it('maps a large flat candidate with linear tree-walker work and no sibling path scans', () => {
        const {document} = parseHTML('<html><body><div id="target"></div></body></html>');
        const target = document.querySelector('#target') as HTMLElement;
        const slotCount = 4000;
        for (let index = 0; index < slotCount; index += 1) {
            const span = document.createElement('span');
            span.appendChild(document.createTextNode(`  Source ${index}  `));
            target.appendChild(span);
        }

        const code = document.createElement('code');
        code.textContent = 'PROTECTED_CODE';
        target.appendChild(code);
        const noTranslate = document.createElement('span');
        noTranslate.setAttribute('translate', 'no');
        noTranslate.textContent = 'PROTECTED_LABEL';
        target.appendChild(noTranslate);
        const artifact = document.createElement('span');
        artifact.className = 'fluent-read-bilingual-content';
        artifact.textContent = 'OLD_TRANSLATION';
        target.appendChild(artifact);

        const originalCreateTreeWalker = document.createTreeWalker.bind(document);
        const originalIndexOf = Array.prototype.indexOf;
        let treeWalkerSteps = 0;
        let siblingPathScans = 0;
        document.createTreeWalker = ((...args: Parameters<Document['createTreeWalker']>) => {
            const walker = originalCreateTreeWalker(...args);
            const nextNode = walker.nextNode.bind(walker);
            walker.nextNode = () => {
                treeWalkerSteps += 1;
                return nextNode();
            };
            return walker;
        }) as Document['createTreeWalker'];
        Array.prototype.indexOf = function instrumentedIndexOf(...args: Parameters<typeof originalIndexOf>) {
            if (this?.constructor?.name === 'NodeList') siblingPathScans += 1;
            return originalIndexOf.apply(this, args);
        };

        let snapshot: ReturnType<typeof createTranslationSourceSnapshot>;
        try {
            snapshot = createTranslationSourceSnapshot(target);
        } finally {
            document.createTreeWalker = originalCreateTreeWalker;
            Array.prototype.indexOf = originalIndexOf;
        }

        const totalTextNodes = slotCount + 3;
        expect(treeWalkerSteps).toBe((totalTextNodes + 1) * 2);
        expect(siblingPathScans).toBe(0);
        expect(snapshot.slots).toHaveLength(slotCount);
        expect(snapshot.slots[0]).toMatchObject({prefix: '  ', source: 'Source 0', suffix: '  '});
        expect(snapshot.slots.at(-1)).toMatchObject({source: `Source ${slotCount - 1}`});
        expect(snapshot.slots[0]?.node).not.toBe(target.querySelector('span')?.firstChild);
        expect(snapshot.clone.querySelector('code')?.textContent).toBe('PROTECTED_CODE');
        expect(snapshot.clone.querySelector('[translate="no"]')?.textContent).toBe('PROTECTED_LABEL');
        expect(snapshot.clone.querySelector('.fluent-read-bilingual-content')).toBeNull();

        const rendered = applyTranslationsToSnapshot(
            snapshot,
            snapshot.slots.map((_, index) => `Translated ${index}`),
        );
        expect(rendered).toContain('  Translated 0  ');
        expect(rendered).toContain(`  Translated ${slotCount - 1}  `);
        expect(target.querySelector('span')?.textContent).toBe('  Source 0  ');
    });
});
