import {createDeclarativeAdapter} from './declarative';

export const youtubeAdapter = createDeclarativeAdapter({
    id: 'youtube',
    priority: 370,
    hosts: [
        {hostname: 'youtube.com', includeSubdomains: true},
        'youtu.be',
    ],
    prune: [
        {
            selector: [
                '#movie_player',
                'ytd-live-chat-frame',
                'yt-live-chat-app',
                'ytd-video-preview',
            ],
            reason: 'youtube-player-or-live-ui',
        },
        {
            selector: ['input#search', 'ytd-comment-simplebox-renderer'],
            reason: 'youtube-text-input',
        },
    ],
    targets: [
        {
            selector: 'ytd-watch-metadata h1 yt-formatted-string',
            reason: 'youtube-video-title',
            match: 'closest',
            atomic: true,
        },
        {
            selector: [
                '#description-inline-expander yt-attributed-string',
                'ytd-text-inline-expander yt-attributed-string',
            ],
            reason: 'youtube-description',
            match: 'closest',
        },
        {
            selector: [
                'ytd-comment-view-model #content-text',
                'ytd-comment-renderer #content-text',
            ],
            reason: 'youtube-comment',
            match: 'closest',
        },
        {
            selector: 'ytd-transcript-segment-renderer .segment-text',
            reason: 'youtube-transcript-segment',
            match: 'closest',
        },
    ],
    keepOriginal: [
        {
            selector: ['#owner-sub-count', '#info span', 'yt-formatted-string#vote-count-middle'],
            reason: 'youtube-dynamic-metadata',
        },
    ],
});
