import {createDeclarativeAdapter} from './declarative';

export const hackerNewsAdapter = createDeclarativeAdapter({
    id: 'hacker-news',
    priority: 380,
    hosts: ['news.ycombinator.com'],
    targets: [
        {
            selector: '.titleline > a',
            reason: 'hacker-news-story-title',
            match: 'closest',
            atomic: true,
        },
        {
            selector: ['span.commtext', '.toptext'],
            reason: 'hacker-news-comment-prose',
            match: 'closest',
        },
    ],
    keepOriginal: [
        {
            selector: ['.rank', '.sitestr', '.score', '.hnuser', '.age', '.subtext', '.pagetop'],
            reason: 'hacker-news-metadata',
        },
    ],
    mutationExclude: [
        {
            selector: ['.age', '.score'],
            reason: 'hacker-news-dynamic-metadata',
        },
    ],
});

export default hackerNewsAdapter;
