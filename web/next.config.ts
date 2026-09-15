import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // 图片不优化：品牌图为静态资源，关闭后 /_next/image 与 sharp 原生依赖退出构建图，
  // Node 与 Cloudflare Workers 双端行为一致（双部署支持，见部署文档 §11）
  images: {
    unoptimized: true,
  },
  // webpack 构建通道（bunx next build --webpack，OpenNext 兼容备选）：
  // 允许 Prisma wasm 引擎的异步 WebAssembly 模块（.prisma/client/wasm.js → query_engine_bg.wasm）
  webpack: (config) => {
    config.experiments = { ...config.experiments, asyncWebAssembly: true };
    return config;
  },
  // Next 16.3 要求 Turbopack 构建在存在 webpack 配置时必须同时声明 turbopack 配置
  turbopack: {},
  // 低内存环境（4GB cgroup）必需：'full' 强制 Turbopack 激进驱逐编译缓存，
  // 避免默认 'auto' 下 RSS 超限被 OOM kill（Next 16 已移除 turbopack.memoryLimit 配置项）
  experimental: {
    turbopackMemoryEviction: "full",
    // 单进程构建：4GB cgroup 下多 worker 并发是 OOM 主因之一（变慢换稳定）
    cpus: 1,
  },
  /* config options here */
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
};

export default nextConfig;
