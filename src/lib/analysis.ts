// 课程质量检查 + 失效重算说明。
//
// 诊断结果是课程状态的派生数据：活动、依赖或版本一旦变化，受影响的下游活动与
// 音素检查立即失效并按新状态重算。describeInvalidation 解释“为什么失效、影响谁”。

import type {
  Activity,
  ActivityFieldKey,
  Course,
  Diagnostic,
  InvalidationNotice
} from './types';

const confusablePairs: Array<[string, string]> = [
  ['/b/', '/p/'],
  ['/d/', '/t/'],
  ['/f/', '/v/'],
  ['/m/', '/n/'],
  ['/ɪ/', '/iː/'],
  ['/æ/', '/e/']
];

export type ChangeTrigger =
  | { kind: 'activity'; activityId: string; fields: ActivityFieldKey[] }
  | { kind: 'add'; activityId: string }
  | { kind: 'remove'; activityId: string }
  | { kind: 'order' }
  | { kind: 'merge'; detail?: string };

export function analyzeCourse(current: Course): Diagnostic[] {
  const issues: Diagnostic[] = [];
  const learned = new Set<string>();
  const seenPhonemes: Array<{ activity: Activity; phoneme: string }> = [];

  current.activities.forEach((activity, index) => {
    activity.phonemes.forEach((phoneme) => {
      if (!learned.has(phoneme) && activity.type !== '音素') {
        issues.push({
          id: `early-${activity.id}-${phoneme}`,
          activityId: activity.id,
          level: 'error',
          category: '前置知识',
          title: `${activity.title} 提前使用 ${phoneme}`,
          detail: `第 ${index + 1} 个活动中使用了尚未单独教学的音素。请增加前置音素活动或调整顺序。`
        });
      }
      if (activity.type === '音素') learned.add(phoneme);
      seenPhonemes.push({ activity, phoneme });
    });

    if (activity.type === '句子') {
      const words = activity.content.trim().split(/\s+/).filter(Boolean);
      if (words.length > 12) {
        issues.push({
          id: `long-${activity.id}`,
          activityId: activity.id,
          level: 'warning',
          category: '例句长度',
          title: `${activity.title} 包含 ${words.length} 个单词`,
          detail: '启蒙阶段建议控制在 12 个单词以内，或拆成两个意群。'
        });
      }
    }

    if (activity.type === '练习' && !activity.feedback.trim()) {
      issues.push({
        id: `feedback-${activity.id}`,
        activityId: activity.id,
        level: 'error',
        category: '练习反馈',
        title: `${activity.title} 缺少反馈`,
        detail: '答对或答错后需要给出可理解、可行动的学习反馈。'
      });
    }

    if (!activity.accessibility.trim()) {
      issues.push({
        id: `a11y-${activity.id}`,
        activityId: activity.id,
        level: 'error',
        category: '无障碍说明',
        title: `${activity.title} 缺少无障碍说明`,
        detail: '请说明视觉、听觉、运动或认知支持方式。'
      });
    }

    activity.dependencies.forEach((dependency) => {
      if (!current.activities.some((item) => item.id === dependency)) {
        issues.push({
          id: `missing-dep-${activity.id}-${dependency}`,
          activityId: activity.id,
          level: 'error',
          category: '依赖缺失',
          title: `${activity.title} 的依赖已不存在`,
          detail: '合并保留了对方版本的依赖但目标活动缺失。请移除失效依赖或补回该活动（依赖未被丢弃）。'
        });
      }
    });
  });

  confusablePairs.forEach(([left, right]) => {
    const leftActivity = seenPhonemes.find((item) => item.phoneme === left)?.activity;
    const rightActivity = seenPhonemes.find((item) => item.phoneme === right)?.activity;
    if (leftActivity && rightActivity) {
      issues.push({
        id: `confusable-${left}-${right}`,
        activityId: rightActivity.id,
        level: 'info',
        category: '相似音',
        title: `${left} 与 ${right} 可能混淆`,
        detail: `建议在“${leftActivity.title}”和“${rightActivity.title}”之间加入口型对比或辨音练习。`
      });
    }
  });

  const cycle = findDependencyCycle(current.activities);
  if (cycle) {
    issues.push({
      id: 'cycle',
      activityId: cycle[0],
      level: 'error',
      category: '依赖关系',
      title: '活动依赖形成循环',
      detail: cycle.join(' → ')
    });
  }
  return issues;
}

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

/** 反向依赖图：谁（传递地）依赖给定活动，即变化后的下游活动。 */
export function downstreamActivities(activities: Activity[], seedIds: string[]): string[] {
  const dependents = new Map<string, Set<string>>();
  for (const activity of activities) {
    for (const dependency of activity.dependencies) {
      if (!dependents.has(dependency)) dependents.set(dependency, new Set());
      dependents.get(dependency)?.add(activity.id);
    }
  }
  const result = new Set<string>();
  const queue = [...seedIds];
  while (queue.length) {
    const id = queue.shift() as string;
    for (const dependent of dependents.get(id) ?? []) {
      if (!result.has(dependent) && !seedIds.includes(dependent)) {
        result.add(dependent);
        queue.push(dependent);
      }
    }
  }
  return [...result];
}

