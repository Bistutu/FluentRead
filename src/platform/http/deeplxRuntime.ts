/**
 * @file src/platform/http/deeplxRuntime.ts
 *
 * 文件职责：把 DeepLX core 的 x-fetch 依赖接入统一运行时 HTTP 端口。
 * 主要内容：使用 createXFetch 构造独立 transport，排除浏览器账户凭据后经 runtimeFetch 请求，保留上游 JSON 编码、响应解析和 isXFetchError 语义。
 * 模块边界：仅由构建插件替换 DeepLX core 的依赖入口；不修改全局 fetch、不配置其他 x-fetch 实例，也不决定翻译候选或重试。
 */

/*! @license
MIT License

@deeplx/core 0.3.1 — https://github.com/un-ts/deeplx
Copyright (c) 2020 Peter Stein 2022-present JounQin
x-fetch 0.3.0 — https://github.com/un-ts/x-fetch
Copyright (c) 2021-present UnTS

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/

import {createXFetch} from 'x-fetch';
import {runtimeFetch} from './runtime';

export {isXFetchError} from 'x-fetch';
export const {xfetch} = createXFetch((input, init) => runtimeFetch(input, {...init, credentials: 'omit'}));
