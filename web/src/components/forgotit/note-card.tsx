'use client';

import { useMemo } from 'react';
import { motion } from 'framer-motion';
import { formatDistanceToNow } from 'date-fns';
import { zhCN } from 'date-fns/locale';
import { FileText, Image as ImageIcon, Images, CloudOff, Pin, PinOff, Pencil, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { NoteDto, TagDto } from '@/lib/api';
import { cn } from '@/lib/utils';

interface NoteCardProps {
  note: NoteDto;
  onOpen: (note: NoteDto) => void;
  onTogglePin: (note: NoteDto) => void;
  onDelete: (note: NoteDto) => void;
  index?: number;
  pending?: boolean; // 本地已改、尚未同步到其他设备
}

function TypeIcon({ type }: { type: NoteDto['type'] }) {
  if (type === 'image') return <ImageIcon className="size-4 shrink-0 text-primary" aria-hidden="true" />;
  if (type === 'mixed') return <Images className="size-4 shrink-0 text-primary" aria-hidden="true" />;
  return <FileText className="size-4 shrink-0 text-primary" aria-hidden="true" />;
}

function TagPill({ tag }: { tag: TagDto }) {
  if (tag.kind === 'category') {
    return (
      <span className="inline-flex max-w-[10rem] items-center truncate rounded-full bg-primary px-2 py-0.5 text-[11px] font-medium text-primary-foreground">
        {tag.name}
      </span>
    );
  }
  return (
    <span className="inline-flex max-w-[10rem] items-center truncate rounded-full border px-2 py-0.5 text-[11px] text-muted-foreground">
      {tag.name}
    </span>
  );
}

export function NoteCard({ note, onOpen, onTogglePin, onDelete, index = 0, pending }: NoteCardProps) {
  const firstImage = useMemo(
    () => note.attachments.find((a) => a.mimeType.startsWith('image/')),
    [note.attachments]
  );

  const visibleTags = note.tags.slice(0, 3);
  const extraCount = note.tags.length - visibleTags.length;
  const title = note.title?.trim() || '';

  return (
    <motion.article
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, delay: Math.min(index * 0.03, 0.2), ease: 'easeOut' }}
      whileHover={{ y: -3 }}
      onClick={() => onOpen(note)}
      className="group relative flex cursor-pointer flex-col overflow-hidden rounded-xl border bg-card shadow-sm transition-shadow hover:shadow-md focus-visible:outline-2 focus-visible:outline-ring"
      role="button"
      tabIndex={0}
      aria-label={title ? `打开笔记：${title}` : '打开无标题笔记'}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen(note);
        }
      }}
    >
      {/* 首图缩略图 */}
      {firstImage && (
        <div className="relative h-32 w-full overflow-hidden bg-muted">
          <img
            src={firstImage.filePath}
            alt={firstImage.description || (title ? `${title} 的配图` : '笔记配图')}
            loading="lazy"
            className="h-32 w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
          />
        </div>
      )}

      {/* 悬浮操作（移动端常显） */}
      <div className="absolute right-2 top-2 z-10 flex gap-1 opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100 sm:focus-within:opacity-100">
        <Button
          variant="ghost"
          size="icon"
          aria-label={note.pinned ? '取消置顶' : '置顶笔记'}
          title={note.pinned ? '取消置顶' : '置顶'}
          className="size-8 rounded-full border bg-background/80 backdrop-blur hover:bg-background"
          onClick={(e) => {
            e.stopPropagation();
            onTogglePin(note);
          }}
        >
          {note.pinned ? <PinOff className="size-3.5" aria-hidden="true" /> : <Pin className="size-3.5" aria-hidden="true" />}
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label="编辑笔记"
          title="编辑"
          className="size-8 rounded-full border bg-background/80 backdrop-blur hover:bg-background"
          onClick={(e) => {
            e.stopPropagation();
            onOpen(note);
          }}
        >
          <Pencil className="size-3.5" aria-hidden="true" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label="移入回收站"
          title="删除"
          className="size-8 rounded-full border bg-background/80 text-destructive backdrop-blur hover:bg-background hover:text-destructive"
          onClick={(e) => {
            e.stopPropagation();
            onDelete(note);
          }}
        >
          <Trash2 className="size-3.5" aria-hidden="true" />
        </Button>
      </div>

      <div className="flex flex-1 flex-col gap-2 p-4">
        <div className="flex items-center gap-1.5 pr-20">
          <TypeIcon type={note.type} />
          <h3
            className={cn(
              'truncate text-sm font-medium',
              !title && 'font-normal italic text-muted-foreground'
            )}
          >
            {title || '无标题笔记'}
          </h3>
        </div>

        {(note.summary || note.content) && (
          <p className="line-clamp-2 min-h-10 text-sm leading-5 text-muted-foreground">
            {note.summary?.trim() || note.content?.replace(/[#*`>\-\[\]]/g, '').trim() || ''}
          </p>
        )}

        {note.tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {visibleTags.map((tag) => (
              <TagPill key={tag.id} tag={tag} />
            ))}
            {extraCount > 0 && (
              <span className="inline-flex items-center rounded-full border border-dashed px-2 py-0.5 text-[11px] text-muted-foreground">
                +{extraCount}
              </span>
            )}
          </div>
        )}

        <div className="mt-auto flex items-center justify-between gap-2 pt-1 text-xs text-muted-foreground">
          <time dateTime={note.updatedAt}>
            {formatDistanceToNow(new Date(note.updatedAt), { addSuffix: true, locale: zhCN })}
          </time>
          {note.localOnly && (
            <span className="inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px]">
              仅本地
            </span>
          )}
          {pending && (
            <span className="inline-flex items-center gap-0.5 rounded-full border border-primary/40 px-1.5 py-0.5 text-[10px] text-primary">
              <CloudOff className="size-2.5" aria-hidden="true" />
              待同步
            </span>
          )}
        </div>
      </div>

      {/* 置顶角标 */}
      {note.pinned && (
        <span className="absolute left-0 top-3 rounded-r-full bg-primary px-1.5 py-0.5 text-[10px] font-medium text-primary-foreground shadow-sm">
          置顶
        </span>
      )}
    </motion.article>
  );
}
