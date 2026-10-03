// 乐观并发行为验证：两个标签页基于同一旧 revision 提交，后者失败且不覆盖先提交内容。
import assert from 'node:assert';
import { build } from 'esbuild';
import { writeFileSync } from 'node:fs';

// --- 内存 localStorage 垫片 ---
const memory = new Map();
globalThis.localStorage = {
  getItem: (key) => (memory.has(key) ? memory.get(key) : null),
  setItem: (key, value) => memory.set(key, String(value)),
  removeItem: (key) => memory.delete(key),
  clear: () => memory.clear()
};

const result = await build({
  stdin: { contents: `export * from './src/lib/storage.ts';`, resolveDir: process.cwd(), loader: 'ts' },
  bundle: true, format: 'esm', platform: 'node', write: false, logLevel: 'silent'
});
writeFileSync(new URL('../node_modules/.storage-debug.mjs', import.meta.url).pathname, result.outputFiles[0].text);
const storage = await import(new URL('../node_modules/.storage-debug.mjs', import.meta.url).href);

let passed = 0;
const test = (name, fn) => { fn(); passed += 1; console.log('  ✓', name); };

const baseCourse = (title) => ({
  id: 'c-1', title, level: 'L1', ageRange: '5-6', objective: '',
  activities: [], versions: [], updatedAt: '2026-09-01', revision: 1
});

test('首次引导写入 revision=1', () => {
  const course = storage.bootstrapCourse(baseCourse('种子'));
  assert.equal(course.revision, 1);
});

test('标签页 A 基于 r1 提交成功 → r2', () => {
  const draftA = baseCourse('A 的修改');
  const res = storage.commitCourse(draftA, 1);
  assert.equal(res.ok, true);
  assert.equal(res.course.revision, 2);
});

test('标签页 B 也基于 r1 提交 → 失败，remoteRevision=2，未覆盖', () => {
  const draftB = baseCourse('B 的修改');
  const res = storage.commitCourse(draftB, 1);
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'stale-revision');
  assert.equal(res.remoteRevision, 2);
  // 主存储仍是 A 的内容
  const stored = storage.readStoredCourse();
  assert.equal(stored.title, 'A 的修改');
});

test('B 重载到 r2 后再提交 → 成功 r3（草稿可接续）', () => {
  const latest = storage.readStoredCourse();
  const draftB = { ...baseCourse('B 在最新版上的修改'), id: latest.id };
  const res = storage.commitCourse(draftB, latest.revision);
  assert.equal(res.ok, true);
  assert.equal(res.course.revision, 3);
  assert.equal(storage.readStoredCourse().title, 'B 在最新版上的修改');
});

test('失败草稿与待处理项独立保存，失败后仍能继续处理', () => {
  storage.addPendingItem({ id: 'p-1', createdAt: '2026-10-03', review: { id: 'p-1' } });
  storage.addStashedDraft({
    id: 's-1', createdAt: '2026-10-03', reason: 'stale-revision',
    remoteRevision: 3, baseRevision: 1, course: baseCourse('B 草稿'), note: 'x'
  });
  assert.equal(storage.readPendingItems().length, 1);
  assert.equal(storage.readStashedDrafts().length, 1);
  // 主课程不受影响
  assert.equal(storage.readStoredCourse().revision, 3);
});

test('连续正常提交 revision 单调递增', () => {
  const r3 = storage.readStoredCourse();
  const r4 = storage.commitCourse({ ...r3, title: '四' }, 3);
  assert.equal(r4.course.revision, 4);
  const r5 = storage.commitCourse({ ...r4.course, title: '五' }, 4);
  assert.equal(r5.course.revision, 5);
  assert.equal(storage.readStoredCourse().title, '五');
});

writeFileSync; // 引用避免未使用告警
import('node:fs').then(({ rmSync }) => rmSync(new URL('../node_modules/.storage-debug.mjs', import.meta.url).pathname, { force: true }));

console.log(`\n全部 ${passed} 项乐观锁测试通过。`);
