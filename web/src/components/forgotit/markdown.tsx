'use client';

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { cn } from '@/lib/utils';

/**
 * 轻量 Markdown 渲染容器：react-markdown + remark-gfm，
 * 用容器选择器做简单 prose 排版（不引入 typography 插件）。
 */
export function Markdown({ content, className }: { content: string; className?: string }) {
  return (
    <div
      className={cn(
        'min-w-0 max-w-full text-sm leading-relaxed break-words',
        '[&_a]:text-primary [&_a]:underline [&_a]:underline-offset-2',
        '[&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground',
        '[&_code]:break-all [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-[0.85em]',
        '[&_h1]:mt-2 [&_h1]:mb-1 [&_h1]:text-lg [&_h1]:font-bold',
        '[&_h2]:mt-2 [&_h2]:mb-1 [&_h2]:text-base [&_h2]:font-semibold',
        '[&_h3]:mt-2 [&_h3]:mb-1 [&_h3]:text-sm [&_h3]:font-semibold',
        '[&_hr]:my-3 [&_hr]:border-border',
        '[&_img]:max-w-full [&_img]:rounded-md',
        '[&_li]:my-0.5',
        '[&_ol]:my-1 [&_ol]:list-decimal [&_ol]:pl-5',
        '[&_p]:my-1',
        '[&_pre]:my-2 [&_pre]:max-w-full [&_pre]:whitespace-pre-wrap [&_pre]:break-words [&_pre]:overflow-x-hidden [&_pre]:rounded-md [&_pre]:bg-muted [&_pre]:p-3',
        '[&_table]:my-2 [&_table]:w-full [&_table]:table-fixed [&_table]:text-xs',
        '[&_table]:border-collapse [&_th]:break-words [&_th]:border [&_th]:px-2 [&_th]:py-1 [&_td]:break-words [&_td]:border [&_td]:px-2 [&_td]:py-1',
        '[&_ul]:my-1 [&_ul]:list-disc [&_ul]:pl-5',
        className
      )}
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
    </div>
  );
}
