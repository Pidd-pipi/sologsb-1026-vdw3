// 合并逻辑与乐观并发的行为验证（node 脚本，经 esbuild 编译为 ESM 运行）。
import assert from 'node:assert';

// 运行时把 TS 源即时编译。
const { build } = await import('esbuild');
const result = await build({
  stdin: {
    contents: `
export { mergeCourses, buildFieldMergedActivity, applyResolvedMerge } from './src/lib/merge.ts';
export { describeInvalidation, downstreamActivities } from './src/lib/analysis.ts';
`,
    resolveDir: process.cwd(),
    sourcefile: 'entry-merge-test',
    loader: 'ts'
  },
  bundle: true,
  format: 'esm',
  platform: 'node',
  write: false,
  logLevel: 'silent'
});

const dataUrl = 'data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].text).toString('base64');
const { mergeCourses, buildFieldMergedActivity, applyResolvedMerge, describeInvalidation, downstreamActivities } = await import(dataUrl);

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log('  ✓', name);
}

function activity(partial) {
  return {
    id: partial.id,
    type: partial.type ?? '音素',
    title: partial.title ?? partial.id,
    content: partial.content ?? '',
    phonemes: partial.phonemes ?? [],
    dependencies: partial.dependencies ?? [],
    difficulty: partial.difficulty ?? 1,
    prompt: partial.prompt ?? '',
    accessibility: partial.accessibility ?? 'a11y',
    duration: partial.duration ?? 5,
    feedback: partial.feedback ?? ''
  };
}

// --- 场景：老师 v2 交给同事，两边各自修改 ---
const base = [
  activity({ id: 'a-1', title: '认识 /m/', phonemes: ['/m/'] }),
  activity({ id: 'a-2', title: '认识 /s/', phonemes: ['/s/'], dependencies: ['a-1'], type: '音素' }),
  activity({ id: 'a-3', title: '拼读 sat', type: '单词', phonemes: ['/s/', '/æ/', '/t/'], dependencies: ['a-2'] })
];

// 本地：新增 a-4；a-3 改了 prompt；a-2 没动
const local = [
  activity({ id: 'a-1', title: '认识 /m/', phonemes: ['/m/'] }),
  activity({ id: 'a-2', title: '认识 /s/', phonemes: ['/s/'], dependencies: ['a-1'], type: '音素' }),
  activity({ id: 'a-3', title: '拼读 sat', type: '单词', phonemes: ['/s/', '/æ/', '/t/'], dependencies: ['a-2'], prompt: '本地改的提示' }),
  activity({ id: 'a-4', title: '本地新练习', type: '练习', phonemes: ['/m/'], dependencies: ['a-1'], feedback: '本地反馈' })
];

// 同事：新增 a-5（插在 a-1 后面）；a-2 改了 duration（说明变化）；a-3 改了 content（两边都改→冲突）；删 a-1? 不删
const incoming = [
  activity({ id: 'a-1', title: '认识 /m/', phonemes: ['/m/'] }),
  activity({ id: 'a-5', title: '同事新音素 /p/', phonemes: ['/p/'], dependencies: ['a-1'] }),
  activity({ id: 'a-2', title: '认识 /s/', phonemes: ['/s/'], dependencies: ['a-1'], type: '音素', duration: 9 }),
  activity({ id: 'a-3', title: '拼读 sat', type: '单词', phonemes: ['/s/', '/æ/', '/t/'], dependencies: ['a-2'], content: 's-a-t 同事版内容' })
];

const merged = mergeCourses(base, local, incoming);

test('单边新增（本地 + 同事）都并入', () => {
  const ids = merged.activities.map((a) => a.id);
  assert.ok(ids.includes('a-4'), '本地新增保留');
  assert.ok(ids.includes('a-5'), '同事新增并入');
});

test('只有一边改的说明字段直接并入（a-2 取同事的 duration=9）', () => {
  const a2 = merged.activities.find((a) => a.id === 'a-2');
  assert.equal(a2.duration, 9);
});

test('两边都改的同一活动产生 1 个冲突，两版并列且未选定', () => {
  assert.equal(merged.conflicts.length, 1);
  const conflict = merged.conflicts[0];
  assert.equal(conflict.activityId, 'a-3');
  assert.equal(conflict.resolution, null);
  assert.equal(conflict.localActivity.prompt, '本地改的提示');
  assert.equal(conflict.incomingActivity.content, 's-a-t 同事版内容');
});

