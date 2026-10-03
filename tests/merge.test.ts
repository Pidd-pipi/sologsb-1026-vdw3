import test from 'node:test';
import assert from 'node:assert/strict';
import type { Activity, Course } from '../src/lib/types';
import { exportCoursePackage, previewMerge, resolvePreview, unresolvedConflicts, parseCoursePackage, type CoursePackage } from '../src/lib/course-merge';
import { analyzeCourse, downstreamOf, planRecompute } from '../src/lib/analysis';

function activity(partial: Partial<Activity> & { id: string }): Activity {
  return {
    type: '练习', title: partial.id, content: '', phonemes: [], dependencies: [],
    difficulty: 1, prompt: 'p', accessibility: 'a', duration: 5, feedback: 'f', ...partial
  };
}

function courseWith(activities: Activity[], versionActivities?: Activity[]): Course {
  return {
    id: 'c1', title: '课', level: 'L1', ageRange: '5', objective: 'o',
    activities, revision: 3, updatedAt: '2026-10-01T00:00:00Z',
    versions: versionActivities ? [{
      id: 'v-base', label: 'base', savedAt: '2026-09-01T00:00:00Z', note: '',
      meta: { title: '课', level: 'L1', ageRange: '5', objective: 'o' },
      activities: versionActivities
    }] : []
  };
}

const baseActivities: Activity[] = [
  activity({ id: 'a1', type: '音素', title: '音一', phonemes: ['/m/'], prompt: 'base prompt', accessibility: 'base a11y' }),
  activity({ id: 'a2', type: '单词', title: '词二', phonemes: ['/m/'], dependencies: ['a1'] })
];

function makePackage(activities: Activity[], meta = { title: '课', level: 'L1', ageRange: '5', objective: 'o' }): CoursePackage {
  return {
    format: 'phonics-course-package', packageVersion: 1, courseId: 'c1', courseTitle: '课',
    baseVersionId: 'v-base', baseSavedAt: '2026-09-01T00:00:00Z', exportedAt: '2026-10-02T00:00:00Z',
    exportedBy: '同事', note: '', baseActivities: structuredClone(baseActivities), baseMeta: { ...meta },
    activities, meta: { ...meta }, revision: 3
  };
}

test('单边新增活动直接并入', () => {
  const local = structuredClone(baseActivities);
  const incoming = [...structuredClone(baseActivities), activity({ id: 'a3', title: '同事新增' })];
  const course = courseWith(local, baseActivities);
  const preview = previewMerge(course, makePackage(incoming));
  assert.equal(preview.conflicts.length, 0);
  assert.deepEqual(preview.addedIncoming, ['a3']);
  const merged = resolvePreview(preview);
  assert.ok(merged.some((a) => a.id === 'a3'));
  assert.equal(merged.length, 3);
});

test('顺序变化直接并入（共同活动重排）', () => {
  const local = [structuredClone(baseActivities[0]), structuredClone(baseActivities[1])];
  // 同事把 a2 移到 a1 前面
  const incoming = [structuredClone(baseActivities[1]), structuredClone(baseActivities[0])];
  const preview = previewMerge(courseWith(local, baseActivities), makePackage(incoming));
  assert.equal(preview.status, 'auto');
  assert.ok(preview.reordered.includes('a2') || preview.merged[0].id === 'a2', '外来顺序调整应反映在合并结果中');
  assert.equal(resolvePreview(preview)[0].id, 'a2');
});

test('说明字段单边变化直接并入', () => {
  const local = structuredClone(baseActivities);
  const incoming = structuredClone(baseActivities);
  incoming[0].prompt = '同事改过的提示语';
  incoming[0].accessibility = '同事改过的无障碍说明';
  const preview = previewMerge(courseWith(local, baseActivities), makePackage(incoming));
  assert.equal(preview.conflicts.length, 0);
  assert.ok(preview.notesChanged.includes('a1'));
  const merged = resolvePreview(preview);
  assert.equal(merged.find((a) => a.id === 'a1')?.prompt, '同事改过的提示语');
  assert.equal(merged.find((a) => a.id === 'a1')?.accessibility, '同事改过的无障碍说明');
});

