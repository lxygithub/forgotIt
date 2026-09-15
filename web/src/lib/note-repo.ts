// 「记不住」数据访问辅助：DTO 序列化、默认类目、类型推断
// 对应开发文档 v2.0 第 6.3 / 14.2 / 14.4 节

import { db } from '@/lib/db';
import type { Note, Tag, NoteTag, Attachment } from '@prisma/client';

type NoteWithRelations = Note & {
  tags: (NoteTag & { tag: Tag })[];
  attachments: Attachment[];
};

type PrismaNote = {
  id: string;
  type: string;
  title: string | null;
  content: string | null;
  summary: string | null;
  localOnly: boolean;
  pinned: boolean;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
  tags: (NoteTag & { tag: Tag })[];
  attachments: Attachment[];
};

/** 笔记实体 → 前端 NoteDto */
export function serializeNote(note: NoteWithRelations | PrismaNote) {
  return {
    id: note.id,
    type: note.type as 'text' | 'image' | 'mixed',
    title: note.title,
    content: note.content,
    summary: note.summary,
    localOnly: note.localOnly,
    pinned: note.pinned,
    createdAt: note.createdAt.toISOString(),
    updatedAt: note.updatedAt.toISOString(),
    deletedAt: note.deletedAt ? note.deletedAt.toISOString() : null,
    tags: note.tags
      .map((nt) => ({
        id: nt.tag.id,
        name: nt.tag.name,
        kind: nt.tag.kind as 'category' | 'free',
        color: nt.tag.color,
        source: nt.source as 'ai' | 'user',
      }))
      // 类目在前，自由标签在后
      .sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'category' ? -1 : 1)),
    attachments: note.attachments.map((att) => ({
      id: att.id,
      filePath: att.filePath,
      mimeType: att.mimeType,
      description: att.description,
      ocrText: att.ocrText,
      createdAt: att.createdAt.toISOString(),
    })),
  };
}

/** 统一的笔记 include（带标签与附件） */
export const noteInclude = {
  tags: { include: { tag: true } },
  attachments: { orderBy: { createdAt: 'asc' as const } },
};

/** 固定类目树（文档 14.4，v2.0 混合标签体系） */
export const DEFAULT_CATEGORIES = [
  '生活',
  '工作',
  '学习',
  '财务票据',
  '健康',
  '旅行',
  '灵感速记',
  '人际',
  '代码技术',
] as const;

/** 确保默认类目存在（幂等） */
export async function ensureDefaultCategories() {
  const existing = await db.tag.count({ where: { kind: 'category' } });
  if (existing > 0) return;
  await Promise.all(
    DEFAULT_CATEGORIES.map((name) =>
      db.tag.upsert({
        where: { name_kind: { name, kind: 'category' } },
        update: {},
        create: { name, kind: 'category' },
      }),
    ),
  );
}

/** 根据附件数与正文推断笔记类型 */
export function computeType(attachmentCount: number, hasContent: boolean): 'text' | 'image' | 'mixed' {
  if (attachmentCount > 0 && hasContent) return 'mixed';
  if (attachmentCount > 0) return 'image';
  return 'text';
}

/** 把附件挂到笔记上，并重算笔记类型 */
export async function attachToNote(noteId: string, attachmentIds: string[]) {
  if (attachmentIds.length === 0) return;
  const ids = [...new Set(attachmentIds)];
  await db.attachment.updateMany({
    where: { id: { in: ids }, noteId: null },
    data: { noteId },
  });
  await recomputeNoteType(noteId);
}

/** 依据当前附件与正文重算 note.type */
export async function recomputeNoteType(noteId: string) {
  const note = await db.note.findUnique({
    where: { id: noteId },
    include: { attachments: { select: { id: true } } },
  });
  if (!note) return;
  const type = computeType(note.attachments.length, Boolean(note.content && note.content.trim()));
  if (type !== note.type) {
    await db.note.update({ where: { id: noteId }, data: { type } });
  }
}
