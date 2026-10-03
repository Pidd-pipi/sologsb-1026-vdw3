import test from 'node:test';
import assert from 'node:assert/strict';
import type { Activity, Course } from '../src/lib/types';
import { exportCoursePackage, parseCoursePackage, previewMerge, resolvePreview, mergeMeta } from '../src/lib/course-merge';
import { analyzeCourse } from '../src/lib/analysis';

// 贴近真实场景：老师把课程交给同事带走，两边各自补活动和依赖，回来后整份合并。
function act(id: string, patch: Partial<Activity> = {}): Activity {
  return {
    id, type: '音素', title: id, content: id, phonemes: [], dependencies: [],
    difficulty: 1, prompt: '提示', accessibility: '无障碍', duration: 5, feedback: '', ...patch
  };
}

test('端到端：交给同事 → 两边各自补活动/依赖/说明 → 带回三向合并 → 存档', () => {
  // 老师存档的来源版本（课程包 base）
  const base: Activity[] = [
    act('p1', { title: '认识 /m/', phonemes: ['/m/'] }),
    act('p0', { title: '认识 /æ/', phonemes: ['/æ/'] }),
    act('w1', { type: '单词', title: '拼读 mat', phonemes: ['/m/', '/æ/'], dependencies: ['p1', 'p0'] })
  ];
  const course: Course = {
    id: 'c1', title: '声音侦探', level: '一级', ageRange: '5-6', objective: '目标',
    revision: 5, updatedAt: '2026-10-01T00:00:00Z',
    activities: structuredClone(base),
    versions: [{
      id: 'v5', label: '第五版', savedAt: '2026-10-01T00:00:00Z', note: '',
      meta: { title: '声音侦探', level: '一级', ageRange: '5-6', objective: '目标' },
      activities: structuredClone(base)
    }]
  };

  // 1) 老师导出课程包交给同事
  const pkgText = JSON.stringify(exportCoursePackage(course, { exportedBy: '王老师', note: '带去备课会' }));

  // 2) 本地老师继续改：新增 p2、给 w1 补说明、加依赖
  course.activities.push(act('p2', { title: '认识 /s/', phonemes: ['/s/'] }));
  const localW1 = course.activities.find((a) => a.id === 'w1')!;
  localW1.prompt = '本地：先指字母再连读';
  localW1.dependencies = ['p1', 'p2'];

  // 3) 同事在包基础上改：新增练习 x1、同一 w1 改了提示（冲突）、给 w1 加对 x1 的依赖
  const pkg = parseCoursePackage(pkgText);
  pkg.activities.push(act('x1', { type: '练习', title: '辨音练习', phonemes: ['/m/', '/s/'], feedback: '答错再听一遍' }));
  const remoteW1 = pkg.activities.find((a) => a.id === 'w1')!;
  remoteW1.prompt = '同事：边拍手边读';
  remoteW1.dependencies = ['p1', 'x1'];

  // 4) 回来做合并预演
  const preview = previewMerge(course, pkg);

  // 单边新增都在
  assert.ok(preview.addedLocal.includes('p2'), '本地新增 p2 直接并入');
  assert.ok(preview.addedIncoming.includes('x1'), '同事新增 x1 直接并入');

  // w1 的提示两边都改 → 一个冲突；选定前不能应用
  assert.equal(preview.conflicts.length, 1);
  assert.equal(preview.conflicts[0].activityId, 'w1');
  assert.equal(resolvePreview(preview).find((a) => a.id === 'w1')?.prompt, '本地：先指字母再连读', '未选定保持本地占位');

  // 依赖并集：p2 与 x1 都不能丢
  preview.conflicts[0].resolution = 'local';
  const merged = resolvePreview(preview);
  const w1 = merged.find((a) => a.id === 'w1')!;
  assert.deepEqual([...w1.dependencies].sort(), ['p0', 'p1', 'p2', 'x1'], '依赖取 base/本地/同事并集，任一版都不丢');
  assert.equal(w1.prompt, '本地：先指字母再连读', '字段按选定版本');

  // 两个新增活动都保留
  const ids = merged.map((a) => a.id);
  assert.ok(ids.includes('p2') && ids.includes('x1'));

  // 5) 课程信息单边修改采用
  pkg.meta.objective = '同事更新的学习目标';
  const meta = mergeMeta(course, pkg);
  assert.equal(meta.objective, '同事更新的学习目标');

  // 6) 合并后课程仍可被质量检查分析（新音素 /s/ 先教后用：x1 依赖 p1 但含 /s/，p2 教 /s/ 顺序需检查）
  const finalCourse: Course = { ...course, ...meta, activities: merged };
  const issues = analyzeCourse(finalCourse);
  // 应能正常产出检查结果而不抛错；x1 含 /s/ 且排在 p2 之后或之前取决于合并顺序，检查可给出提示
  assert.ok(Array.isArray(issues));
  assert.equal(issues.some((i) => i.id.startsWith('early-')), ids.indexOf('x1') < ids.indexOf('p2'));
});
