'use client';

import { useCallback, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { BookOpenText, SendHorizonal } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { EmptyState } from '@/components/forgotit/empty-state';
import { Markdown } from '@/components/forgotit/markdown';
import { BRAND } from '@/lib/brand';
import { aiAsk, type AskCitation } from '@/lib/api';
import { cn } from '@/lib/utils';

interface AskViewProps {
  onOpenNote: (noteId: string) => void;
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text?: string;
  citations?: AskCitation[];
  pending?: boolean;
}

let msgSeq = 0;
function nextMsgId() {
  msgSeq += 1;
  return `msg-${Date.now()}-${msgSeq}`;
}

function LoadingDots() {
  return (
    <span className="inline-flex items-center gap-1 py-1" aria-label="AI 正在翻脑子">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="size-1.5 animate-bounce rounded-full bg-primary/70"
          style={{ animationDelay: `${i * 0.15}s` }}
        />
      ))}
    </span>
  );
}

export function AskView({ onOpenNote }: AskViewProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [asking, setAsking] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = useCallback(() => {
    requestAnimationFrame(() => {
      const el = scrollRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    });
  }, []);

  const ask = useCallback(
    async (question: string) => {
      const q = question.trim();
      if (!q || asking) return;
      setAsking(true);
      setDraft('');
      const placeholderId = nextMsgId();
      setMessages((prev) => [
        ...prev,
        { id: nextMsgId(), role: 'user', text: q },
        { id: placeholderId, role: 'assistant', pending: true },
      ]);
      scrollToBottom();
      try {
        const res = await aiAsk(q);
        setMessages((prev) =>
          prev.map((m) =>
            m.id === placeholderId
              ? { ...m, pending: false, text: res.answer, citations: res.citations ?? [] }
              : m
          )
        );
      } catch (err) {
        setMessages((prev) => prev.filter((m) => m.id !== placeholderId));
        toast.error(err instanceof Error ? err.message : '问脑子失败了，再试一次？');
      } finally {
        setAsking(false);
        scrollToBottom();
      }
    },
    [asking, scrollToBottom]
  );

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void ask(draft);
    }
  };

  return (
    <section aria-label="问答" className="flex flex-col space-y-4">
      {messages.length === 0 ? (
        <EmptyState title={BRAND.emptyTitle} description={`${BRAND.emptyDesc}，先问它两句试试。`}>
          <div className="flex flex-wrap items-center justify-center gap-2">
            {BRAND.exampleQuestions.map((q) => (
              <button
                key={q}
                type="button"
                disabled={asking}
                onClick={() => void ask(q)}
                className="inline-flex h-11 items-center rounded-full border bg-card px-4 text-sm text-muted-foreground transition-colors hover:border-primary/50 hover:text-primary disabled:opacity-60 sm:h-9"
              >
                {q}
              </button>
            ))}
          </div>
        </EmptyState>
      ) : (
        <div
          ref={scrollRef}
          className="max-h-[52dvh] min-h-40 space-y-4 overflow-y-auto rounded-xl border bg-card/50 p-4"
          aria-live="polite"
        >
          {messages.map((m) => (
            <motion.div
              key={m.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.25, ease: 'easeOut' }}
              className={cn('flex', m.role === 'user' ? 'justify-end' : 'justify-start')}
            >
              {m.role === 'user' ? (
                <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-primary px-4 py-2.5 text-sm leading-relaxed text-primary-foreground sm:max-w-[70%]">
                  {m.text}
                </div>
              ) : (
                <div className="max-w-[92%] space-y-2 sm:max-w-[80%]">
                  <div className="rounded-2xl rounded-bl-sm border bg-card px-4 py-3 text-sm leading-relaxed shadow-sm">
                    {m.pending ? (
                      <LoadingDots />
                    ) : (
                      <Markdown content={m.text ?? ''} />
                    )}
                  </div>
                  {m.citations && m.citations.length > 0 && (
                    <div className="max-h-96 space-y-2 overflow-y-auto pr-1" aria-label="引用来源">
                      {m.citations.map((c, i) => (
                        <button
                          key={`${m.id}-cite-${i}`}
                          type="button"
                          onClick={() => onOpenNote(c.noteId)}
                          className="flex w-full items-start gap-2.5 rounded-lg border bg-card p-3 text-left transition-colors hover:border-primary/40 hover:bg-accent/50"
                          aria-label={`打开引用来源：${c.title || '无标题笔记'}`}
                        >
                          <span className="mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/15 text-[11px] font-semibold text-primary">
                            {i + 1}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="flex items-center gap-1.5 text-sm font-medium">
                              <BookOpenText className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                              <span className="truncate">{c.title?.trim() || '无标题笔记'}</span>
                            </span>
                            <span className="mt-0.5 line-clamp-2 block text-xs leading-5 text-muted-foreground">
                              {c.snippet}
                            </span>
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </motion.div>
          ))}
        </div>
      )}

      {/* 提问输入框 */}
      <form
        className="flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void ask(draft);
        }}
      >
        <Textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={BRAND.searchPlaceholder}
          aria-label="向大脑提问"
          rows={1}
          className="min-h-11 flex-1 resize-none rounded-xl py-3 sm:min-h-10"
        />
        <Button
          type="submit"
          size="icon"
          aria-label="发送问题"
          disabled={asking || !draft.trim()}
          className="size-11 shrink-0 rounded-xl sm:size-11"
        >
          <SendHorizonal className="size-4" aria-hidden="true" />
        </Button>
      </form>
    </section>
  );
}
