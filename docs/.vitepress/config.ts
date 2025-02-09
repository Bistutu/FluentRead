import { defineConfig } from 'vitepress'
import viteImagemin from 'vite-plugin-imagemin'

export default defineConfig({
  title: "流畅阅读",
  description: "让所有人都能够拥有基于母语般的阅读体验",
  lang: 'zh-CN',
  lastUpdated: true,
  base: '/',
  
  head: [
    ['link', { rel: 'icon', href: '/FluentRead/logo.png' }]
  ],
  
  vite: {
    plugins: [
      viteImagemin({
        gifsicle: {
          optimizationLevel: 7,
          interlaced: false
        },
        optipng: {
          optimizationLevel: 7
        },
        mozjpeg: {
          quality: 80
        },
        pngquant: {
          quality: [0.8, 0.9],
          speed: 4
        },
        svgo: {
          plugins: [
            {
              name: 'removeViewBox'
            },
            {
              name: 'removeEmptyAttrs',
              active: false
            }
          ]
        }
      })
    ]
  },
  
  themeConfig: {
    logo: '/logo.png',
    nav: [
      { text: '首页', link: '/' },
      { text: '文档指南', link: '/guide/' },
      { 
        text: '下载', 
        items: [
          { text: 'Chrome浏览器', link: 'https://chromewebstore.google.com/detail/%E6%B5%81%E7%95%85%E9%98%85%E8%AF%BB/djnlaiohfaaifbibleebjggkghlmcpcj?hl=zh-CN&authuser=0' },
          { text: 'Chrome浏览器（国内）', link: 'https://www.crxsoso.com/webstore/detail/djnlaiohfaaifbibleebjggkghlmcpcj' },
          { text: 'Edge浏览器', link: 'https://microsoftedge.microsoft.com/addons/detail/%E6%B5%81%E7%95%85%E9%98%85%E8%AF%BB/kakgmllfpjldjhcnkghpplmlbnmcoflp?hl=zh-CN' },
          { text: 'Firefox浏览器', link: 'https://addons.mozilla.org/zh-CN/firefox/addon/%E6%B5%81%E7%95%85%E9%98%85%E8%AF%BB/?utm_source=addons.mozilla.org&utm_medium=referral&utm_content=search' }
        ]
      }
    ],

    sidebar: [
      {
        text: '介绍',
        items: [
          { text: '什么是流畅阅读?', link: '/guide/' },
          { text: '快速安装', link: '/guide/getting-started' },
          { text: '功能介绍', link: '/guide/features' }
        ]
      },
      {
        text: '配置指南',
        items: [
          { text: '基本配置', link: '/config/' },
          { text: '翻译引擎配置', link: '/config/translation-engines' },
        ]
      },
      {
        text: '常见问题',
        items: [
          { text: 'Ollama 配置问题', link: '/guide/faq#ollama-配置问题' }
        ]
      }
    ],

    socialLinks: [
      { icon: 'github', link: 'https://github.com/Bistutu/FluentRead' }
    ],

    footer: {
      message: '基于 GPL-3.0 许可发布',
      copyright: 'Copyright © 2025-present FluentRead'
    }
  },
  
}) 