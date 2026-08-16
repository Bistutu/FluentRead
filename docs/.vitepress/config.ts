import { defineConfig } from 'vitepress'
import viteImagemin from 'vite-plugin-imagemin'

export default defineConfig({
  title: 'FluentRead · 流畅阅读',
  description: '让双语阅读自然发生的开源浏览器扩展。',
  lang: 'zh-CN',
  lastUpdated: true,
  base: '/',

  head: [
    ['meta', { name: 'theme-color', content: '#e94872' }],
    ['link', { rel: 'icon', href: '/logo.png' }],
  ],

  vite: {
    plugins: [
      viteImagemin({
        gifsicle: { optimizationLevel: 7, interlaced: false },
        optipng: { optimizationLevel: 7 },
        mozjpeg: { quality: 80 },
        pngquant: { quality: [0.8, 0.9], speed: 4 },
        svgo: {
          plugins: [
            { name: 'removeViewBox' },
            { name: 'removeEmptyAttrs', active: false },
          ],
        },
      }),
    ],
  },

  themeConfig: {
    logo: '/logo.png',
    siteTitle: 'FluentRead',
    outline: 'deep',
    search: { provider: 'local' },
    nav: [
      { text: '首页', link: '/' },
      { text: '快速开始', link: '/guide/getting-started' },
      { text: '使用指南', link: '/guide/' },
      { text: '配置', link: '/config/' },
      { text: '下载', link: '/guide/getting-started#安装扩展' },
    ],

    sidebar: {
      '/guide/': [
        {
          text: '开始使用',
          items: [
            { text: '认识 FluentRead', link: '/guide/' },
            { text: '安装与第一次翻译', link: '/guide/getting-started' },
            { text: '功能总览', link: '/guide/features' },
            { text: '图片翻译', link: '/guide/image-translation' },
          ],
        },
        {
          text: '个性化使用',
          items: [
            { text: '自定义快捷键', link: '/guide/custom-hotkey' },
            { text: '常见问题', link: '/guide/faq' },
          ],
        },
        {
          text: '开发者文档',
          items: [
            { text: '浏览器自动化测试', link: '/guide/codex-browser-testing' },
          ],
        },
      ],
      '/config/': [
        {
          text: '配置 FluentRead',
          items: [
            { text: '设置总览', link: '/config/' },
            { text: '翻译服务', link: '/config/translation-engines' },
          ],
        },
      ],
    },

    socialLinks: [{ icon: 'github', link: 'https://github.com/Bistutu/FluentRead' }],
    footer: {
      message: 'Open source under the GPL-3.0 License.',
      copyright: 'Copyright © 2025-present FluentRead contributors',
    },
  },
})
