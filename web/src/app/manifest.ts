import type { MetadataRoute } from 'next'

// PWA 清单：手机「添加到主屏幕」后作为独立 App 打开（无浏览器地址栏），
// 配合 public/sw.js 缓存 App 壳，二次打开不必重新下载 JS/CSS。
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: '记不住 · 脑子寄存处',
    short_name: '记不住',
    description: '你记不住的，它都记得住。本地优先的 AI 记事本。',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#f7fbfc',
    theme_color: '#0d9488',
    lang: 'zh-CN',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
      // 同一张图声明 maskable：图标本身是圆角方块 + 居中主体，Android 裁剪后仍完整
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  }
}
