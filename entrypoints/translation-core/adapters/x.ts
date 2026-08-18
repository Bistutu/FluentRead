import {createDeclarativeAdapter} from './declarative';

export const xAdapter = createDeclarativeAdapter({
    id: 'x',
    priority: 400,
    hosts: [
        {hostname: 'x.com', includeSubdomains: true},
        {hostname: 'twitter.com', includeSubdomains: true},
    ],
    prune: [
        {
            selector: [
                '[data-testid="tweetTextarea_0"]',
                '[data-testid="DMComposerTextInput"]',
            ],
            reason: 'x-composer',
        },
    ],
    targets: [
        {
            selector: '[data-testid="tweetText"]',
            reason: 'x-post-text',
            match: 'closest',
        },
        {
            selector: '[data-testid="UserDescription"]',
            reason: 'x-user-description',
            match: 'closest',
        },
        {
            selector: '[data-testid="twitterArticleReadView"] p',
            reason: 'x-article-prose',
            match: 'closest',
        },
    ],
    keepOriginal: [
        {
            selector: ['time', '[role="progressbar"]', '[data-testid="app-bar-back"]'],
            reason: 'x-dynamic-ui',
        },
    ],
});

export default xAdapter;