test('自动并入的变化被列出', () => {
  const kinds = merged.autoChanges.map((c) => c.kind);
  assert.ok(kinds.includes('added-incoming'));
  assert.ok(kinds.includes('added-local'));
  assert.ok(kinds.includes('description'));
});

test('同事新增活动按锚点插入（a-5 紧跟 a-1）', () => {
  const ids = merged.activities.map((a) => a.id);
  assert.ok(ids.indexOf('a-5') === ids.indexOf('a-1') + 1, `顺序：${ids.join(',')}`);
});

// --- 同一活动两边都改了依赖 → 冲突并列；选定后依赖并集仍保留两版依赖 ---
const base2 = [
  activity({ id: 'x-1' }),
  activity({ id: 'x-2', dependencies: ['x-1'] }),
  activity({ id: 'x-3', dependencies: ['x-2'] }),
  activity({ id: 'x-4', dependencies: ['x-2'] })
];
const local2 = [
  activity({ id: 'x-1' }),
  activity({ id: 'x-2', dependencies: ['x-1', 'x-4'] }), // 本地加 x-4
  activity({ id: 'x-3', dependencies: ['x-2'] })
  // 本地删除 x-4
];
const incoming2 = [
  activity({ id: 'x-1' }),
  activity({ id: 'x-2', dependencies: ['x-1', 'x-3'] }), // 同事加 x-3
  activity({ id: 'x-3', dependencies: ['x-2'] }),
  activity({ id: 'x-4', dependencies: ['x-2'] })
];
const merged2 = mergeCourses(base2, local2, incoming2);

test('同活动两边都改依赖产生冲突，两版并列且未选定', () => {
  const conflict = merged2.conflicts.find((c) => c.activityId === 'x-2');
  assert.ok(conflict, 'x-2 应为冲突');
  assert.equal(conflict.resolution, null);
  assert.deepEqual(conflict.localActivity.dependencies, ['x-1', 'x-4']);
  assert.deepEqual(conflict.incomingActivity.dependencies, ['x-1', 'x-3']);
});

test('选定任一版后，依赖仍是两边并集（不丢任一版依赖）', () => {
  const review = {
    baseActivities: base2,
    conflicts: structuredClone(merged2.conflicts)
  };
  review.conflicts.find((c) => c.activityId === 'x-2').resolution = 'local';
  const out = applyResolvedMerge(review, merged2);
  const x2 = out.activities.find((a) => a.id === 'x-2');
  assert.deepEqual([...x2.dependencies].sort(), ['x-1', 'x-3', 'x-4']);
});

test('单边删除（x-4 被本地删、同事没动）直接删除，悬空依赖保留并报告', () => {
  assert.ok(!merged2.activities.some((a) => a.id === 'x-4'), 'x-4 已删除');
  assert.ok(merged2.danglingDependencies.some((d) => d.activityId === 'x-2' && d.dependencyId === 'x-4'));
});

test('两边都删同一依赖才真正删除', () => {
  const b = [activity({ id: 'y-1' }), activity({ id: 'y-2', dependencies: ['y-1'] })];
  const l = [activity({ id: 'y-1' }), activity({ id: 'y-2', dependencies: [] })];
  const i = [activity({ id: 'y-1' }), activity({ id: 'y-2', dependencies: [] })];
  const m = mergeCourses(b, l, i);
  const y2 = m.activities.find((a) => a.id === 'y-2');
  assert.deepEqual(y2.dependencies, []);
});

// --- 一边删一边改 → 删除/修改冲突 ---
test('一边删除一边修改产生 delete-vs-modify 冲突，两版都保留', () => {
  const b = [activity({ id: 'd-1', prompt: '旧' })];
  const l = [];
  const i = [activity({ id: 'd-1', prompt: '同事新提示' })];
  const m = mergeCourses(b, l, i);
  assert.equal(m.conflicts.length, 1);
  assert.equal(m.conflicts[0].kind, 'delete-vs-modify');
  assert.equal(m.conflicts[0].localActivity, null);
  assert.equal(m.conflicts[0].incomingActivity.prompt, '同事新提示');
});