const CHECK_LABELS = {
  phonics: '音素提前使用检查',
  confusable: '相似音混淆检查',
  dependency: '依赖循环与失效引用检查',
  length: '例句长度检查',
  feedback: '练习反馈检查',
  a11y: '无障碍说明检查'
} as const;

export interface InvalidationDescription {
  title: string;
  reason: string;
  affectedActivityIds: string[];
  invalidatedChecks: string[];
}

/**
 * 根据变化触发器，说明哪些检查立即失效、为什么、影响哪些下游活动。
 * 音素检查（提前使用、相似音）依赖活动顺序与音素集合，顺序/音素/增删一改即全局失效；
 * 依赖变化使相关下游活动的循环与失效引用检查失效。
 */
export function describeInvalidation(
  trigger: ChangeTrigger,
  activities: Activity[]
): InvalidationDescription {
  const affected: Set<string> = new Set();
  const checks = new Set<string>();
  let title = '';
  let reason = '';

  const addChecks = (...items: Array<keyof typeof CHECK_LABELS>) => {
    items.forEach((item) => checks.add(CHECK_LABELS[item]));
  };

  if (trigger.kind === 'merge') {
    activities.forEach((activity) => affected.add(activity.id));
    addChecks('phonics', 'confusable', 'dependency', 'length', 'feedback', 'a11y');
    title = '课程包合并：全部检查失效重算';
    reason =
      trigger.detail ??
      '合并同时改变了活动集合、顺序、说明与依赖，所有基于课程顺序与依赖图的结论都不再可靠，已按合并结果全部重算。';
  } else if (trigger.kind === 'order') {
    activities.forEach((activity) => affected.add(activity.id));
    addChecks('phonics', 'confusable');
    title = '活动顺序变化：音素检查失效重算';
    reason =
      '“提前使用音素”和“相似音”按课程先后顺序推导，顺序一变旧结论立即失效，已按新顺序重算。';
  } else if (trigger.kind === 'add' || trigger.kind === 'remove') {
    const activity = activities.find((item) => item.id === trigger.activityId);
    const seed = trigger.kind === 'remove' ? [trigger.activityId] : [trigger.activityId];
    downstreamActivities(activities, seed).forEach((id) => affected.add(id));
    addChecks('phonics', 'confusable', 'dependency');
    title =
      trigger.kind === 'add'
        ? `新增活动${activity ? `“${activity.title}”` : ''}：相关检查失效重算`
        : `删除活动：下游与音素检查失效重算`;
    reason =
      trigger.kind === 'add'
        ? '新增活动改变了音素教学顺序和依赖图，其下游活动的前置音素与依赖结论立即重算。'
        : '活动删除后，引用它的下游活动依赖失效，且音素教学集合变化，相关检查立即重算（悬空依赖会被保留并报告）。';
  } else {
    const { activityId, fields } = trigger;
    const activity = activities.find((item) => item.id === activityId);
    downstreamActivities(activities, [activityId]).forEach((id) => affected.add(id));
    affected.add(activityId);

    if (fields.includes('dependencies')) {
      addChecks('dependency');
    }
    if (fields.includes('phonemes') || fields.includes('type')) {
      addChecks('phonics', 'confusable');
      activities.forEach((item) => affected.add(item.id));
    }
    if (fields.includes('content')) addChecks('length');
    if (fields.includes('feedback')) addChecks('feedback');
    if (fields.includes('accessibility')) addChecks('a11y');

    title = `活动“${activity?.title ?? activityId}”变化：相关检查失效重算`;
    const reasons: string[] = [];
    if (fields.includes('dependencies')) {
      reasons.push('依赖变化后，依赖它的下游活动的可达性、循环与失效引用结论立即失效');
    }
    if (fields.includes('phonemes') || fields.includes('type')) {
      reasons.push('音素或活动类型变化后，“提前使用/相似音”依赖全局教学顺序，需对全部活动重算');
    }
    if (fields.includes('content')) reasons.push('例句内容变化，长度结论失效');
    if (fields.includes('feedback')) reasons.push('反馈内容变化，反馈完整性结论失效');
    if (fields.includes('accessibility')) reasons.push('无障碍说明变化，该项检查失效');
    reason = reasons.join('；') + '。已按最新内容立即重算。';
  }

  return {
    title,
    reason,
    affectedActivityIds: [...affected],
    invalidatedChecks: [...checks]
  };
}

export function buildInvalidationNotice(
  trigger: ChangeTrigger,
  activities: Activity[],
  at = new Date().toISOString()
): InvalidationNotice {
  const description = describeInvalidation(trigger, activities);
  return {
    id: `inv-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    at,
    ...description
  };
}
