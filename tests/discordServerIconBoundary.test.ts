import {parseHTML} from 'linkedom';
import {describe, expect, it} from 'vitest';

import {createTranslationSourceSnapshot} from '@/src/core/translation/public';
import {createTranslationCore} from './helpers/translationCore';
import {builtinSiteRulePack} from '@/src/core/site-adaptation/catalog';
import {composeSiteAdapters} from '@/src/core/site-adaptation/compiler';

const discordUrl = new URL('https://discord.com/channels/@me');

function createDiscordDocument() {
    const {document} = parseHTML(`<html><body>
        <div id="app-mount">
            <nav aria-label="Servers sidebar">
                <ul role="tree" data-list-id="guildsnav">
                    <li data-item-id="guild-1"><span id="server-icon">Reading Community</span></li>
                    <li data-item-id="guild-2"><img id="server-image" alt="Community icon" src="/icon.png"></li>
                </ul>
            </nav>
            <nav id="friends-nav"><span id="friend-label">Friends and activity</span></nav>
            <div id="message-content-1"><p id="message">Please read the project update before our next meeting.</p></div>
        </div>
    </body></html>`);
    return document;
}

describe('Issue #124: Discord server icons changed during full-page translation', () => {
    it.each(['content', 'all'] as const)('keeps the server rail outside %s translation candidates', scope => {
        const document = createDiscordDocument();
        const core = createTranslationCore({url: discordUrl, scope});
        const rail = document.querySelector('[data-list-id="guildsnav"]')!;
        const icon = document.querySelector('#server-icon')!;
        const message = document.querySelector('#message')!;
        const candidates = core.discover(document);

        expect(core.resolve(icon.firstChild)).toBeNull();
        expect(candidates.some(candidate => rail.contains(candidate.element))).toBe(false);
        expect(candidates.some(candidate => candidate.element === message)).toBe(true);
        if (scope === 'all') {
            expect(core.resolve(document.querySelector('#friend-label')!.firstChild)).not.toBeNull();
        }
        const snapshot = createTranslationSourceSnapshot(document.querySelector('#app-mount')!, core.shouldStayOriginal);
        expect(snapshot.slots.map(slot => slot.source).join(' ')).not.toContain('Reading Community');
        expect(icon.textContent).toBe('Reading Community');
        expect(document.querySelector('#server-image')?.getAttribute('src')).toBe('/icon.png');
    });

    it('keeps protection local to Discord channels and honors a disabled site rule', () => {
        const document = createDiscordDocument();
        const icon = document.querySelector('#server-icon')!;
        const outside = createTranslationCore({url: new URL('https://example.test/channels/@me'), scope: 'all'});
        const otherRoute = createTranslationCore({url: new URL('https://discord.com/activities'), scope: 'all'});
        const disabled = createTranslationCore({
            url: discordUrl,
            scope: 'all',
            adapters: composeSiteAdapters(builtinSiteRulePack, {
                enabled: true,
                disabledRuleIds: ['discord-server-rail'],
                custom: {version: 1, rules: []},
            }),
        });
        expect(outside.resolve(icon.firstChild)).not.toBeNull();
        expect(otherRoute.resolve(icon.firstChild)).not.toBeNull();
        expect(disabled.resolve(icon.firstChild)).not.toBeNull();
    });

    it('recognizes both the guild list and its enclosing navigation landmark', () => {
        const document = createDiscordDocument();
        const icon = document.querySelector('#server-icon')!;
        const nav = document.querySelector('nav[aria-label="Servers sidebar"]')!;
        const list = document.querySelector('[data-list-id="guildsnav"]')!;
        const core = createTranslationCore({url: discordUrl, scope: 'all'});

        nav.removeAttribute('aria-label');
        expect(core.resolve(icon.firstChild)).toBeNull();
        nav.setAttribute('aria-label', 'Servers sidebar');
        list.removeAttribute('data-list-id');
        expect(core.resolve(icon.firstChild)).toBeNull();
    });
});
