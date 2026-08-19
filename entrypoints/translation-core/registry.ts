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

export const defaultTranslationAdapters: readonly TranslationSiteAdapter[] =
    Object.freeze([...declaredAdapters]);