// --- 字段不重叠的一键拼合 ---
test('字段不重叠时可生成字段拼合版', () => {
  const conflict = merged.conflicts[0];
  assert.equal(conflict.fieldSuggestion, true);
  const fm = buildFieldMergedActivity(conflict, base);
  assert.equal(fm.prompt, '本地改的提示', '本地改的字段保留');
  assert.equal(fm.content, 's-a-t 同事版内容', '同事改的字段并入');
});

// --- 全部冲突选定后 applyResolvedMerge 才生成最终表 ---
test('未全部选定不能落库（调用方负责）；选定本地版后保留本地内容且依赖仍并集', () => {
  const review = {
    baseActivities: base,
    conflicts: structuredClone(merged.conflicts)
  };
  review.conflicts[0].resolution = 'local';
  const out = applyResolvedMerge(review, merged);
  const a3 = out.activities.find((a) => a.id === 'a-3');
  assert.equal(a3.prompt, '本地改的提示');
  assert.equal(a3.content, '', '选本地版则同事 content 不写入');
  const ids = out.activities.map((a) => a.id);
  assert.ok(ids.includes('a-4') && ids.includes('a-5'), '自动并入的活动仍在');
});

test('选择删除侧时活动从最终表移除', () => {
  const b = [activity({ id: 'd-1', prompt: '旧' })];
  const l = [];
  const i = [activity({ id: 'd-1', prompt: '同事新提示' })];
  const m = mergeCourses(b, l, i);
  const review = { baseActivities: b, conflicts: structuredClone(m.conflicts) };
  review.conflicts[0].resolution = 'local'; // 本地侧为删除
  const out = applyResolvedMerge(review, m);
  assert.ok(!out.activities.some((a) => a.id === 'd-1'));
});

// --- 失效重算：依赖变化影响下游 ---
test('依赖变化后下游活动（含传递下游）失效', () => {
  const acts = [
    activity({ id: 'p-1' }),
    activity({ id: 'p-2', dependencies: ['p-1'] }),
    activity({ id: 'p-3', dependencies: ['p-2'] }),
    activity({ id: 'p-4', dependencies: ['p-3'] })
  ];
  assert.deepEqual(downstreamActivities(acts, ['p-1']), ['p-2', 'p-3', 'p-4']);
  const d = describeInvalidation({ kind: 'activity', activityId: 'p-1', fields: ['dependencies'] }, acts);
  assert.ok(d.invalidatedChecks.includes('依赖循环与失效引用检查'));
  assert.ok(d.affectedActivityIds.includes('p-4'), '传递下游受影响');
});

test('音素变化使全局音素检查失效', () => {
  const acts = [activity({ id: 'q-1', phonemes: ['/m/'] }), activity({ id: 'q-2', phonemes: ['/s/'] })];
  const d = describeInvalidation({ kind: 'activity', activityId: 'q-1', fields: ['phonemes'] }, acts);
  assert.ok(d.invalidatedChecks.includes('音素提前使用检查'));
  assert.ok(d.invalidatedChecks.includes('相似音混淆检查'));
  assert.equal(d.affectedActivityIds.length, 2, '音素是全局顺序推导，全部活动重算');
});

test('顺序变化只失效音素类检查并给出原因', () => {
  const d = describeInvalidation({ kind: 'order' }, base);
  assert.deepEqual(d.invalidatedChecks, ['音素提前使用检查', '相似音混淆检查']);
  assert.ok(d.reason.includes('顺序'));
});

test('合并触发所有检查失效重算', () => {
  const d = describeInvalidation({ kind: 'merge' }, base);
  assert.equal(d.invalidatedChecks.length, 6);
});

// --- 纯顺序：同事重排、本地不动 ---
test('同事单边重排顺序被采用', () => {
  const b = [activity({ id: 'o-1' }), activity({ id: 'o-2' }), activity({ id: 'o-3' })];
  const l = [activity({ id: 'o-1' }), activity({ id: 'o-2' }), activity({ id: 'o-3' })];
  const i = [activity({ id: 'o-3' }), activity({ id: 'o-1' }), activity({ id: 'o-2' })];
  const m = mergeCourses(b, l, i);
  assert.deepEqual(m.activities.map((a) => a.id), ['o-3', 'o-1', 'o-2']);
  assert.ok(m.orderNote.includes('顺序'));
});

console.log(`\n全部 ${passed} 项合并/失效测试通过。`);
