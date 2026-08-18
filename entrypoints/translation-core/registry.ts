import type {TranslationSiteAdapter} from './types';
import {githubAdapter} from './adapters/github';
import {xAdapter} from './adapters/x';
import {redditAdapter} from './adapters/reddit';
import {hackerNewsAdapter} from './adapters/hackernews';
import {youtubeAdapter} from './adapters/youtube';
import {gnuManualAdapter} from './adapters/gnu';
import {learnOpenGLAdapter} from './adapters/learnopengl';

const declaredAdapters = [
    githubAdapter,
    xAdapter,
    redditAdapter,
    hackerNewsAdapter,
    youtubeAdapter,
    gnuManualAdapter,
    learnOpenGLAdapter,
] as const satisfies readonly TranslationSiteAdapter[];

/** Sort by descending priority while retaining declaration order for ties. */
function sortAdaptersByPriority(
    adapters: readonly TranslationSiteAdapter[],
): TranslationSiteAdapter[] {
    return adapters
        .map((adapter, index) => ({adapter, index}))
        .sort((left, right) =>
            (right.adapter.priority ?? 0) - (left.adapter.priority ?? 0) || left.index - right.index)
        .map(({adapter}) => adapter);
}

export const defaultTranslationAdapters: readonly TranslationSiteAdapter[] =
    Object.freeze(sortAdaptersByPriority(declaredAdapters));
