import {createDeclarativeAdapter} from './declarative';

export const redditAdapter = createDeclarativeAdapter({
    id: 'reddit',
    priority: 390,
    hosts: [
        {hostname: 'reddit.com', includeSubdomains: true},
        {hostname: 'redd.it', includeSubdomains: true},
    ],
    prune: [
        {
            selector: ['reddit-composer', '[data-testid="comment-submission-form"]'],
            reason: 'reddit-composer',
        },
    ],
    targets: [
        {
            selector: ['shreddit-post [slot="title"]', 'h1[id^="post-title-"]'],
            reason: 'reddit-post-title',
            match: 'closest',
            atomic: true,
        },
        {
            selector: [
                'shreddit-post [slot="text-body"] p',
                '[data-testid="post-content"] p',
                '[data-click-id="text"] p',
            ],
            reason: 'reddit-post-prose',
            match: 'closest',
        },
        {
            selector: [
                'shreddit-comment [slot="comment"] p',
                '[data-testid="comment"] p',
            ],
            reason: 'reddit-comment-prose',
            match: 'closest',
        },
    ],
    keepOriginal: [
        {
            selector: ['faceplate-timeago', '[data-testid="post_timestamp"]', '[data-testid="vote-arrows"]'],
            reason: 'reddit-dynamic-metadata',
        },
    ],
    mutationExclude: [
        {
            selector: [
                'faceplate-timeago',
                '[data-testid="post_timestamp"]',
                '[data-testid="vote-arrows"]',
                'shreddit-status',
                '[aria-live]',
            ],
            reason: 'reddit-controlled-mutation',
        },
    ],
});
