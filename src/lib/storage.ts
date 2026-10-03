// 本地持久化：课程主存储（乐观并发）、待处理课程包、失败草稿、失效记录。
//
// 乐观并发：每次提交带 expectedRevision，只有与主存储中的 revision 相等才落库，
// revision 落库后 +1。两个标签页基于同一旧版本提交时，先提交的成功，
// 后提交的失败并保留草稿，提示重载——不会覆盖先提交的内容。

import type {
  Course,
  InvalidationNotice,
  PendingItem,
  StashedDraft
} from './types';

export const STORAGE_KEY = 'sologsb-1026-phonics-course-v2';
const LEGACY_STORAGE_KEY = 'sologsb-1026-phonics-course-v1';
const PENDING_KEY = 'sologsb-1026-phonics-pending-v1';
const STASH_KEY = 'sologsb-1026-phonics-stash-v1';
const INVALIDATION_KEY = 'sologsb-1026-phonics-invalidation-v1';

export interface CommitResult {
  ok: boolean;
  course?: Course;
  remoteRevision: number;
  reason?: 'stale-revision';
}

function readJson<T>(key: string): T | null {
  const raw = localStorage.getItem(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/** 读取主存储中的当前课程与 revision（不做迁移）。 */
export function readStoredCourse(): Course | null {
  return readJson<Course>(STORAGE_KEY);
}

export function readLegacyCourse(): unknown {
  return readJson<unknown>(LEGACY_STORAGE_KEY);
}

/**
 * 乐观提交。expectedRevision 必须等于主存储当前 revision 才允许写入。
 * 写入成功后 revision +1。
 */
export function commitCourse(course: Course, expectedRevision: number): CommitResult {
  const stored = readStoredCourse();
  const remoteRevision = stored?.revision ?? 0;
  if (stored && remoteRevision !== expectedRevision) {
    return { ok: false, remoteRevision, reason: 'stale-revision' };
  }
  const next: Course = {
    ...structuredClone(course),
    revision: remoteRevision + 1,
    updatedAt: new Date().toISOString()
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  return { ok: true, course: next, remoteRevision: next.revision };
}

/** 仅本标签页首次载入时使用：无主存储则初始化，有则读取。 */
export function bootstrapCourse(fallback: Course): Course {
  const stored = readStoredCourse();
  if (stored) return stored;
  const initial: Course = { ...structuredClone(fallback), revision: 1 };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(initial));
  return initial;
}

// --- 待处理项（合并评审、失败后仍能继续处理） ---

export function readPendingItems(): PendingItem[] {
  return readJson<PendingItem[]>(PENDING_KEY) ?? [];
}

export function writePendingItems(items: PendingItem[]): void {
  localStorage.setItem(PENDING_KEY, JSON.stringify(items));
}

export function addPendingItem(item: PendingItem): void {
  writePendingItems([item, ...readPendingItems()].slice(0, 20));
}

export function removePendingItem(id: string): void {
  writePendingItems(readPendingItems().filter((item) => item.id !== id));
}

// --- 失败草稿（后提交方保留） ---

export function readStashedDrafts(): StashedDraft[] {
  return readJson<StashedDraft[]>(STASH_KEY) ?? [];
}

export function addStashedDraft(draft: StashedDraft): void {
  localStorage.setItem(STASH_KEY, JSON.stringify([draft, ...readStashedDrafts()].slice(0, 10)));
}

export function removeStashedDraft(id: string): void {
  localStorage.setItem(STASH_KEY, JSON.stringify(readStashedDrafts().filter((draft) => draft.id !== id)));
}

// --- 失效重算记录 ---

export function readInvalidations(): InvalidationNotice[] {
  return readJson<InvalidationNotice[]>(INVALIDATION_KEY) ?? [];
}

export function addInvalidation(notice: InvalidationNotice): void {
  const items = [notice, ...readInvalidations()].slice(0, 30);
  localStorage.setItem(INVALIDATION_KEY, JSON.stringify(items));
}

export function clearInvalidations(): void {
  localStorage.removeItem(INVALIDATION_KEY);
}

/** 订阅主存储变化（其他标签页提交后通知本标签页重载）。 */
export function subscribeStorage(handler: (key: string) => void): () => void {
  const listener = (event: StorageEvent) => {
    if (event.key) handler(event.key);
  };
  window.addEventListener('storage', listener);
  return () => window.removeEventListener('storage', listener);
}
