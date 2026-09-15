'use client';

import { useCallback, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { PenLine } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { AppFooter } from '@/components/forgotit/app-footer';
import { AppHeader, type AppView } from '@/components/forgotit/app-header';
import { AskView } from '@/components/forgotit/ask-view';
import { NotesView, type NotesFilter } from '@/components/forgotit/notes-view';
import { NoteEditor } from '@/components/forgotit/note-editor';
import { TagsView } from '@/components/forgotit/tags-view';
import { TrashView } from '@/components/forgotit/trash-view';
import { BRAND } from '@/lib/brand';
import { getNote, type NoteDto, type TagWithCount } from '@/lib/api';

const INITIAL_FILTER: NotesFilter = { q: '', type: 'all', pinned: false, tag: null };

export default function Home() {
  const [view, setView] = useState<AppView>('notes');
  const [filter, setFilter] = useState<NotesFilter>(INITIAL_FILTER);
  const [refreshKey, setRefreshKey] = useState(0);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorNote, setEditorNote] = useState<NoteDto | null>(null);

  const bumpRefresh = useCallback(() => setRefreshKey((k) => k + 1), []);

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
    setFilter({ q: '', type: 'all', pinned: false, tag });
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
      <AppHeader view={view} onViewChange={setView} />

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
                refreshKey={refreshKey}
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
              <TagsView refreshKey={refreshKey} onSelectTag={handleSelectTag} />
            </motion.div>
          )}
          {view === 'trash' && (
            <motion.div key="trash" {...viewMotionProps}>
              <TrashView refreshKey={refreshKey} />
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      <AppFooter />

      {/* 新建笔记 FAB（仅笔记视图） */}
      <AnimatePresence>
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
      />
    </div>
  );
}
