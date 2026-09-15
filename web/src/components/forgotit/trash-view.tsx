'use client';

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { formatDistanceToNow } from 'date-fns';
import { zhCN } from 'date-fns/locale';
import { FileText, Image as ImageIcon, Info, RotateCcw, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/forgotit/empty-state';
import { BRAND } from '@/lib/brand';
import { deleteNote, listNotes, restoreNote, type NoteDto } from '@/lib/api';
import { cn } from '@/lib/utils';

interface TrashViewProps {
  refreshKey: number;
}

function remainingDays(deletedAt: string): number {
  return Math.max(0, 30 - Math.floor((Date.now() - new Date(deletedAt).getTime()) / 86400000));
}

export function TrashView({ refreshKey }: TrashViewProps) {
  const [notes, setNotes] = useState<NoteDto[] | null>(null);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<NoteDto | null>(null);
  const [working, setWorking] = useState(false);

  const loading = notes === null || loadedKey !== String(refreshKey);

  useEffect(() => {
    const ac = new AbortController();
    void (async () => {
      try {
        const res = await listNotes({ view: 'trash' }, ac.signal);
        if (ac.signal.aborted) return;
        const sorted = [...res.notes].sort(
          (a, b) => new Date(b.deletedAt ?? 0).getTime() - new Date(a.deletedAt ?? 0).getTime()
        );
        setNotes(sorted);
      } catch (err) {
        if (ac.signal.aborted || (err instanceof DOMException && err.name === 'AbortError')) return;
        toast.error(err instanceof Error ? err.message : '加载回收站失败');
        setNotes([]);
      } finally {
        if (!ac.signal.aborted) setLoadedKey(String(refreshKey));
      }
    })();
    return () => ac.abort();
  }, [refreshKey]);

  const handleRestore = async (note: NoteDto) => {
    try {
      await restoreNote(note.id);
      setNotes((prev) => (prev ? prev.filter((n) => n.id !== note.id) : prev));
      toast.success('已恢复，它回到脑子里了。');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '恢复失败');
    }
  };

  const handlePermanentDelete = async () => {
    if (!pendingDelete) return;
    setWorking(true);
    try {
      await deleteNote(pendingDelete.id, { permanent: true });
      toast.success('彻底删除。这次真的想不起来了。');
      setNotes((prev) => (prev ? prev.filter((n) => n.id !== pendingDelete.id) : prev));
      setPendingDelete(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '删除失败');
    } finally {
      setWorking(false);
    }
  };

  return (
    <section aria-label="回收站" className="space-y-4">
      {/* 提示条 */}
      <div
        role="note"
        className="flex items-center gap-2 rounded-xl border border-primary/25 bg-primary/10 px-4 py-3 text-sm text-primary"
      >
        <Info className="size-4 shrink-0" aria-hidden="true" />
        {BRAND.trashHint}
      </div>

      {loading ? (
        <div className="space-y-3" aria-busy="true">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-16 rounded-xl" />
          ))}
        </div>
      ) : notes && notes.length > 0 ? (
        <div className="space-y-3">
          {notes.map((note, i) => {
            const days = remainingDays(note.deletedAt ?? note.updatedAt);
            const urgent = days <= 5;
            return (
              <motion.div
                key={note.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.25, delay: Math.min(i * 0.03, 0.15) }}
                className={cn(
                  'flex items-center gap-3 rounded-xl border bg-card px-4 py-3',
                  urgent && 'border-destructive/30'
                )}
              >
                {note.type === 'text' ? (
                  <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                ) : (
                  <ImageIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                )}
                <div className="min-w-0 flex-1">
                  <p
                    className={cn(
                      'truncate text-sm font-medium',
                      !note.title?.trim() && 'font-normal italic text-muted-foreground'
                    )}
                  >
                    {note.title?.trim() || '无标题笔记'}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    删除于{' '}
                    {note.deletedAt
                      ? formatDistanceToNow(new Date(note.deletedAt), { addSuffix: true, locale: zhCN })
                      : '不久前'}
                  </p>
                </div>
                <Badge
                  variant="outline"
                  className={cn(
                    'shrink-0',
                    urgent ? 'border-destructive/40 text-destructive' : 'text-muted-foreground'
                  )}
                >
                  剩余 {days} 天
                </Badge>
                <div className="flex shrink-0 gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`恢复笔记：${note.title?.trim() || '无标题笔记'}`}
                    title="恢复"
                    className="size-11 rounded-full sm:size-9"
                    onClick={() => void handleRestore(note)}
                  >
                    <RotateCcw className="size-4" aria-hidden="true" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`彻底删除笔记：${note.title?.trim() || '无标题笔记'}`}
                    title="彻底删除"
                    className="size-11 rounded-full text-destructive hover:bg-destructive/10 hover:text-destructive sm:size-9"
                    onClick={() => setPendingDelete(note)}
                  >
                    <Trash2 className="size-4" aria-hidden="true" />
                  </Button>
                </div>
              </motion.div>
            );
          })}
        </div>
      ) : (
        <EmptyState
          illustration={false}
          title={BRAND.trashEmpty}
          description="删掉的东西会在这里躺 30 天，然后彻底消失。"
        />
      )}

      {/* 彻底删除确认 */}
      <AlertDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>彻底删除？</AlertDialogTitle>
            <AlertDialogDescription>
              「{pendingDelete?.title?.trim() || '无标题笔记'}」将被彻底删除，这次真的找不回来了。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={working}>算了</AlertDialogCancel>
            <AlertDialogAction
              disabled={working}
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={(e) => {
                e.preventDefault();
                void handlePermanentDelete();
              }}
            >
              {working ? '删除中…' : '彻底删除'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
