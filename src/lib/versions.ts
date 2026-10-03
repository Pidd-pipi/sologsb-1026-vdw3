// 版本比较与课程包导入导出。

import type {
  Activity,
  Course,
  CoursePackage,
  CourseVersion,
  VersionDiff
} from './types';

export function compareCourseVersions(
  current: Course,
  baseId: string,
  targetId: string
): VersionDiff[] {
  const base = current.versions.find((version) => version.id === baseId);
  const target = current.versions.find((version) => version.id === targetId);
  if (!base || !target) return [];
  const rows: VersionDiff[] = [];
  const baseMap = new Map(base.activities.map((activity) => [activity.id, activity]));
  const targetMap = new Map(target.activities.map((activity) => [activity.id, activity]));
  for (const activity of base.activities) {
    if (!targetMap.has(activity.id)) {
      rows.push({ id: activity.id, title: activity.title, kind: 'removed', detail: '目标版本已删除该活动' });
    }
  }
  for (const activity of target.activities) {
    const before = baseMap.get(activity.id);
    if (!before) {
      rows.push({ id: activity.id, title: activity.title, kind: 'added', detail: `${activity.type} · ${activity.duration} 分钟` });
      continue;
    }
    const fields: string[] = [];
    if (before.title !== activity.title) fields.push('标题');
    if (before.content !== activity.content) fields.push('内容');
    if (before.difficulty !== activity.difficulty) fields.push('难度');
    if (before.duration !== activity.duration) fields.push('时长');
    if (JSON.stringify(before.dependencies) !== JSON.stringify(activity.dependencies)) fields.push('依赖');
    if (before.prompt !== activity.prompt || before.accessibility !== activity.accessibility) fields.push('提示或无障碍');
    if (before.feedback !== activity.feedback) fields.push('练习反馈');
    if (fields.length) rows.push({ id: activity.id, title: activity.title, kind: 'changed', detail: `变化字段：${fields.join('、')}` });
  }
  return rows;
}

/** 基于一个已存档版本导出课程包（带来源版本号与活动快照）。 */
export function exportCoursePackage(
  course: Course,
  version: CourseVersion,
  sender: string,
  now = new Date().toISOString()
): CoursePackage {
  return {
    kind: 'phonics-course-package',
    packageVersion: 1,
    courseId: course.id,
    baseRevision: course.revision,
    baseVersionId: version.id,
    baseVersionLabel: version.label,
    exportedAt: now,
    sender: sender.trim() || '同事',
    baseActivities: structuredClone(version.activities),
    activities: structuredClone(course.activities)
  };
}

/** 用当前活动表新建一个存档版本。 */
export function createVersionSnapshot(course: Course, label?: string, note?: string): CourseVersion {
  const number = course.versions.length + 1;
  return {
    id: `v-${Date.now()}`,
    label: label ?? `版本 ${number}`,
    savedAt: new Date().toISOString(),
    note:
      note ??
      `保存 ${course.activities.length} 个活动，总计 ${course.activities.reduce((sum, item) => sum + item.duration, 0)} 分钟。`,
    activities: structuredClone(course.activities)
  };
}

export function downloadPackage(data: CoursePackage): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `课程包-${data.baseVersionLabel}-${data.sender}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

export function snapshotOf(activities: Activity[]): Activity[] {
  return structuredClone(activities);
}
