import type { Activity, Diagnostic } from './types';

export const confusablePairs = [
  ['/b/', '/p/'], ['/d/', '/t/'], ['/f/', '/v/'], ['/m/', '/n/'], ['/ɪ/', '/iː/'], ['/æ/', '/e/']
];

export function findDependencyCycle(activities: Activity[]): string[] | null {
  const byId = new Map(activities.map((activity) => [activity.id, activity]));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  let cycle: string[] = [];
  const visit = (id: string, path: string[]): boolean => {
    if (visiting.has(id)) {
      cycle = [...path.slice(path.indexOf(id)), id];
      return true;
    }
    if (visited.has(id)) return false;
    visiting.add(id);
    const activity = byId.get(id);
    for (const dependency of activity?.dependencies ?? []) {
      if (visit(dependency, [...path, dependency])) return true;
    }
    visiting.delete(id);
    visited.add(id);
    return false;
  };
  for (const activity of activities) {
    if (visit(activity.id, [activity.id])) break;
  }
  return cycle.length ? cycle : null;
}

/** 直接或间接依赖 targetId 的全部活动（targetId 的下游）。 */
export function downstreamOf(activities: Activity[], targetIds: string[]): Set<string> {
  const targets = new Set(targetIds);
  const affected = new Set<string>();
  let changed = true;
  while (changed) {
    changed = false;
    for (const activity of activities) {
      if (affected.has(activity.id) || targets.has(activity.id)) continue;
      if (activity.dependencies.some((dep) => targets.has(dep) || affected.has(dep))) {
        affected.add(activity.id);
        changed = true;
      }
    }
  }
  return affected;
}

/** 教某个音素的活动（音素活动按出现顺序教，其它活动按使用对待）。 */
export function teachersOfPhoneme(activities: Activity[], phoneme: string): Activity[] {
  return activities.filter((activity) => activity.type === '音素' && activity.phonemes.includes(phoneme));
}

export function analyzeCourse(current: { activities: Activity[] }): Diagnostic[] {
  const activities = current.activities;
  const issues: Diagnostic[] = [];
  const learned = new Set<string>();
  const seenPhonemes: Array<{ activity: Activity; phoneme: string }> = [];

  activities.forEach((activity, index) => {
    activity.phonemes.forEach((phoneme) => {
      if (!learned.has(phoneme) && activity.type !== '音素') {
        issues.push({
          id: `early-${activity.id}-${phoneme}`, activityId: activity.id, level: 'error', category: '前置知识',
          title: `${activity.title} 提前使用 ${phoneme}`,
          detail: `第 ${index + 1} 个活动中使用了尚未单独教学的音素。请增加前置音素活动或调整顺序。`
        });
      }
      if (activity.type === '音素') learned.add(phoneme);
      seenPhonemes.push({ activity, phoneme });
    });

    if (activity.type === '句子') {
      const words = activity.content.trim().split(/\s+/).filter(Boolean);
      if (words.length > 12) issues.push({
        id: `long-${activity.id}`, activityId: activity.id, level: 'warning', category: '例句长度',
        title: `${activity.title} 包含 ${words.length} 个单词`,
        detail: '启蒙阶段建议控制在 12 个单词以内，或拆成两个意群。'
      });
    }

    if (activity.type === '练习' && !activity.feedback.trim()) issues.push({
      id: `feedback-${activity.id}`, activityId: activity.id, level: 'error', category: '练习反馈',
      title: `${activity.title} 缺少反馈`,
      detail: '答对或答错后需要给出可理解、可行动的学习反馈。'
    });

    if (!activity.accessibility.trim()) issues.push({
      id: `a11y-${activity.id}`, activityId: activity.id, level: 'error', category: '无障碍说明',
      title: `${activity.title} 缺少无障碍说明`,
      detail: '请说明视觉、听觉、运动或认知支持方式。'
    });

    activity.dependencies.forEach((dependency) => {
      if (!activities.some((item) => item.id === dependency)) issues.push({
        id: `missing-dep-${activity.id}-${dependency}`, activityId: activity.id, level: 'error', category: '依赖缺失',
        title: `${activity.title} 的依赖已不存在`, detail: '请移除失效依赖或重新选择前置活动。'
      });
    });
  });

  confusablePairs.forEach(([left, right]) => {
    const leftActivity = seenPhonemes.find((item) => item.phoneme === left)?.activity;
    const rightActivity = seenPhonemes.find((item) => item.phoneme === right)?.activity;
    if (leftActivity && rightActivity) issues.push({
      id: `confusable-${left}-${right}`, activityId: rightActivity.id, level: 'info', category: '相似音',
      title: `${left} 与 ${right} 可能混淆`,
      detail: `建议在“${leftActivity.title}”和“${rightActivity.title}”之间加入口型对比或辨音练习。`
    });
  });

  const cycle = findDependencyCycle(activities);
  if (cycle) issues.push({
    id: 'cycle', activityId: cycle[0], level: 'error', category: '依赖关系',
    title: '活动依赖形成循环', detail: cycle.join(' → ')
  });
  return issues;
}

