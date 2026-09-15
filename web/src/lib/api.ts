// 「记不住」前端 API 封装：类型 + fetch（含统一错误处理）
// 与后端契约一一对应，全部走相对路径。

export type TagKind = 'category' | 'free';
export type NoteType = 'text' | 'image' | 'mixed';

export interface TagDto {
  id: string;
  name: string;
  kind: TagKind;
  color?: string | null;
  source?: 'ai' | 'user';
}

export interface TagWithCount extends TagDto {
  count: number;
}

export interface AttachmentDto {
  id: string;
  filePath: string;
  mimeType: string;
  description?: string | null;
  ocrText?: string | null;
  createdAt: string;
}

export interface NoteDto {
  id: string;
  type: NoteType;
  title?: string | null;
  content?: string | null;
  summary?: string | null;
  localOnly: boolean;
  pinned: boolean;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
  tags: TagDto[];
  attachments: AttachmentDto[];
}

export interface StatsDto {
  notes: number;
  images: number;
  tags: number;
  trash: number;
}

export interface AskCitation {
  noteId: string;
  title: string;
  snippet: string;
}

export interface AskResult {
  answer: string;
  citations: AskCitation[];
}

export interface NotesQuery {
  q?: string;
  type?: 'all' | 'text' | 'image';
  pinned?: boolean;
  tagId?: string;
  view?: 'all' | 'trash';
}

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...(init?.headers ?? {}),
      },
    });
  } catch {
    throw new ApiError('网络请求失败，请稍后再试', 0);
  }

  let data: unknown = null;
  const text = await res.text();
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      // 非 JSON 响应体，保持 data = null
    }
  }

  if (!res.ok) {
    const msg =
      data &&
      typeof data === 'object' &&
      'error' in data &&
      typeof (data as { error: unknown }).error === 'string'
        ? (data as { error: string }).error
        : `请求失败（HTTP ${res.status}）`;
    throw new ApiError(msg, res.status);
  }

  return data as T;
}

function buildQuery(params: Record<string, string | number | boolean | undefined>): string {
  const sp = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === '') continue;
    sp.set(key, String(value));
  }
  const qs = sp.toString();
  return qs ? `?${qs}` : '';
}

// ---------- 笔记 ----------

export function listNotes(query: NotesQuery = {}, signal?: AbortSignal): Promise<{ notes: NoteDto[] }> {
  const qs = buildQuery({
    q: query.q,
    type: query.type && query.type !== 'all' ? query.type : undefined,
    pinned: query.pinned ? 1 : undefined,
    tagId: query.tagId,
    view: query.view && query.view !== 'all' ? query.view : undefined,
  });
  return request(`/api/notes${qs}`, { signal });
}

export function getNote(id: string, signal?: AbortSignal): Promise<{ note: NoteDto }> {
  return request(`/api/notes/${id}`, { signal });
}

export interface CreateNoteBody {
  title?: string;
  content?: string;
  type?: NoteType;
  localOnly?: boolean;
  attachmentIds?: string[];
}

export function createNote(body: CreateNoteBody, signal?: AbortSignal): Promise<{ note: NoteDto }> {
  return request('/api/notes', { method: 'POST', body: JSON.stringify(body), signal });
}

export interface UpdateNoteBody {
  title?: string;
  content?: string;
  pinned?: boolean;
  localOnly?: boolean;
  type?: NoteType;
}

export function updateNote(id: string, body: UpdateNoteBody, signal?: AbortSignal): Promise<{ note: NoteDto }> {
  return request(`/api/notes/${id}`, { method: 'PUT', body: JSON.stringify(body), signal });
}

export function deleteNote(id: string, opts: { permanent?: boolean } = {}, signal?: AbortSignal): Promise<{ ok: boolean }> {
  const qs = opts.permanent ? '?permanent=1' : '';
  return request(`/api/notes/${id}${qs}`, { method: 'DELETE', signal });
}

export function restoreNote(id: string, signal?: AbortSignal): Promise<{ note: NoteDto }> {
  return request(`/api/notes/${id}/restore`, { method: 'POST', signal });
}

export function aiOrganize(id: string, signal?: AbortSignal): Promise<{ note: NoteDto }> {
  return request(`/api/notes/${id}/ai-organize`, { method: 'POST', signal });
}

// ---------- AI ----------

export function aiAsk(question: string, signal?: AbortSignal): Promise<AskResult> {
  return request('/api/ai/ask', { method: 'POST', body: JSON.stringify({ question }), signal });
}

export interface UploadAttachmentBody {
  noteId?: string;
  dataUrl: string;
  mimeType: string;
}

export function uploadAttachment(body: UploadAttachmentBody, signal?: AbortSignal): Promise<{ attachment: AttachmentDto }> {
  return request('/api/ai/attachments', { method: 'POST', body: JSON.stringify(body), signal });
}

// ---------- 标签 / 统计 / 种子 ----------

export function getTags(signal?: AbortSignal): Promise<{ categories: TagWithCount[]; free: TagWithCount[] }> {
  return request('/api/tags', { signal });
}

export function getStats(signal?: AbortSignal): Promise<StatsDto> {
  return request('/api/stats', { signal });
}

export function seedDemoData(signal?: AbortSignal): Promise<{ ok: boolean }> {
  return request('/api/seed', { method: 'POST', signal });
}
