'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ClipboardPaste, PenLine } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { AppFooter } from '@/components/forgotit/app-footer';
import { AppHeader, type AppView } from '@/components/forgotit/app-header';
import { AskView } from '@/components/forgotit/ask-view';
import { NotesView, type NotesFilter } from '@/components/forgotit/notes-view';
import { NoteEditor } from '@/components/forgotit/note-editor';
import { SyncPanel } from '@/components/forgotit/sync-panel';
import { TagsView } from '@/components/forgotit/tags-view';
import { TrashView } from '@/components/forgotit/trash-view';
import { BRAND } from '@/lib/brand';
import { getAiConfig, getNote, type NoteDto, type TagWithCount } from '@/lib/api';
import { extractFromClipboard, isEditableTarget, quickCapture } from '@/lib/clipboard-capture';
import { useSyncStore } from '@/lib/sync-store';

const INITIAL_FILTER: NotesFilter = { q: '', type: 'all', pinned: false, tag: null, mode: 'keyword' };

export default function Home() {
  const [view, setView] = useState<AppView>('notes');
  const [filter, setFilter] = useState<NotesFilter>(INITIAL_FILTER);
  const [refreshKey, setRefreshKey] = useState(0);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorNote, setEditorNote] = useState<NoteDto | null>(null);
  const [backgroundTasks, setBackgroundTasks] = useState<Record<string, string>>({});
  const backgroundMessages = Object.values(backgroundTasks);
  const backgroundTask =
    backgroundMessages.length > 0
      ? `${backgroundMessages[0]}${backgroundMessages.length > 1 ? `（另有 ${backgroundMessages.length - 1} 项任务）` : ''}`
      : null;

  // 同步引擎：初始化 + 服务端变更驱动列表刷新
  const initSync = useSyncStore((s) => s.init);
  const dataVersion = useSyncStore((s) => s.dataVersion);
  useEffect(() => {
    initSync();
  }, [initSync]);

  const bumpRefresh = useCallback(() => setRefreshKey((k) => k + 1), []);
  // 同步引擎拉到服务端变更时也会触发全列表刷新
  const combinedRefresh = refreshKey + dataVersion;

  // ---------- 剪贴板快记（任意位置 Ctrl+V 直接成笔记） ----------
  const [aiReady, setAiReady] = useState(false);
  const capturingRef = useRef(false);

  // 探测 AI 是否已配置（决定粘贴后是否自动 AI 解析；窗口重新聚焦时刷新）
  useEffect(() => {
    let cancelled = false;
    const probe = () => {
      getAiConfig()
        .then((info) => {
          if (!cancelled) setAiReady(info.configured);
        })
        .catch(() => {
          // 探测失败不阻塞快记（按未配置处理，仅少了自动 AI 解析）
        });
    };
    probe();
    window.addEventListener('focus', probe);
    return () => {
      cancelled = true;
      window.removeEventListener('focus', probe);
    };
  }, []);

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      // 输入控件内放行原生粘贴（搜索框/问答框不受影响）
      if (isEditableTarget(e.target)) return;
      if (capturingRef.current) return;
      const captured = extractFromClipboard(e.clipboardData);
      if (!captured) return; // 剪贴板无可用内容
      e.preventDefault();
      capturingRef.current = true;
      const offline = useSyncStore.getState().offlineMode;
      const willOrganize = aiReady && !offline;
      const toastId = toast.loading(
        captured.imageFiles.length > 0 ? '正在看图记下…' : '正在记下剪贴板内容…'
      );
      quickCapture(captured, aiReady)
        .then((result) => {
          if (result.organizeLevel === 'device') {
            toast.success('已记下，设备上的 AI 也整理好了。', { id: toastId });
          } else if (result.organizeLevel === 'server') {
            toast.success('已记下，AI 也整理好了。', { id: toastId });
          } else if (willOrganize) {
            toast.warning('已记下，但 AI 整理没成功，稍后可在笔记里重新整理。', { id: toastId });
          } else {
            toast.success(offline ? '已先记在本地，联网后自动同步。' : '已记下。', { id: toastId });
          }
          if (result.ocrUsed) {
            toast.info('图里的文字已经识别进正文了。');
          }
          if (result.failedImages > 0) {
            toast.warning(`${result.failedImages} 张图片没能存上${offline ? '（离线暂不支持图片）' : ''}`);
          }
          bumpRefresh();
        })
        .catch((err) => {
          toast.error(err instanceof Error ? err.message : '粘贴记录失败，请重试', { id: toastId });
        })
        .finally(() => {
          capturingRef.current = false;
        });
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, [aiReady, bumpRefresh]);

  // 快记提示浮条：首次进笔记视图展示一次（localStorage 记忆，8s 自动消失；触屏无键盘场景隐藏）
  const [notesHint, setNotesHint] = useState(false);
  useEffect(() => {
    if (view !== 'notes') return;
    if (localStorage.getItem('forgotit.paste-hint-seen')) return;
    // setState 放在定时器回调里（避免 effect 体内同步 setState 的级联渲染）
    const show = setTimeout(() => setNotesHint(true), 50);
    const hide = setTimeout(() => {
      setNotesHint(false);
      localStorage.setItem('forgotit.paste-hint-seen', '1');
    }, 8000);
    return () => {
      clearTimeout(show);
      clearTimeout(hide);
    };
  }, [view]);

  const openNewNote = useCallback(() => {
    setEditorNote(null);
    setEditorOpen(true);
  }, []);

  const openNoteById = useCallback(async (noteId: string) => {
    try {
      const res = await getNote(noteId);
      setEditorNote(res.note);
      setEditorOpen(true);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '打开笔记失败');
    }
  }, []);

  const handleSelectTag = useCallback((tag: TagWithCount) => {
    setFilter({ q: '', type: 'all', pinned: false, tag, mode: 'keyword' });
    setView('notes');
  }, []);

  const viewMotionProps = {
    initial: { opacity: 0, y: 8 },
    animate: { opacity: 1, y: 0 },
    exit: { opacity: 0, y: -8 },
    transition: { duration: 0.22, ease: 'easeOut' as const },
  };

  return (
    <div className="flex min-h-screen flex-col">
      <AppHeader view={view} onViewChange={setView} backgroundTask={view === 'notes' ? backgroundTask : null} />

      <h1 className="sr-only">{`${BRAND.appName} — ${BRAND.slogan}，${BRAND.tagline}`}</h1>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:py-8">
        {/* 问答视图常驻（隐藏保状态），其余视图按需挂载 */}
        <div className={view === 'ask' ? '' : 'hidden'}>
          <AskView onOpenNote={(id) => void openNoteById(id)} />
        </div>

        <AnimatePresence mode="wait">
          {view === 'notes' && (
            <motion.div key="notes" {...viewMotionProps}>
              <NotesView
                filter={filter}
                onFilterChange={setFilter}
                refreshKey={combinedRefresh}
                onEditNote={(note) => {
                  setEditorNote(note);
                  setEditorOpen(true);
                }}
                onNewNote={openNewNote}
              />
            </motion.div>
          )}
          {view === 'tags' && (
            <motion.div key="tags" {...viewMotionProps}>
              <TagsView refreshKey={combinedRefresh} onSelectTag={handleSelectTag} />
            </motion.div>
          )}
          {view === 'trash' && (
            <motion.div key="trash" {...viewMotionProps}>
              <TrashView refreshKey={combinedRefresh} />
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      <AppFooter />

      <SyncPanel />

      {/* 新建笔记 FAB（仅笔记视图） + 快记提示 */}
      <AnimatePresence>
        {view === 'notes' && notesHint && (
          <motion.div
            key="paste-hint"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ duration: 0.2 }}
            aria-hidden="true"
            className="fixed bottom-20 right-6 z-40 hidden items-center gap-1.5 rounded-full border bg-card/90 px-3 py-1.5 text-xs text-muted-foreground shadow-sm backdrop-blur md:bottom-24 md:flex"
          >
            <ClipboardPaste className="size-3.5" />
            随时 Ctrl+V 粘贴，直接记下
          </motion.div>
        )}
        {view === 'notes' && (
          <motion.div
            key="fab"
            initial={{ opacity: 0, scale: 0.85 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.85 }}
            transition={{ duration: 0.18 }}
            className="fixed bottom-20 right-6 z-40 md:bottom-6"
          >
            <Button
              size="lg"
              aria-label="记一条新笔记"
              className="h-14 rounded-full bg-primary px-5 text-base font-semibold text-primary-foreground shadow-lg shadow-primary/25 hover:bg-primary/90"
              onClick={openNewNote}
            >
              <PenLine className="size-5" aria-hidden="true" />
              记一条
            </Button>
          </motion.div>
        )}
      </AnimatePresence>

      <NoteEditor
        open={editorOpen}
        note={editorNote}
        onOpenChange={setEditorOpen}
        onSaved={bumpRefresh}
        onBackgroundWorkChange={(taskId, message) => {
          setBackgroundTasks((current) => {
            if (message) return { ...current, [taskId]: message };
            const next = { ...current };
            delete next[taskId];
            return next;
          });
          if (message) setView('notes');
        }}
      />
    </div>
  );
}
