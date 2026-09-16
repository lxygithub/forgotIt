'use client';

import { useEffect, useRef, useState } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { zhCN } from 'date-fns/locale';
import { ImagePlus, Loader2, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { Markdown } from '@/components/forgotit/markdown';
import { BRAND } from '@/lib/brand';
import {
  uploadAttachment,
  type AttachmentDto,
  type NoteDto,
  type NoteType,
} from '@/lib/api';
import { organizeWithInputBestEffort } from '@/lib/organize-orchestrator';
import { createNoteLocalFirst, deleteNoteLocalFirst, updateNoteLocalFirst } from '@/lib/local-first';
import { useSyncStore } from '@/lib/sync-store';

interface NoteEditorProps {
  open: boolean;
  /** null 表示新建 */
  note: NoteDto | null;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
  onBackgroundWorkChange: (taskId: string, message: string | null) => void;
}

interface NoteDraft {
  title: string;
  content: string;
  localOnly: boolean;
  attachmentIds: string[];
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('读取图片失败'));
    reader.readAsDataURL(file);
  });
}

/** 不调用 AI：取正文第一句作为标题，图片笔记则使用固定标题。 */
function makeAutomaticTitle(content: string, hasAttachments: boolean): string {
  const firstLine = content
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s{0,3}(?:#{1,6}\s+|[-*+]\s+|>\s?)/, '').replace(/[`*_]/g, '').trim())
    .find(Boolean);
  return (firstLine || (hasAttachments ? '图片笔记' : '随手记')).slice(0, 80);
}

function newBackgroundTaskId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `save-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function NoteEditor({ open, note, onOpenChange, onSaved, onBackgroundWorkChange }: NoteEditorProps) {
  const isNew = note === null;

  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [localOnly, setLocalOnly] = useState(false);
  const [mode, setMode] = useState<'source' | 'preview'>('source');
  const [existingAttachments, setExistingAttachments] = useState<AttachmentDto[]>([]);
  const [pendingAttachments, setPendingAttachments] = useState<AttachmentDto[]>([]);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const snapshotRef = useRef('');

  // 打开时初始化
  useEffect(() => {
    if (!open) return;
    setTitle(note?.title ?? '');
    setContent(note?.content ?? '');
    setLocalOnly(note?.localOnly ?? false);
    setMode('source');
    setExistingAttachments(note?.attachments ?? []);
    setPendingAttachments([]);
    setSaving(false);
    setDeleting(false);
    snapshotRef.current = JSON.stringify([
      note?.title ?? '',
      note?.content ?? '',
      note?.localOnly ?? false,
      0,
    ]);
  }, [open]);

  const dirty =
    JSON.stringify([title, content, localOnly, pendingAttachments.length]) !== snapshotRef.current;

  const attachmentIds = [...existingAttachments, ...pendingAttachments].map((a) => a.id);

  const inferType = (draft: Pick<NoteDraft, 'content' | 'attachmentIds'>): NoteType => {
    const hasImages = draft.attachmentIds.length > 0;
    const hasText = draft.content.trim().length > 0;
    if (hasImages && hasText) return 'mixed';
    if (hasImages) return 'image';
    return 'text';
  };

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        if (!file.type.startsWith('image/')) {
          toast.error(`跳过非图片文件：${file.name}`);
          continue;
        }
        const dataUrl = await readFileAsDataUrl(file);
        const res = await uploadAttachment({
          noteId: isNew ? undefined : note.id,
          dataUrl,
          mimeType: file.type,
        });
        setPendingAttachments((prev) => [...prev, res.attachment]);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '图片识别失败');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const saveNote = async (draft: NoteDraft): Promise<NoteDto> => {
    const type = inferType(draft);
    const body = {
      title: draft.title,
      content: draft.content || undefined,
      localOnly: draft.localOnly,
      type,
    };
    if (isNew) {
      // 本地优先：离线也能记，联网后自动同步（离线时 attachmentIds 为空，附件不支持离线暂存）
      return createNoteLocalFirst({ ...body, attachmentIds: draft.localOnly ? [] : draft.attachmentIds });
    }
    return updateNoteLocalFirst(note.id, body, note);
  };

  const handleSave = (organize: boolean) => {
    if (saving || uploading) return;
    const resolvedTitle = title.trim() || makeAutomaticTitle(content, attachmentIds.length > 0);
    const draft: NoteDraft = { title: resolvedTitle, content, localOnly, attachmentIds };
    const taskId = newBackgroundTaskId();
    setSaving(true);
    const offline = useSyncStore.getState().offlineMode;
    // 先回到首页，网络写入与 AI 调用都在后台完成，避免长请求锁住编辑器。
    onOpenChange(false);
    onBackgroundWorkChange(taskId, organize && !offline ? '正在保存并让 AI 整理…' : '正在保存笔记…');
    void (async () => {
      let organized = false;
      try {
        const saved = await saveNote(draft);
        // 持久化完成即刷新首页；AI 整理不必阻塞新笔记出现在列表中。
        onSaved();
        if (organize && !offline) {
          onBackgroundWorkChange(taskId, BRAND.organizeLoadingToast);
          // 三级降级：端侧 WebLLM → 服务端 AI → 静默（标题已有则不受影响）。
          const attempt = await organizeWithInputBestEffort(saved.id, {
            title: saved.title,
            content: saved.content,
          });
          if (attempt.level === 'device') {
            organized = true;
            toast.success('已保存，设备上的 AI 也整理好了。');
          } else if (attempt.level === 'server') {
            organized = true;
            toast.success(BRAND.organizeDoneToast);
          } else {
            toast.warning('笔记已保存，但 AI 整理没成功，稍后可重试。');
          }
        } else if (organize && offline) {
          toast.warning('离线状态下 AI 不可用。笔记已存好，联网后可再让 AI 整理。');
        } else {
          toast.success(offline ? '已存进脑子（本地）。' : '已保存。');
        }
      } catch (err) {
        toast.error(err instanceof Error ? err.message : '保存失败');
      } finally {
        setSaving(false);
        onBackgroundWorkChange(taskId, null);
        // AI 写入的摘要和标签完成后再刷新一次；列表会保留旧内容，不显示整页骨架屏。
        if (organized) onSaved();
      }
    })();
  };

  const handleTrash = async () => {
    if (isNew) return;
    setDeleting(true);
    try {
      await deleteNoteLocalFirst(note.id, note);
      toast.success(`已移入回收站。${BRAND.trashHint}`);
      onSaved();
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '删除失败');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="top-auto bottom-0 left-2 right-2 w-auto max-w-none translate-x-0 translate-y-0 rounded-b-none p-4 pb-0 max-h-[calc(100dvh-0.5rem)] overflow-x-hidden overflow-y-auto sm:top-1/2 sm:left-1/2 sm:right-auto sm:w-full sm:max-w-2xl sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-lg sm:p-6 sm:pb-0 sm:max-h-[92dvh]">
        <DialogHeader className="min-w-0 pr-8">
          <DialogTitle>{isNew ? '记一条' : '编辑笔记'}</DialogTitle>
          <DialogDescription>
            写下来，脑子就不用硬记了。
          </DialogDescription>
        </DialogHeader>

        <div className="min-w-0 space-y-4">
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="标题（可留空）"
            aria-label="笔记标题"
            className="h-10"
          />

          <div className="space-y-2">
            <div className="flex items-center justify-end">
              <Tabs value={mode} onValueChange={(v) => setMode(v as 'source' | 'preview')}>
                <TabsList className="h-8">
                  <TabsTrigger value="source" className="h-7 px-3 text-xs">源码</TabsTrigger>
                  <TabsTrigger value="preview" className="h-7 px-3 text-xs">预览</TabsTrigger>
                </TabsList>
              </Tabs>
            </div>
            {mode === 'source' ? (
              <Textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder={'写点什么…支持 Markdown。\n反正回头你也想不起写过啥，交给它记。'}
                aria-label="笔记正文"
                className="min-h-[240px] font-mono text-sm"
              />
            ) : (
              <div
                className="min-h-[240px] max-h-[360px] min-w-0 overflow-x-hidden overflow-y-auto rounded-md border bg-background p-3"
                aria-label="正文预览"
              >
                {content.trim() ? (
                  <Markdown content={content} />
                ) : (
                  <p className="text-sm text-muted-foreground italic">（空的，先去「源码」里写点啥）</p>
                )}
              </div>
            )}
          </div>

          {/* 图片附件 */}
          <div className="space-y-2">
            <div className="flex min-w-0 flex-wrap gap-2">
              {existingAttachments.map((att) => (
                <div key={att.id} className="group/att relative">
                  <img
                    src={att.filePath}
                    alt={att.description || '笔记附件图片'}
                    title={att.description || att.ocrText || '（AI 未生成描述）'}
                    className="size-16 rounded-md border object-cover"
                  />
                </div>
              ))}
              {pendingAttachments.map((att) => (
                <div key={att.id} className="relative">
                  <img
                    src={att.filePath}
                    alt={att.description || '新上传的图片'}
                    title={att.description || att.ocrText || '（AI 未生成描述）'}
                    className="size-16 rounded-md border border-primary object-cover ring-1 ring-primary/40"
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="移除这张图片"
                    className="absolute -right-1.5 -top-1.5 size-5 rounded-full border bg-background p-0 text-muted-foreground hover:text-destructive"
                    onClick={() => setPendingAttachments((prev) => prev.filter((a) => a.id !== att.id))}
                  >
                    <X className="size-3" aria-hidden="true" />
                  </Button>
                </div>
              ))}
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                aria-label="添加图片"
                className="inline-flex size-16 flex-col items-center justify-center gap-1 rounded-md border border-dashed text-xs text-muted-foreground transition-colors hover:border-primary/50 hover:text-primary disabled:opacity-60"
              >
                {uploading ? (
                  <>
                    <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                    {BRAND.uploadingImageText}
                  </>
                ) : (
                  <>
                    <ImagePlus className="size-4" aria-hidden="true" />
                    添加图片
                  </>
                )}
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                aria-hidden="true"
                tabIndex={-1}
                onChange={(e) => void handleFiles(e.target.files)}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              传图后 AI 会自动看图、识字，帮你记清楚。
            </p>
          </div>

          {/* 仅本地开关 */}
          <div className="flex min-w-0 items-center justify-between gap-3 rounded-lg border bg-muted/40 px-3 py-2.5">
            <Label htmlFor="note-local-only" className="min-w-0 text-sm font-normal">
              {BRAND.editorLocalOnlyLabel}
            </Label>
            <Switch
              id="note-local-only"
              checked={localOnly}
              onCheckedChange={setLocalOnly}
              aria-label={BRAND.editorLocalOnlyLabel}
            />
          </div>

          {/* 元信息 */}
          <p className="text-xs text-muted-foreground">
            {note
              ? `更新于 ${formatDistanceToNow(new Date(note.updatedAt), { addSuffix: true, locale: zhCN })}`
              : '还没有保存过'}
            <span className="mx-1.5">·</span>
            {saving ? (
              '保存中…'
            ) : isNew || dirty ? (
              <span className="text-primary">未保存</span>
            ) : (
              '已保存'
            )}
          </p>
        </div>

        {/* 底部操作 */}
        <div className="sticky bottom-0 z-10 -mx-4 flex min-w-0 flex-col gap-2 border-t bg-background/95 px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))] backdrop-blur sm:-mx-6 sm:flex-row sm:items-center sm:px-6 sm:pb-6">
          {!isNew && (
            <Button
              variant="ghost"
              className="h-11 w-full text-destructive hover:bg-destructive/10 hover:text-destructive sm:w-auto sm:h-9"
              onClick={() => void handleTrash()}
              disabled={deleting || saving}
            >
              {deleting ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Trash2 className="size-4" aria-hidden="true" />}
              移入回收站
            </Button>
          )}
          <div className="grid min-w-0 grid-cols-2 gap-2 sm:ml-auto sm:flex">
            <Button
              variant="ghost"
              className="h-11 w-full px-2 sm:w-auto sm:px-4 sm:h-9"
              onClick={() => void handleSave(false)}
              disabled={saving || uploading}
            >
              保存
            </Button>
            <Button
              className="h-11 w-full px-2 text-xs sm:w-auto sm:px-4 sm:text-sm sm:h-9"
              onClick={() => void handleSave(true)}
              disabled={saving || uploading}
            >
              {saving ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
              保存并让 AI 整理
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
