'use client';

import Image from 'next/image';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';

interface EmptyStateProps {
  /** 主文案，默认品牌空状态文案 */
  title?: string;
  /** 副文案 */
  description?: string;
  /** 是否显示插画，默认 true */
  illustration?: boolean;
  /** 自定义操作区（按钮等） */
  children?: React.ReactNode;
  /** 紧凑模式（无插画、间距更小） */
  compact?: boolean;
  className?: string;
}

export function EmptyState({
  title,
  description,
  illustration = true,
  children,
  compact = false,
  className,
}: EmptyStateProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: 'easeOut' }}
      className={cn(
        'flex flex-col items-center justify-center text-center',
        compact ? 'py-10' : 'py-14 sm:py-20',
        className
      )}
    >
      {illustration && (
        <div className="relative mb-6 h-40 w-40 sm:h-48 sm:w-48">
          <Image
            src="/images/empty-brain.jpg"
            alt="空空的大脑插画：一个放空的大脑，表示还没有任何记录"
            fill
            sizes="192px"
            className="rounded-2xl object-cover shadow-sm"
            priority={false}
          />
        </div>
      )}
      <h2 className="text-lg font-semibold tracking-tight sm:text-xl">
        {title ?? '这里啥也没有。'}
      </h2>
      <p className="mt-1.5 max-w-sm text-sm text-muted-foreground">
        {description ?? '不过没关系，你记不住，它记得住。'}
      </p>
      {children && <div className="mt-5 flex flex-wrap items-center justify-center gap-3">{children}</div>}
    </motion.div>
  );
}
