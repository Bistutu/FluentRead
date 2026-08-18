import {createDeclarativeAdapter} from './declarative';

const markdownProseSelectors = [
    '.markdown-body p',
    '.markdown-body h1',
    '.markdown-body h2',
    '.markdown-body h3',
    '.markdown-body h4',
    '.markdown-body h5',
    '.markdown-body h6',
    '.markdown-body li',
    '.markdown-body blockquote',
    '.markdown-body figcaption',
    '.markdown-body summary',
    '.markdown-body dt',
    '.markdown-body dd',
    '.markdown-body th',
    '.markdown-body td',
] as const;

export const githubAdapter = createDeclarativeAdapter({
    id: 'github',
    priority: 500,
    hosts: [{hostname: 'github.com', includeSubdomains: false}],
    prune: [
        {
            selector: [
                'dialog',
                '[role="dialog"]',
                '[data-testid="search-modal"]',
                '[data-target="query-builder.queryBuilder"]',
                '[data-target="qbsearch-input.queryBuilder"]',
                '.js-command-palette-dialog',
                '#command-palette-pjax-container',
            ],
            reason: 'github-interactive-dialog',
        },
        {
            selector: [
                'form[role="search"]',
                '.js-site-search-form',
                'input[data-target="qbsearch-input.inputButton"]',
            ],
            reason: 'github-quick-search',
        },
    ],
    targets: [
        {
            selector: '.markdown-title',
            reason: 'github-markdown-title',
            match: 'closest',
            atomic: true,
        },
        {
            selector: [
                'h1.gh-header-title .js-issue-title',
                '[data-testid="issue-title"]',
                '[data-testid="pull-request-title"]',
                '[data-testid="issue-pr-title-link"]',
            ],
            reason: 'github-issue-or-pr-title',
            match: 'closest',
            atomic: true,
        },
        {
            selector: markdownProseSelectors,
            reason: 'github-markdown-prose',
            match: 'closest',
        },
        {
            selector: [
                '[itemprop="about"]',
                '[itemprop="description"]',
                '[data-testid="repository-description"]',
                '.repo-description p',
                '.repos-list-description',
                'p.f4.my-3',
            ],
            reason: 'github-repository-description',
            match: 'closest',
            atomic: true,
        },
    ],
    keepOriginal: [
        {
            selector: [
                '[aria-live]',
                '[role="status"]',
                '[role="alert"]',
                '[data-turbo-permanent]',
                '[data-turbo-temporary]',
                'relative-time',
                'time-ago',
                'local-time',
            ],
            reason: 'github-mutation-owned',
        },
    ],
    mutationExclude: [
        {
            selector: [
                'dialog',
                '[role="dialog"]',
                'form[role="search"]',
                '[aria-live]',
                '[role="status"]',
                '[role="alert"]',
                '[data-turbo-permanent]',
                '[data-turbo-temporary]',
                'relative-time',
                'time-ago',
                'local-time',
            ],
            reason: 'github-controlled-mutation',
        },
    ],
});

export default githubAdapter;