test('同一活动两边都改同字段 → 并列冲突，未选定不写入当前课程', () => {
  const local = structuredClone(baseActivities);
  local[0].prompt = '本地的新提示';
  const incoming = structuredClone(baseActivities);
  incoming[0].prompt = '同事的新提示';
  const course = courseWith(local, baseActivities);
  const preview = previewMerge(course, makePackage(incoming));
  assert.equal(preview.conflicts.length, 1);
  assert.equal(preview.conflicts[0].resolution, null);
  assert.deepEqual(unresolvedConflicts(preview).map((c) => c.activityId), ['a1']);
  // 未选定前 resolvePreview 产生占位，但 UI 层应阻止写入；占位保持本地内容且不能丢外来内容
  const placeholder = resolvePreview(preview).find((a) => a.id === 'a1');
  assert.ok(placeholder);
  assert.equal(placeholder.prompt, '本地的新提示');
  assert.equal(preview.conflicts[0].incoming.prompt, '同事的新提示');
  // 选定外来版本
  preview.conflicts[0].resolution = 'incoming';
  assert.equal(resolvePreview(preview).find((a) => a.id === 'a1')?.prompt, '同事的新提示');
});

test('不能丢掉任一版依赖：两边各加依赖取并集', () => {
  const localBase = structuredClone(baseActivities);
  const local = [...localBase, activity({ id: 'l1', title: '本地新增' })];
  const a2local = local.find((a) => a.id === 'a2')!;
  a2local.dependencies = ['a1', 'l1']; // 本地新增依赖 l1

  const incomingBase = structuredClone(baseActivities);
  const incoming = [...incomingBase, activity({ id: 'r1', title: '同事新增' })];
  const a2incoming = incoming.find((a) => a.id === 'a2')!;
  a2incoming.dependencies = ['a1', 'r1']; // 同事新增依赖 r1

  const preview = previewMerge(courseWith(local, baseActivities), makePackage(incoming));
  const merged = resolvePreview(preview);
  const deps = merged.find((a) => a.id === 'a2')?.dependencies ?? [];
  assert.ok(deps.includes('l1'), '本地新增的依赖不能丢');
  assert.ok(deps.includes('r1'), '同事新增的依赖不能丢');
  assert.ok(deps.includes('a1'));
});

test('本地删除但同事修改 → 冲突并列，可选 drop 或采用带回', () => {
  const local = [structuredClone(baseActivities[0])]; // 本地删了 a2
  const incoming = structuredClone(baseActivities);
  incoming[1].prompt = '同事还在改 a2';
  const preview = previewMerge(courseWith(local, baseActivities), makePackage(incoming));
  assert.equal(preview.conflicts.length, 1);
  assert.equal(preview.conflicts[0].local, null);
  assert.equal(unresolvedConflicts(preview).length, 1);
  preview.conflicts[0].resolution = 'drop';
  assert.equal(resolvePreview(preview).some((a) => a.id === 'a2'), false);
});

