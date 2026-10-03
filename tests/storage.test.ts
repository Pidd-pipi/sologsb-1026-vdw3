import test from 'node:test';
import assert from 'node:assert/strict';

// 最小 localStorage 内存垫片
class MemoryStorage {
  private map = new Map<string, string>();
  get length() { return this.map.size; }
  getItem(key: string) { return this.map.has(key) ? this.map.get(key)! : null; }
  setItem(key: string, value: string) { this.map.set(key, String(value)); }
  removeItem(key: string) { this.map.delete(key); }
  key(index: number) { return [...this.map.keys()][index] ?? null; }
  clear() { this.map.clear(); }
}
(globalThis as unknown as { localStorage: Storage }).localStorage = new MemoryStorage() as unknown as Storage;

const {
  commitCourse,
  loadStoredCourse,
  enqueuePendingMerge,
  loadPendingMerges,
  listRejectedDrafts
} = await import('../src/lib/storage');
const { exportCoursePackage } = await import('../src/lib/course-merge');

function courseFixture(revision: number) {
  return {
    id: 'c1', title: '课', level: 'L1', ageRange: '5', objective: 'o',
    activities: [], versions: [], updatedAt: new Date().toISOString(), revision
  };
}

test('两个标签页基于同一旧版本提交：先提交成功，后提交保留草稿不覆盖', () => {
  const first = commitCourse(courseFixture(0), 0);
  assert.equal(first.ok, true);
  assert.equal(first.stored.revision, 1);

  // 第二个标签页仍基于 revision 0 提交
  const loser = commitCourse({ ...courseFixture(0), title: '后提交的改动' }, 0);
  assert.equal(loser.ok, false);
  assert.ok(loser.draftId);
  assert.match(loser.reason ?? '', /另一个标签页/);

  // 权威课程仍是先提交的内容，未被覆盖
  const stored = loadStoredCourse()!;
  assert.equal(stored.revision, 1);
  assert.equal(stored.title, '课');

  // 草稿列表可查（listRejectedDrafts 走 localStorage 扫描）
  const drafts = listRejectedDrafts();
  assert.equal(drafts.length, 1);
  assert.equal(drafts[0].course.title, '后提交的改动');
  assert.equal(drafts[0].baseRevision, 0);
});

test('顺序提交（版本号匹配）持续递增，不产生草稿', () => {
  const r1 = commitCourse(courseFixture(1), 1);
  assert.equal(r1.ok, true);
  assert.equal(r1.stored.revision, 2);
  const r2 = commitCourse(courseFixture(2), 2);
  assert.equal(r2.ok, true);
  assert.equal(r2.stored.revision, 3);
  assert.equal(listRejectedDrafts().length, 1); // 仍是上一用例的那一条
});

test('提交失败后待处理课程包仍保留并可继续处理', async () => {
  const before = loadPendingMerges().length;
  const pkg = exportCoursePackage(courseFixture(3) as never, { exportedBy: '同事', note: '带回' });
  enqueuePendingMerge(pkg, 3);
  const queue = loadPendingMerges();
  assert.equal(queue.length, before + 1);
  assert.equal(queue.at(-1)?.pkg.exportedBy, '同事');

  // 再做一次失败提交，队列不受影响
  const failed = commitCourse(courseFixture(2), 2);
  assert.equal(failed.ok, false);
  assert.equal(loadPendingMerges().length, before + 1);
  assert.ok(listRejectedDrafts().length >= 1, '原课程草稿与待处理项都仍可继续处理');
});
