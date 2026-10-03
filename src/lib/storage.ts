import type { Course } from './types';
import type { CoursePackage } from './course-merge';

export const STORAGE_KEY = 'sologsb-1026-phonics-course-v1';
const PENDING_KEY = 'sologsb-1026-pending-merges-v1';
const DRAFT_PREFIX = 'sologsb-1026-rejected-draft-v1';

export interface PendingMerge {
  id: string;
  queuedAt: string;
  pkg: CoursePackage;
  /** 草稿来源标签页在冲突后被保留时，带上其基于的课程版本号。 */
  baseRevision: number;
}

export interface RejectedDraft {
  id: string;
  savedAt: string;
  baseRevision: number;
  currentRevision: number;
  label: string;
  course: Course;
}

export interface CommitResult {
  ok: boolean;
  /** 提交后存储中的权威课程；失败时为另一个标签页已提交的版本。 */
  stored: Course;
  /** 失败时保留下来的草稿 id。 */
  draftId?: string;
  reason?: string;
}

function safeParse<T>(raw: string | null): T | null {
  if (!raw) return null;
  try { return JSON.parse(raw) as T; } catch { return null; }
}

export function loadStoredCourse(): Course | null {
  return safeParse<Course>(localStorage.getItem(STORAGE_KEY));
}

export function loadPendingMerges(): PendingMerge[] {
  return safeParse<PendingMerge[]>(localStorage.getItem(PENDING_KEY)) ?? [];
}

function savePendingMerges(items: PendingMerge[]): void {
  localStorage.setItem(PENDING_KEY, JSON.stringify(items));
}

export function enqueuePendingMerge(pkg: CoursePackage, baseRevision: number): PendingMerge[] {
  const items = loadPendingMerges();
  if (!items.some((item) => item.pkg.exportedAt === pkg.exportedAt && item.pkg.exportedBy === pkg.exportedBy)) {
    items.push({ id: `pending-${Date.now()}`, queuedAt: new Date().toISOString(), pkg, baseRevision });
    savePendingMerges(items);
  }
  return items;
}

export function removePendingMerge(id: string): PendingMerge[] {
  const items = loadPendingMerges().filter((item) => item.id !== id);
  savePendingMerges(items);
  return items;
}

export function listRejectedDrafts(): RejectedDraft[] {
  const drafts: RejectedDraft[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key?.startsWith(DRAFT_PREFIX)) {
      const draft = safeParse<RejectedDraft>(localStorage.getItem(key));
      if (draft) drafts.push(draft);
    }
  }
  return drafts.sort((a, b) => b.savedAt.localeCompare(a.savedAt));
}

function saveRejectedDraft(draft: RejectedDraft): string {
  const key = `${DRAFT_PREFIX}:${draft.id}`;
  localStorage.setItem(key, JSON.stringify(draft));
  return draft.id;
}

export function discardRejectedDraft(id: string): void {
  localStorage.removeItem(`${DRAFT_PREFIX}:${id}`);
}

/**
 * 乐观并发提交：两个标签页同时基于同一旧版本提交时，只有先提交者写入；
 * 后提交者的课程保留为草稿（不覆盖先提交内容），待处理合并队列不动。
 */
export function commitCourse(next: Course, expectedRevision: number): CommitResult {
  const stored = loadStoredCourse();
  if (!stored) {
    const toSave: Course = { ...next, revision: Math.max(next.revision, expectedRevision) + 1 };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave));
    return { ok: true, stored: toSave };
  }
  if (stored.revision === expectedRevision) {
    const toSave: Course = { ...next, revision: expectedRevision + 1 };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave));
    return { ok: true, stored: toSave };
  }
  // 存储版本已领先：另一个标签页先提交了。保留草稿，绝不覆盖。
  const draftId = `draft-${Date.now()}`;
  const draft: RejectedDraft = {
    id: draftId,
    savedAt: new Date().toISOString(),
    baseRevision: expectedRevision,
    currentRevision: stored.revision,
    label: `基于版本 ${expectedRevision} 的草稿（当前已是版本 ${stored.revision}）`,
    course: { ...next, revision: expectedRevision }
  };
  saveRejectedDraft(draft);
  return {
    ok: false,
    stored,
    draftId,
    reason: `另一个标签页已先提交版本 ${stored.revision}，本次提交保留为草稿，请重载后通过合并处理。`
  };
}

/** 重载时以存储课程为准（本地未提交的修改若存在会先进入提交流，冲突同样走草稿保留）。 */
export function overwriteCourseLocally(course: Course): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(course));
}