export interface RecomputeNotice {
  id: string;
  at: string;
  /** null 表示全局（如版本合并后整门课程重算）。 */
  activityId: string | null;
  trigger: 'activity' | 'dependency' | 'phoneme' | 'order' | 'version';
  message: string;
}

export interface ActivityChange {
  id: string;
  kind: 'added' | 'removed' | 'moved' | 'modified';
  fields: string[];
  oldIndex: number | null;
  newIndex: number | null;
}

const FIELD_LABELS: Record<string, string> = {
  type: '类型', title: '标题', content: '内容', phonemes: '音素', dependencies: '依赖',
  difficulty: '难度', duration: '时长', prompt: '教师提示', accessibility: '无障碍说明', feedback: '练习反馈'
};

export function diffActivities(before: Activity[], after: Activity[]): ActivityChange[] {
  const changes: ActivityChange[] = [];
  const beforeMap = new Map(before.map((activity, index) => [activity.id, { activity, index }]));
  const afterMap = new Map(after.map((activity, index) => [activity.id, { activity, index }]));

  for (const [id, { activity, index: newIndex }] of afterMap) {
    const previous = beforeMap.get(id);
    if (!previous) {
      changes.push({ id, kind: 'added', fields: [], oldIndex: null, newIndex });
      continue;
    }
    const fields = Object.keys(FIELD_LABELS).filter((key) =>
      JSON.stringify((previous.activity as unknown as Record<string, unknown>)[key]) !== JSON.stringify((activity as unknown as Record<string, unknown>)[key])
    ).map((key) => FIELD_LABELS[key]);
    if (fields.length) changes.push({ id, kind: 'modified', fields, oldIndex: previous.index, newIndex });
    else if (previous.index !== newIndex) changes.push({ id, kind: 'moved', fields: [], oldIndex: previous.index, newIndex });
  }
  for (const [id, { index: oldIndex }] of beforeMap) {
    if (!afterMap.has(id)) changes.push({ id, kind: 'removed', fields: [], oldIndex, newIndex: null });
  }
  return changes;
}

/**
 * 活动、依赖或版本变化后，算出需要立即失效重算的下游活动和音素检查，并给出原因。
 * 检查本身是响应式即时重算的，这里负责说明“谁失效了、为什么”。
 */
export interface RecomputePlan {
  notices: RecomputeNotice[];
  /** 受影响活动 id；版本级变化时为 null（全部活动）。 */
  staleIds: string[] | null;
}

