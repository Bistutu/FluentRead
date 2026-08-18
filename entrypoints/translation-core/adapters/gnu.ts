import {createDeclarativeAdapter} from './declarative';

/** Texinfo HTML uses plain divs for its previous/next navigation panel. */
export const gnuManualAdapter = createDeclarativeAdapter({
    id: 'gnu-manual',
    priority: 360,
    hosts: [{hostname: 'gnu.org', includeSubdomains: true}],
    prune: [
        {
            selector: '.nav-panel',
            reason: 'gnu-manual-navigation',
        },
    ],
    targets: [
        {
            selector: [
                '.section-level-extent > p',
                '.chapter-level-extent > p',
                '.subsection-level-extent > p',
            ],
            reason: 'gnu-manual-prose',
            match: 'closest',
        },
    ],
});

export default gnuManualAdapter;