test('活动变化后下游活动与音素检查失效重算，并给出原因', () => {
  const before = [
    activity({ id: 'p1', type: '音素', phonemes: ['/m/'] }),
    activity({ id: 'w1', type: '单词', phonemes: ['/m/'], dependencies: ['p1'] }),
    activity({ id: 'x1', type: '练习', phonemes: ['/m/'], dependencies: ['w1'] })
  ];
  const after = structuredClone(before);
  after[0].phonemes = ['/s/']; // 音素变化
  const plan = planRecompute(before, after);
  assert.ok(plan.staleIds?.includes('w1'), '用到该音素的活动应重算');
  assert.ok(plan.staleIds?.includes('x1'));
  assert.ok(plan.notices.some((n) => n.trigger === 'phoneme' && n.message.includes('提前使用')));

  // 依赖变化：下游传递失效
  const after2 = structuredClone(before);
  after2[1].dependencies = [];
  const plan2 = planRecompute(before, after2);
  assert.ok(plan2.staleIds?.includes('x1'));
  assert.ok(plan2.notices.some((n) => n.trigger === 'dependency'));

  // 删除上游：旧下游仍然失效
  const after3 = before.filter((a) => a.id !== 'p1');
  const plan3 = planRecompute(before, after3);
  assert.ok(plan3.notices.some((n) => n.activityId === 'w1' || n.activityId === 'x1'));
});

test('下游传递闭包正确', () => {
  const list = [
    activity({ id: 'a' }),
    activity({ id: 'b', dependencies: ['a'] }),
    activity({ id: 'c', dependencies: ['b'] }),
    activity({ id: 'd', dependencies: ['c', 'a'] })
  ];
  assert.deepEqual([...downstreamOf(list, ['a'])].sort(), ['b', 'c', 'd']);
});

test('版本变化 → 整门课程全部失效重算', () => {
  const plan = planRecompute(baseActivities, structuredClone(baseActivities), { trigger: 'version', message: '版本合并后重算' });
  assert.equal(plan.staleIds, null);
  assert.equal(plan.notices[0].trigger, 'version');
});

test('课程包含来源版本与活动快照，可序列化往返', () => {
  const course = courseWith(baseActivities, baseActivities);
  const pkg = exportCoursePackage(course, { exportedBy: '张老师', note: '带走改' });
  assert.equal(pkg.baseVersionId, 'v-base');
  assert.equal(pkg.baseActivities.length, 2);
  assert.equal(pkg.activities.length, 2);
  const parsed = parseCoursePackage(JSON.stringify(pkg));
  assert.equal(parsed.exportedBy, '张老师');
  assert.throws(() => parseCoursePackage(JSON.stringify({ hello: 'world' })), /有效/);
});

test('双边各自新增活动同时保留，顺序不丢任一侧', () => {
  const local = [...structuredClone(baseActivities), activity({ id: 'l-only', title: '本地新增' })];
  const incoming = [...structuredClone(baseActivities), activity({ id: 'r-only', title: '同事新增' })];
  const merged = resolvePreview(previewMerge(courseWith(local, baseActivities), makePackage(incoming)));
  const ids = merged.map((a) => a.id);
  assert.ok(ids.includes('l-only'), '本地新增保留');
  assert.ok(ids.includes('r-only'), '同事新增保留');
  assert.equal(new Set(ids).size, ids.length, '无重复活动');
});

test('本地保持不变、同事说明改动后，单边修改被采用且不产生冲突', () => {
  const local = structuredClone(baseActivities);
  const incoming = structuredClone(baseActivities);
  incoming[1].feedback = '同事补的练习反馈';
  incoming[1].type = '练习';
  const preview = previewMerge(courseWith(local, baseActivities), makePackage(incoming));
  assert.equal(preview.conflicts.length, 0);
  const a2 = resolvePreview(preview).find((a) => a.id === 'a2');
  assert.equal(a2?.feedback, '同事补的练习反馈');
  assert.equal(a2?.type, '练习');
});

test('音素提前使用检查在重算后反映最新顺序', () => {
  const bad = [
    activity({ id: 'w1', type: '单词', phonemes: ['/z/'] }), // 先用 /z/
    activity({ id: 'p1', type: '音素', phonemes: ['/z/'] })
  ];
  const issues = analyzeCourse({ activities: bad });
  assert.ok(issues.some((i) => i.category === '前置知识'));
  const fixed = [bad[1], bad[0]]; // 调整顺序
  assert.equal(analyzeCourse({ activities: fixed }).some((i) => i.category === '前置知识'), false);
});