export function planRecompute(before: Activity[], after: Activity[], reason?: { trigger: RecomputeNotice['trigger']; message: string }): RecomputePlan {
  const notices: RecomputeNotice[] = [];
  const stale = new Set<string>();
  const push = (activityId: string | null, trigger: RecomputeNotice['trigger'], message: string) => {
    notices.push({ id: `recompute-${Date.now()}-${notices.length}-${activityId ?? 'all'}`, at: new Date().toISOString(), activityId, trigger, message });
    if (activityId) stale.add(activityId);
  };

  if (reason?.trigger === 'version') {
    push(null, 'version', reason.message);
    return { notices, staleIds: null };
  }

  const changes = diffActivities(before, after);
  const titleOf = (id: string): string => {
    const found = after.find((activity) => activity.id === id) ?? before.find((activity) => activity.id === id);
    return found?.title ?? id;
  };

  // 1) 依赖变化 / 活动增删改：下游活动（传递依赖者）的依赖完整性与循环检查失效。
  const dependencyChanges = new Set(changes.filter((change) => change.kind === 'modified' && change.fields.includes('依赖')).map((change) => change.id));
  const downstreamAfter = downstreamOf(after, changes.filter((change) => change.kind !== 'removed').map((change) => change.id));
  const downstreamBefore = downstreamOf(before, changes.filter((change) => change.kind === 'removed').map((change) => change.id));
  const downstream = new Set<string>([...downstreamAfter, ...downstreamBefore]);

  for (const id of downstream) {
    const removed = changes.find((change) => change.kind === 'removed');
    if (removed) {
      push(id, 'dependency', `上游活动「${titleOf(removed.id)}」被删除，本活动对它的依赖引用与循环检查立即重算。`);
      continue;
    }
    const depChange = changes.find((change) => dependencyChanges.has(change.id) && change.id !== id);
    if (depChange) {
      push(id, 'dependency', `上游「${titleOf(depChange.id)}」的依赖发生变化，本活动的传递依赖与循环检查已失效重算。`);
      continue;
    }
    const added = changes.find((change) => change.kind === 'added');
    if (added) {
      push(id, 'dependency', `新增活动「${titleOf(added.id)}」位于依赖链上游，本活动的下游检查立即重算。`);
      continue;
    }
    const movedOrModified = changes.find((change) => change.id !== id && (change.kind === 'moved' || change.kind === 'modified'));
    if (movedOrModified) {
      push(id, 'dependency', `上游活动「${titleOf(movedOrModified.id)}」发生变化，本活动的下游检查立即重算。`);
    }
  }

  // 2) 音素变化：教/用关系改变，相关活动的“提前使用、相似音”检查失效。
  const affectedPhonemes = new Set<string>();
  for (const change of changes) {
    const oldActivity = before.find((activity) => activity.id === change.id);
    const newActivity = after.find((activity) => activity.id === change.id);
    if (change.kind === 'removed' && oldActivity) {
      oldActivity.phonemes.forEach((phoneme) => affectedPhonemes.add(phoneme));
    } else if (newActivity && (change.kind === 'added' || change.fields.includes('音素'))) {
      newActivity.phonemes.forEach((phoneme) => affectedPhonemes.add(phoneme));
      oldActivity?.phonemes.forEach((phoneme) => affectedPhonemes.add(phoneme));
    }
  }
  for (const phoneme of affectedPhonemes) {
    for (const activity of after) {
      if (activity.type === '音素' || !activity.phonemes.includes(phoneme)) continue;
      push(activity.id, 'phoneme', `音素 ${phoneme} 的教学活动发生增删或调整，本活动对该音素的“提前使用/相似音”检查立即失效重算。`);
    }
  }

  // 3) 顺序变化：移动区间内的非音素活动，“先教后用”结果可能反转。
  for (const change of changes) {
    if (change.kind !== 'moved') continue;
    const moved = after.find((activity) => activity.id === change.id) ?? before.find((activity) => activity.id === change.id);
    const lo = Math.min(change.oldIndex ?? 0, change.newIndex ?? 0);
    const hi = Math.max(change.oldIndex ?? 0, change.newIndex ?? 0);
    after.slice(lo, hi + 1).forEach((activity) => {
      if (activity.type !== '音素' && activity.phonemes.length && activity.id !== change.id) {
        push(activity.id, 'order', `「${moved?.title ?? change.id}」从第 ${(change.oldIndex ?? 0) + 1} 位移到第 ${(change.newIndex ?? 0) + 1} 位，本活动处于移动区间，音素前置顺序检查立即重算。`);
      }
    });
  }

  return { notices: notices.slice(0, 80), staleIds: [...stale] };
}
