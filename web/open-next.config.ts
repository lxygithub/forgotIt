// OpenNext → Cloudflare Workers 转换配置（配合 wrangler.jsonc 使用）
// 增量缓存默认不启用（单用户场景无必要）；如需 ISR 缓存可按 OpenNext 文档加 R2/KV 增量缓存。
import { defineCloudflareConfig } from "@opennextjs/cloudflare";

export default defineCloudflareConfig({});
