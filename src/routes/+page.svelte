<script lang="ts">
  import { onMount } from 'svelte';
  import {
    Button,
    Checkbox,
    FileUploader,
    InlineNotification,
    Select,
    SelectItem,
    Tag,
    TextArea,
    TextInput,
    Tile
  } from 'carbon-components-svelte';
  import type { Activity, ActivityType, Course, CourseVersion, Diagnostic, VersionDiff } from '../lib/types';
  import { analyzeCourse, planRecompute, type RecomputeNotice } from '../lib/analysis';
  import {
    exportCoursePackage,
    mergeMeta,
    parseCoursePackage,
    previewMerge,
    resolvePreview,
    unresolvedConflicts,
    type ActivityConflict,
    type ConflictSide,
    type CoursePackage,
    type MergePreview
  } from '../lib/course-merge';
  import {
    STORAGE_KEY,
    commitCourse,
    discardRejectedDraft,
    enqueuePendingMerge,
    listRejectedDrafts,
    loadPendingMerges,
    loadStoredCourse,
    removePendingMerge,
    type PendingMerge,
    type RejectedDraft
  } from '../lib/storage';
  import ConflictDetail from '../lib/ConflictDetail.svelte';

  type ViewMode = 'compose' | 'path' | 'issues' | 'versions' | 'merge';
  type PreviewWidth = 'phone' | 'tablet' | 'desktop';

  const initialCourse = (): Course => ({
    id: 'course-phonics-1',
    title: 'Starter Phonics · 声音侦探',
    level: '启蒙一级',
    ageRange: '5–6 岁',
    objective: '建立音素意识，能听辨、拼读并书写短元音单词。',
    updatedAt: '2026-09-24T16:20:00+08:00',
    revision: 1,
    activities: [
      {
        id: 'a-1', type: '音素', title: '听音游戏：认识 /m/', content: '/m/',
        phonemes: ['/m/'], dependencies: [], difficulty: 1,
        prompt: '闭上嘴唇，轻轻发出 /m/，感受鼻子的震动。',
        accessibility: '提供口型示范图和可重复播放的低频音频。', duration: 6, feedback: ''
      },
      {
        id: 'a-2', type: '音素', title: '首音识别：/s/ 与 /m/', content: '/s/ /m/',
        phonemes: ['/s/', '/m/'], dependencies: ['a-1'], difficulty: 1,
        prompt: '听到单词时拍手，听到 /m/ 时把手放在鼻子上。',
        accessibility: '视觉提示使用不同形状，不只依赖颜色。', duration: 8, feedback: ''
      },
      {
        id: 'a-3', type: '单词', title: '拼读短词：sat', content: 's – a – t → sat',
        phonemes: ['/s/', '/æ/', '/t/'], dependencies: ['a-2'], difficulty: 2,
        prompt: '用手指依次点每个字母，再连起来读。',
        accessibility: '字母块支持键盘逐字聚焦和屏幕阅读器朗读。', duration: 10, feedback: '三条电缆拼在一起形成完整电路。'
      },
      {
        id: 'a-4', type: '练习', title: '听音选图：m / s 开头', content: 'moon, sun, mat, sock',
        phonemes: ['/m/', '/s/'], dependencies: ['a-2'], difficulty: 2,
        prompt: '先听单词，再从两张图片中选出正确首音。',
        accessibility: '所有图片均配替代文本，可只用键盘选择。', duration: 8, feedback: ''
      },
      {
        id: 'a-5', type: '音素', title: '短元音 /æ/ 的口型', content: '/æ/',
        phonemes: ['/æ/'], dependencies: ['a-1'], difficulty: 2,
        prompt: '嘴巴张大，舌尖放低，声音短而有力。',
        accessibility: '提供正面口型、侧面舌位和慢速音频。', duration: 6, feedback: ''
      },
      {
        id: 'a-6', type: '句子', title: '拼读句子：Mat sat.', content: 'Mat sat on the mat.',
        phonemes: ['/m/', '/æ/', '/s/', '/t/'], dependencies: ['a-3'], difficulty: 3,
        prompt: '先读每个单词，再按意群连读句子。',
        accessibility: '句子可按词高亮，并提供更大字号选项。', duration: 10, feedback: '读对了，再试试让声音更连贯。'
      },
      {
        id: 'a-7', type: '练习', title: '把单词和图片配对', content: 'mat · map · sun · sock',
        phonemes: ['/m/', '/æ/', '/s/'], dependencies: ['a-3', 'a-4'], difficulty: 3,
        prompt: '读出单词，然后把单词卡拖到对应图片。',
        accessibility: '支持键盘选择起点和终点，不使用拖拽也能完成。', duration: 12, feedback: '答对后播放该单词的分解音。'
      },
      {
        id: 'a-8', type: '句子', title: '迁移朗读：A man sat.', content: 'A man sat and had a nap.',
        phonemes: ['/m/', '/æ/', '/n/'], dependencies: ['a-6'], difficulty: 4,
        prompt: '观察 a 和 man 之间的联系，再完整朗读。',
        accessibility: '提供分句导航、朗读速度控制和高对比模式。', duration: 12, feedback: ''
      }
    ],
    versions: [
      {
        id: 'v-1', label: '初稿', savedAt: '2026-09-21T10:00:00+08:00', note: '完成音素和基础拼读活动。',
        meta: { title: 'Starter Phonics · 声音侦探', level: '启蒙一级', ageRange: '5–6 岁', objective: '建立音素意识。' },
        activities: []
      },
      {
        id: 'v-2', label: '增加句子迁移', savedAt: '2026-09-24T15:30:00+08:00', note: '补充 A man sat and had a nap.',
        meta: { title: 'Starter Phonics · 声音侦探', level: '启蒙一级', ageRange: '5–6 岁', objective: '建立音素意识，能听辨、拼读并书写短元音单词。' },
        activities: [
          {
            id: 'a-1', type: '音素', title: '听音游戏：认识 /m/', content: '/m/', phonemes: ['/m/'], dependencies: [], difficulty: 1,
            prompt: '闭上嘴唇，轻轻发出 /m/。', accessibility: '口型示范和重复音频。', duration: 6, feedback: ''
          },
          {
            id: 'a-2', type: '音素', title: '首音识别：/s/ 与 /m/', content: '/s/ /m/', phonemes: ['/s/', '/m/'], dependencies: ['a-1'], difficulty: 1,
            prompt: '听到单词时拍手。', accessibility: '不同形状的视觉提示。', duration: 8, feedback: ''
          },
          {
            id: 'a-3', type: '单词', title: '拼读短词：sat', content: 's – a – t → sat', phonemes: ['/s/', '/æ/', '/t/'], dependencies: ['a-2'], difficulty: 2,
            prompt: '用手指依次点每个字母。', accessibility: '键盘逐字聚焦。', duration: 10, feedback: '形成完整电路。'
          },
          {
            id: 'a-6', type: '句子', title: '拼读句子：Mat sat.', content: 'Mat sat on the mat.', phonemes: ['/m/', '/æ/', '/s/', '/t/'], dependencies: ['a-3'], difficulty: 3,
            prompt: '先读每个单词，再按意群连读。', accessibility: '按词高亮。', duration: 10, feedback: '再试试更连贯。'
          }
        ]
      }
    ]
  });

  let course: Course = initialCourse();
  let selectedActivityId = course.activities[0]?.id ?? '';
  let activeView: ViewMode = 'compose';
  let previewWidth: PreviewWidth = 'desktop';
  let compareBaseId = course.versions[0]?.id ?? '';
  let compareTargetId = course.versions.at(-1)?.id ?? '';
  let hydrated = false;
  let online = true;
  let savedLabel = '等待载入';
  let showOfflineNotice = false;
  let history: Course[] = [];
  let future: Course[] = [];
  let selectedActivity: Activity | null = null;
  let diagnostics: Diagnostic[] = [];
  let versionDiff: VersionDiff[] = [];

  // 失效重算
  let recomputeNotices: RecomputeNotice[] = [];
  let staleActivityIds: Set<string> = new Set();
  let wholeCourseStale = false;

  // 跨标签页并发
  let concurrentNotice = '';
  let rejectedDrafts: RejectedDraft[] = [];
  let reloadSuggested = false;

  // 合并处理
  let pendingMerges: PendingMerge[] = [];
  let mergePreview: MergePreview | null = null;
  let mergeMessage = '';
  let mergeError = '';
  let exportBy = '同事老师';
  let exportNote = '';
  let fileInputKey = 0;

  $: selectedActivity = course.activities.find((activity) => activity.id === selectedActivityId) ?? course.activities[0] ?? null;
  $: diagnostics = analyzeCourse(course);
  $: versionDiff = compareCourseVersions(course, compareBaseId, compareTargetId);
  $: errorCount = diagnostics.filter((issue) => issue.level === 'error').length;
  $: warningCount = diagnostics.filter((issue) => issue.level === 'warning').length;
  $: totalMinutes = course.activities.reduce((sum, activity) => sum + activity.duration, 0);
  $: unresolvedCount = mergePreview ? unresolvedConflicts(mergePreview).length : 0;

  onMount(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      try {
        course = migrateCourse(JSON.parse(stored) as Course);
        selectedActivityId = course.activities[0]?.id ?? '';
        compareBaseId = course.versions[0]?.id ?? '';
        compareTargetId = course.versions.at(-1)?.id ?? '';
        savedLabel = `已恢复 · 版本 ${course.revision} · ${formatTime(course.updatedAt)}`;
      } catch {
        localStorage.removeItem(STORAGE_KEY);
      }
    }
    pendingMerges = loadPendingMerges();
    rejectedDrafts = listRejectedDrafts();
    hydrated = true;
    const updateNetwork = () => {
      online = navigator.onLine;
      showOfflineNotice = !online;
    };
    updateNetwork();
    window.addEventListener('online', updateNetwork);
    window.addEventListener('offline', updateNetwork);
    // 其它标签页写入：发现更新版本时提示重载，不自动覆盖本页未提交内容。
    const onStorage = (event: StorageEvent) => {
      if (event.key !== STORAGE_KEY || !event.newValue) return;
      try {
        const latest = migrateCourse(JSON.parse(event.newValue) as Course);
        if (latest.revision > course.revision) {
          reloadSuggested = true;
          concurrentNotice = `另一个标签页已提交版本 ${latest.revision}（本页基于版本 ${course.revision}）。继续编辑不会覆盖它，保存时本页内容会保留为草稿；也可以立即重载。`;
        }
      } catch {
        // 忽略半写入的无效 JSON
      }
    };
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener('online', updateNetwork);
      window.removeEventListener('offline', updateNetwork);
      window.removeEventListener('storage', onStorage);
    };
  });

  function migrateCourse(value: Course): Course {
    if (!value.id || !Array.isArray(value.activities)) return initialCourse();
    value.versions ??= [];
    value.revision ??= 1;
    value.versions.forEach((version) => { version.meta ??= null; version.mergedFromPackage ??= null; });
    return value;
  }

  type VersionReason = { trigger: RecomputeNotice['trigger']; message: string };

  function recordRecompute(before: Course, next: Course, versionReason: VersionReason | undefined = undefined): void {
    const plan = planRecompute(before.activities, next.activities, versionReason);
    recomputeNotices = [...plan.notices, ...recomputeNotices].slice(0, 80);
    wholeCourseStale = plan.staleIds === null;
    staleActivityIds = new Set(plan.staleIds ?? []);
    // 检查结果由响应式语句立即重算，这里的标记用于说明“刚刚哪些结果失效过”。
    if (plan.staleIds === null) staleActivityIds = new Set(next.activities.map((activity) => activity.id));
  }

  function commit(recipe: (draft: Course) => void, versionReason: VersionReason | undefined = undefined): boolean {
    const before = structuredClone(course);
    const next = structuredClone(course);
    recipe(next);
    const unchanged = JSON.stringify(next) === JSON.stringify(before);
    if (!unchanged) history = [...history.slice(-49), before];
    next.updatedAt = new Date().toISOString();
    const result = commitCourse(next, course.revision);
    if (!result.ok) {
      // 后提交者：当前课程保持原样（先提交者内容未被覆盖），本页改动保留为草稿。
      if (!unchanged) history = history.slice(0, -1);
      rejectedDrafts = listRejectedDrafts();
      reloadSuggested = true;
      concurrentNotice = `${result.reason ?? '提交冲突'} 草稿已保留，可在“合并处理”中导出课程包后并回，或直接重载查看最新课程。`;
      savedLabel = `提交被保留为草稿 · 当前权威版本 ${result.stored.revision}`;
      return false;
    }
    // 内容无变化且仅手动保存时，不刷重算记录；真正改动才记录失效范围。
    if (!unchanged) recordRecompute(before, result.stored, versionReason);
    course = result.stored;
    future = [];
    savedLabel = `已保存 · 版本 ${result.stored.revision}`;
    return true;
  }

  function persist(): void {
    if (!hydrated) return;
    // Ctrl/Cmd+S 同样走 CAS，两个标签页同版本提交时后提交者保留草稿。
    commit(() => { /* 无额外改动，仅提交当前课程 */ });
  }

  function reloadFromStorage(): void {
    const stored = loadStoredCourse();
    if (!stored) return;
    course = migrateCourse(stored);
    selectedActivityId = course.activities[0]?.id ?? '';
    reloadSuggested = false;
    concurrentNotice = '';
    history = [];
    future = [];
    pendingMerges = loadPendingMerges();
    rejectedDrafts = listRejectedDrafts();
    savedLabel = `已重载 · 版本 ${course.revision}`;
  }

  function undo(): void {
    const previous = history.at(-1);
    if (!previous) return;
    const before = structuredClone(course);
    future = [before, ...future].slice(0, 50);
    history = history.slice(0, -1);
    const result = commitCourse(previous, course.revision);
    if (!result.ok) {
      rejectedDrafts = listRejectedDrafts();
      concurrentNotice = `${result.reason ?? '提交冲突'} 撤销未写入，请重载后再试。`;
      return;
    }
    recordRecompute(before, result.stored);
    course = result.stored;
    selectedActivityId = course.activities[0]?.id ?? '';
    savedLabel = `已撤销 · 版本 ${result.stored.revision}`;
  }

  function redo(): void {
    const nextSnapshot = future[0];
    if (!nextSnapshot) return;
    const before = structuredClone(course);
    history = [...history, before].slice(-50);
    future = future.slice(1);
    const result = commitCourse(nextSnapshot, course.revision);
    if (!result.ok) {
      rejectedDrafts = listRejectedDrafts();
      concurrentNotice = `${result.reason ?? '提交冲突'} 重做未写入，请重载后再试。`;
      return;
    }
    recordRecompute(before, result.stored);
    course = result.stored;
    selectedActivityId = course.activities[0]?.id ?? '';
    savedLabel = `已重做 · 版本 ${result.stored.revision}`;
  }

  function saveNow(): void {
    persist();
  }

  function updateCourse(field: 'title' | 'level' | 'ageRange' | 'objective', value: string): void {
    commit((draft) => { draft[field] = value; });
  }

  function updateActivity(field: keyof Activity, value: unknown): void {
    if (!selectedActivity) return;
    const id = selectedActivity.id;
    commit((draft) => {
      const target = draft.activities.find((activity) => activity.id === id);
      if (target) (target as unknown as Record<string, unknown>)[field] = value;
    });
  }

  function readText(event: Event): string {
    const custom = event as CustomEvent<{ value?: string; text?: string } | string>;
    if (typeof custom.detail === 'string') return custom.detail;
    if (typeof custom.detail === 'number') return String(custom.detail);
    if (custom.detail?.value) return custom.detail.value;
    if (custom.detail?.text) return custom.detail.text;
    const target = (event.currentTarget ?? event.target) as HTMLInputElement | HTMLTextAreaElement | null;
    return target?.value ?? '';
  }

  function readNumber(event: Event): number {
    return Number(readText(event));
  }

  function readChecked(event: Event): boolean {
    const custom = event as CustomEvent<{ checked?: boolean } | boolean>;
    if (typeof custom.detail === 'boolean') return custom.detail;
    if (typeof custom.detail?.checked === 'boolean') return custom.detail.checked;
    const target = (event.currentTarget ?? event.target) as HTMLInputElement | null;
    return Boolean(target?.checked);
  }

  function addActivity(type: ActivityType = '练习'): void {
    const id = `a-${Date.now()}`;
    commit((draft) => {
      draft.activities.push({
        id, type, title: `新的${type}活动`, content: '', phonemes: [], dependencies: [],
        difficulty: 1, prompt: '请输入教师提示语。', accessibility: '请描述视觉、听觉或键盘无障碍支持。',
        duration: type === '练习' ? 10 : 8, feedback: ''
      });
    });
    selectedActivityId = id;
    activeView = 'compose';
  }

  function deleteActivity(): void {
    if (!selectedActivity || course.activities.length <= 1) return;
    const id = selectedActivity.id;
    commit((draft) => {
      draft.activities = draft.activities.filter((activity) => activity.id !== id);
      draft.activities.forEach((activity) => {
        activity.dependencies = activity.dependencies.filter((dependency) => dependency !== id);
      });
    });
    selectedActivityId = course.activities[0]?.id ?? '';
  }

  function duplicateActivity(): void {
    if (!selectedActivity) return;
    const source = structuredClone(selectedActivity);
    source.id = `a-${Date.now()}`;
    source.title = `${source.title}（副本）`;
    source.dependencies = [...source.dependencies];
    commit((draft) => {
      const index = draft.activities.findIndex((activity) => activity.id === selectedActivity?.id);
      draft.activities.splice(index + 1, 0, source);
    });
    selectedActivityId = source.id;
  }

  function moveActivity(direction: -1 | 1): void {
    if (!selectedActivity) return;
    const id = selectedActivity.id;
    commit((draft) => {
      const index = draft.activities.findIndex((activity) => activity.id === id);
      const nextIndex = index + direction;
      if (nextIndex < 0 || nextIndex >= draft.activities.length) return;
      const [item] = draft.activities.splice(index, 1);
      draft.activities.splice(nextIndex, 0, item);
    });
  }

  function toggleDependency(dependencyId: string, checked: boolean): void {
    if (!selectedActivity || dependencyId === selectedActivity.id) return;
    const next = checked
      ? [...new Set([...selectedActivity.dependencies, dependencyId])]
      : selectedActivity.dependencies.filter((id) => id !== dependencyId);
    updateActivity('dependencies', next);
  }

  function updatePhonemes(value: string): void {
    updateActivity('phonemes', value.split(/[\s,，、]+/).map((item) => item.trim()).filter(Boolean));
  }

  function currentMeta(courseValue: Course) {
    return { title: courseValue.title, level: courseValue.level, ageRange: courseValue.ageRange, objective: courseValue.objective };
  }

  function saveVersion(): void {
    const versionNumber = course.versions.length + 1;
    commit((draft) => {
      draft.versions.push({
        id: `v-${Date.now()}`, label: `版本 ${versionNumber}`, savedAt: new Date().toISOString(),
        note: `保存 ${draft.activities.length} 个活动，总计 ${draft.activities.reduce((sum, item) => sum + item.duration, 0)} 分钟。`,
        meta: currentMeta(draft),
        activities: structuredClone(draft.activities)
      });
    });
    const latest = course.versions.at(-1);
    compareTargetId = latest?.id ?? '';
    if (!compareBaseId) compareBaseId = course.versions.at(-2)?.id ?? '';
    savedLabel = `版本 ${versionNumber} 已存档 · 版本 ${course.revision}`;
  }

  function copyCourse(): void {
    commit((draft) => {
      const copy = structuredClone(draft);
      copy.id = `course-${Date.now()}`;
      copy.title = `${copy.title} · 副本`;
      copy.versions = [];
      copy.revision = 1;
      copy.activities.forEach((activity) => {
        activity.title = activity.title.replace('（副本）', '') + '（复制）';
      });
      draft.id = copy.id;
      draft.title = copy.title;
      draft.versions = copy.versions;
      draft.activities = copy.activities;
      draft.revision = 1;
    });
    savedLabel = '课程已复制为新草稿';
  }

  function focusIssue(issue: Diagnostic): void {
    selectedActivityId = issue.activityId;
    activeView = 'compose';
  }

  function focusActivity(activityId: string | null): void {
    if (!activityId) return;
    selectedActivityId = activityId;
    activeView = 'compose';
  }

  // ---------- 课程包导入 / 合并 ----------

  function downloadJson(filename: string, data: unknown): void {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  }

  function handleExportPackage(): void {
    const pkg = exportCoursePackage(course, { exportedBy: exportBy || '未署名老师', note: exportNote });
    downloadJson(`课程包-${course.title}-${new Date().toISOString().slice(0, 10)}.json`, pkg);
    mergeMessage = `已导出课程包：来源版本「${course.versions.find((v) => v.id === pkg.baseVersionId)?.label ?? pkg.baseVersionId}」，含 ${pkg.activities.length} 个活动快照。`;
    activeView = 'merge';
  }

  function acceptPackageFile(event: CustomEvent<readonly File[]>): void {
    mergeError = '';
    const file = event.detail[0];
    fileInputKey += 1;
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const pkg = parseCoursePackage(String(reader.result));
        pendingMerges = enqueuePendingMerge(pkg, course.revision);
        openPending(pendingMerges[pendingMerges.length - 1]);
      } catch (error) {
        mergeError = error instanceof Error ? error.message : '课程包解析失败。';
      }
    };
    reader.readAsText(file);
  }

  function openPending(item: PendingMerge): void {
    try {
      mergePreview = previewMerge(course, item.pkg);
      mergeMessage = `已载入「${item.pkg.exportedBy}」的课程包（${formatTime(item.pkg.exportedAt)}），来源版本 ${item.pkg.baseVersionId || '无'}。`;
      mergeError = '';
    } catch (error) {
      mergeError = error instanceof Error ? error.message : '无法生成合并预演。';
      mergePreview = null;
    }
  }

  function chooseConflict(conflict: ActivityConflict, side: ConflictSide): void {
    if (!mergePreview) return;
    // 整体替换 preview，确保 Svelte 4 响应式刷新“确认并入”禁用态与各冲突卡片。
    mergePreview = {
      ...mergePreview,
      conflicts: mergePreview.conflicts.map((item) =>
        item.activityId === conflict.activityId ? { ...item, resolution: side } : item
      )
    };
  }

  function canApplyMerge(): boolean {
    return !!mergePreview && unresolvedConflicts(mergePreview).length === 0;
  }

  function applyMerge(item: PendingMerge | undefined): void {
    if (!mergePreview || !canApplyMerge()) {
      mergeError = '仍有同一活动两边都改动的冲突未选定；选定前不会写入当前课程。';
      return;
    }
    const preview = mergePreview;
    const pkg = preview.pkg;
    const ok = commit((draft) => {
      draft.activities = resolvePreview(preview);
      const mergedMeta = mergeMeta(draft, pkg);
      draft.title = mergedMeta.title;
      draft.level = mergedMeta.level;
      draft.ageRange = mergedMeta.ageRange;
      draft.objective = mergedMeta.objective;
      draft.versions.push({
        id: `v-${Date.now()}`,
        label: `合并自 ${pkg.exportedBy}`,
        savedAt: new Date().toISOString(),
        note: pkg.note || `并入「${pkg.exportedBy}」带回的修改（来源版本 ${pkg.baseVersionId || '无'}）。`,
        meta: currentMeta(draft),
        mergedFromPackage: `${pkg.exportedBy}@${pkg.exportedAt}`,
        activities: structuredClone(draft.activities)
      });
    }, { trigger: 'version', message: `并入课程包「${pkg.exportedBy}」后，活动、依赖与版本均已变化，整门课程的下游依赖与音素检查立即失效重算。` });

    if (!ok) {
      // 提交失败：原课程和待处理项都保留，可在重载后继续处理本次合并。
      mergeError = '合并提交遇到并发冲突，已保留为草稿且未覆盖先提交内容；请重载后在待处理队列中继续本次合并。';
      pendingMerges = loadPendingMerges();
      return;
    }
    // 成功提交后才把待处理项移出队列。
    pendingMerges = loadPendingMerges().filter((pending) => pending.id !== item?.id && !(pending.pkg.exportedAt === pkg.exportedAt && pending.pkg.exportedBy === pkg.exportedBy));
    localStorage.setItem('sologsb-1026-pending-merges-v1', JSON.stringify(pendingMerges));
    mergePreview = null;
    mergeError = '';
    mergeMessage = `合并完成并已存档为新版本：单边新增/顺序/说明已直接并入，冲突按选定结果保留，依赖取两边并集；下游活动与音素检查已立即重算。`;
    compareTargetId = course.versions.at(-1)?.id ?? compareTargetId;
  }

  function dropPending(item: PendingMerge): void {
    pendingMerges = removePendingMerge(item.id);
    if (mergePreview?.pkg.exportedAt === item.pkg.exportedAt) mergePreview = null;
  }

  function exportDraftAsPackage(draft: RejectedDraft): void {
    const pkg = exportCoursePackage(draft.course, { exportedBy: '本标签页草稿', note: `并发冲突后保留的草稿（基于版本 ${draft.baseRevision}）` });
    downloadJson(`草稿课程包-${draft.savedAt.slice(0, 10)}.json`, pkg);
    mergeMessage = '草稿已导出为课程包，重新导入即可走三向合并并回当前课程，不会覆盖任何人的修改。';
  }

  function discardDraft(draft: RejectedDraft): void {
    discardRejectedDraft(draft.id);
    rejectedDrafts = listRejectedDrafts();
  }

  function previewTitle(conflict: ActivityConflict): string {
    return conflict.local?.title ?? conflict.incoming?.title ?? conflict.activityId;
  }

  function compareCourseVersions(current: Course, baseId: string, targetId: string): VersionDiff[] {
    const base = current.versions.find((version) => version.id === baseId);
    const target = current.versions.find((version) => version.id === targetId);
    if (!base || !target) return [];
    const rows: VersionDiff[] = [];
    const baseMap = new Map(base.activities.map((activity) => [activity.id, activity]));
    const targetMap = new Map(target.activities.map((activity) => [activity.id, activity]));
    for (const activity of base.activities) {
      if (!targetMap.has(activity.id)) rows.push({ id: activity.id, title: activity.title, kind: 'removed', detail: '目标版本已删除该活动' });
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

  function formatTime(value: string): string {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(date);
  }

  function handleKeyboard(event: KeyboardEvent): void {
    const modifier = event.ctrlKey || event.metaKey;
    const tag = (event.target as HTMLElement)?.tagName;
    const editing = tag === 'INPUT' || tag === 'TEXTAREA' || (event.target as HTMLElement)?.isContentEditable;
    if (modifier && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      event.shiftKey ? redo() : undo();
      return;
    }
    if (modifier && event.key.toLowerCase() === 'y') {
      event.preventDefault();
      redo();
      return;
    }
    if (modifier && event.key.toLowerCase() === 's') {
      event.preventDefault();
      saveNow();
      return;
    }
    if (event.altKey && event.key.toLowerCase() === 'n') {
      event.preventDefault();
      addActivity('练习');
      return;
    }
    if (!editing && event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
      event.preventDefault();
      moveActivity(event.key === 'ArrowUp' ? -1 : 1);
    }
  }
</script>

<svelte:window on:keydown={handleKeyboard} />

<div class="app-frame">
  <header class="app-header">
    <div class="brand">
      <div class="brand-symbol" aria-hidden="true"><span>a</span><i>+</i><span>m</span></div>
      <div>
        <h1>Phonics Studio</h1>
        <p>儿童自然拼读课程编排台</p>
      </div>
    </div>
    <div class="header-center">
      <span class:connected={online} class="network-dot"></span>
      <span>{online ? '本地离线编辑可用' : '当前离线，修改仍会保存'}</span>
      <strong>{savedLabel}</strong>
    </div>
    <div class="header-actions">
      <Button size="small" kind="ghost" disabled={history.length === 0} on:click={undo}>撤销</Button>
      <Button size="small" kind="ghost" disabled={future.length === 0} on:click={redo}>重做</Button>
      <Button size="small" kind="tertiary" on:click={saveNow}>保存</Button>
      <Button size="small" kind="primary" on:click={saveVersion}>存档版本</Button>
    </div>
  </header>

  {#if showOfflineNotice}
    <div class="offline-notice">
      <InlineNotification lowContrast kind="info" title="已切换到离线模式" subtitle="所有修改会先保存在本机浏览器，恢复网络后仍可继续编辑。" />
    </div>
  {/if}

  {#if concurrentNotice}
    <div class="conflict-banner">
      <InlineNotification
        lowContrast
        kind="warning"
        title="检测到另一个标签页已先提交"
        subtitle={concurrentNotice}
      />
      <Button size="small" kind="primary" on:click={reloadFromStorage}>立即重载最新课程</Button>
      <Button size="small" kind="ghost" on:click={() => { concurrentNotice = ''; reloadSuggested = false; }}>稍后处理</Button>
    </div>
  {/if}

  {#if mergeError}
    <div class="conflict-banner error">
      <InlineNotification lowContrast kind="error" title="合并未能完成" subtitle={mergeError} />
      <Button size="small" kind="ghost" on:click={() => mergeError = ''}>知道了</Button>
    </div>
  {/if}

  <section class="course-hero">
    <div class="hero-copy">
      <span class="kicker">COURSE BUILDER / {course.level} · 修订版本 {course.revision}</span>
      <h2>{course.title}</h2>
      <p>{course.objective}</p>
    </div>
    <div class="hero-stats">
      <div><strong>{course.activities.length}</strong><span>活动</span></div>
      <div><strong>{totalMinutes}</strong><span>分钟</span></div>
      <div><strong class="critical">{errorCount}</strong><span>必修问题</span></div>
      <div><strong class="caution">{warningCount}</strong><span>建议调整</span></div>
    </div>
  </section>

  <nav class="workspace-tabs five" aria-label="工作区">
    <button class:active={activeView === 'compose'} on:click={() => activeView = 'compose'}><span>01</span><b>课程编排</b><small>活动、依赖与教学说明</small></button>
    <button class:active={activeView === 'path'} on:click={() => activeView = 'path'}><span>02</span><b>学习路径</b><small>多屏幕顺序预览</small></button>
    <button class:active={activeView === 'issues'} on:click={() => activeView = 'issues'}><span>03</span><b>质量检查</b><small>音素、句子与失效重算</small></button>
    <button class:active={activeView === 'versions'} on:click={() => activeView = 'versions'}><span>04</span><b>版本与复用</b><small>复制、存档与比较</small></button>
    <button class:active={activeView === 'merge'} on:click={() => activeView = 'merge'}><span>05</span><b>合并处理{pendingMerges.length ? `（${pendingMerges.length}）` : ''}</b><small>课程包导入与三向合并</small></button>
  </nav>

  {#if activeView === 'compose'}
    <main class="compose-layout">
      <aside class="activity-sidebar">
        <div class="sidebar-heading">
          <div><span class="kicker">LESSON MAP</span><h3>学习活动</h3></div>
          <Button size="small" kind="ghost" on:click={() => addActivity('练习')}>添加</Button>
        </div>
        <div class="type-legend">
          {#each ['音素', '单词', '句子', '练习'] as type}
            <span><i class:practice={type === '练习'} class:phoneme={type === '音素'}></i>{type}</span>
          {/each}
        </div>
        <div class="activity-list">
          {#each course.activities as activity, index (activity.id)}
            <button class:selected={activity.id === selectedActivityId} class:stale={wholeCourseStale || staleActivityIds.has(activity.id)} class="activity-row" on:click={() => selectedActivityId = activity.id}>
              <span class="sequence">{String(index + 1).padStart(2, '0')}</span>
              <span class="activity-type {activity.type}">{activity.type}</span>
              <span class="activity-copy"><b>{activity.title}</b><small>{activity.duration} 分钟 · 难度 {activity.difficulty}/5</small></span>
              {#if wholeCourseStale || staleActivityIds.has(activity.id)}<i class="stale-mark" title="该活动的下游或音素检查刚失效并重算">⟳</i>{:else if activity.dependencies.length}<i title="有前置依赖">↳</i>{/if}
            </button>
          {/each}
        </div>
        <div class="sidebar-help">快捷键：Alt + N 新建 · Alt + ↑/↓ 调整顺序 · ⟳ 表示检查刚重算</div>
      </aside>

      <section class="editor-column">
        {#if selectedActivity}
          <div class="editor-toolbar">
            <div>
              <span class="kicker">ACTIVITY EDITOR</span>
              <h3>{selectedActivity.type}活动{#if wholeCourseStale || staleActivityIds.has(selectedActivity.id)}<Tag type="magenta" style="margin-left:10px">检查已重算</Tag>{/if}</h3>
            </div>
            <div>
              <Button size="small" kind="ghost" disabled={course.activities[0]?.id === selectedActivity.id} on:click={() => moveActivity(-1)}>上移</Button>
              <Button size="small" kind="ghost" disabled={course.activities.at(-1)?.id === selectedActivity.id} on:click={() => moveActivity(1)}>下移</Button>
              <Button size="small" kind="ghost" on:click={duplicateActivity}>复制</Button>
              <Button size="small" kind="danger-ghost" on:click={deleteActivity}>删除</Button>
            </div>
          </div>

          <Tile class="editor-card">
            <div class="form-grid">
              <TextInput labelText="活动标题" value={selectedActivity.title} on:input={(event) => updateActivity('title', readText(event))} />
              <Select labelText="活动类型" selected={selectedActivity.type} on:change={(event) => updateActivity('type', readText(event))}>
                <SelectItem value="音素" text="音素" />
                <SelectItem value="单词" text="单词" />
                <SelectItem value="句子" text="句子" />
                <SelectItem value="练习" text="练习活动" />
              </Select>
              <TextInput labelText="预计时长（分钟）" type="number" min="1" max="60" value={String(selectedActivity.duration)} on:input={(event) => updateActivity('duration', readNumber(event))} />
              <div class="difficulty-field">
                <label for="difficulty">难度：{selectedActivity.difficulty}/5</label>
                <input id="difficulty" type="range" min="1" max="5" value={selectedActivity.difficulty} on:input={(event) => updateActivity('difficulty', readNumber(event))} />
              </div>
            </div>
            <TextArea labelText={selectedActivity.type === '音素' ? '音素内容' : selectedActivity.type === '句子' ? '目标句子' : '教学内容'} rows={3} value={selectedActivity.content} on:input={(event) => updateActivity('content', readText(event))} />
            <TextInput labelText="涉及音素（用逗号或空格分隔）" value={selectedActivity.phonemes.join(', ')} on:input={(event) => updatePhonemes(readText(event))} />
            <TextArea labelText="教师提示语" rows={2} value={selectedActivity.prompt} on:input={(event) => updateActivity('prompt', readText(event))} />
            <TextArea labelText="无障碍说明" rows={2} value={selectedActivity.accessibility} on:input={(event) => updateActivity('accessibility', readText(event))} />
            <TextArea labelText={selectedActivity.type === '练习' ? '练习反馈（必填）' : '学习反馈'} rows={2} value={selectedActivity.feedback} on:input={(event) => updateActivity('feedback', readText(event))} />
          </Tile>

          <Tile class="dependency-card">
            <div class="section-title">
              <div><span class="kicker">PREREQUISITES</span><h3>前置活动与依赖关系</h3><p>勾选的前置会与课程包另一侧新增的依赖取并集，合并且不会丢失任一版依赖。</p></div>
              <Tag type="cool-gray">{selectedActivity.dependencies.length} 个依赖</Tag>
            </div>
            <div class="dependency-grid">
              {#each course.activities.filter((activity) => activity.id !== selectedActivity?.id) as activity (activity.id)}
                <Checkbox
                  labelText={`${activity.title} · ${activity.type}`}
                  checked={selectedActivity.dependencies.includes(activity.id)}
                  on:change={(event) => toggleDependency(activity.id, readChecked(event))}
                />
              {/each}
            </div>
          </Tile>
        {/if}
      </section>

      <aside class="inspector">
        <Tile class="compact-card">
          <span class="kicker">COURSE META</span><h3>课程信息</h3>
          <TextInput labelText="课程名称" value={course.title} on:input={(event) => updateCourse('title', readText(event))} />
          <TextInput labelText="课程等级" value={course.level} on:input={(event) => updateCourse('level', readText(event))} />
          <TextInput labelText="适用年龄" value={course.ageRange} on:input={(event) => updateCourse('ageRange', readText(event))} />
          <TextArea labelText="学习目标" rows={3} value={course.objective} on:input={(event) => updateCourse('objective', readText(event))} />
        </Tile>
        <Tile class="compact-card issue-peek">
          <div class="section-title"><div><span class="kicker">LIVE CHECK</span><h3>实时提示</h3></div><Tag type={errorCount ? 'red' : 'green'}>{errorCount ? `${errorCount} 项` : '通过'}</Tag></div>
          {#each diagnostics.slice(0, 4) as issue}
            <button on:click={() => focusIssue(issue)} class="peek-row">
              <i class:error={issue.level === 'error'} class:warning={issue.level === 'warning'}></i>
              <span><b>{issue.title}</b><small>{issue.category}</small></span>
            </button>
          {/each}
          {#if diagnostics.length === 0}<p class="empty-state">课程结构完整，没有发现提示。</p>{/if}
          <Button size="small" kind="ghost" on:click={() => activeView = 'issues'}>查看全部检查</Button>
        </Tile>
      </aside>
    </main>
  {/if}

  {#if activeView === 'path'}
    <main class="path-view">
      <div class="path-toolbar">
        <div><span class="kicker">RESPONSIVE SEQUENCE</span><h2>学习顺序预览</h2><p>按活动依赖和课程顺序生成，可切换设备宽度检查信息密度。</p></div>
        <div class="width-switcher">
          <button class:active={previewWidth === 'phone'} on:click={() => previewWidth = 'phone'}>手机</button>
          <button class:active={previewWidth === 'tablet'} on:click={() => previewWidth = 'tablet'}>平板</button>
          <button class:active={previewWidth === 'desktop'} on:click={() => previewWidth = 'desktop'}>桌面</button>
        </div>
      </div>
      <div class="preview-stage">
        <div class="device-preview {previewWidth}">
          <div class="device-bar"><span></span><b>{previewWidth === 'phone' ? '390 px' : previewWidth === 'tablet' ? '768 px' : '1200 px'}</b></div>
          <div class="lesson-preview">
            <header><span>今日学习</span><h3>{course.title}</h3><p>{course.objective}</p></header>
            {#each course.activities as activity, index (activity.id)}
              <article>
                <div class="lesson-number">{index + 1}</div>
                <div class="lesson-type {activity.type}">{activity.type}</div>
                <div class="lesson-content">
                  <h4>{activity.title}</h4>
                  <p>{activity.content}</p>
                  {#if activity.prompt}<blockquote>{activity.prompt}</blockquote>{/if}
                  <div class="lesson-tags">
                    {#each activity.phonemes as phoneme}<span>{phoneme}</span>{/each}
                    <em>{activity.duration} 分钟</em>
                  </div>
                  {#if activity.dependencies.length}<small>前置：{activity.dependencies.map((id) => course.activities.find((item) => item.id === id)?.title).filter(Boolean).join('、')}</small>{/if}
                </div>
              </article>
            {/each}
            <footer>课程结束 · 预计 {totalMinutes} 分钟</footer>
          </div>
        </div>
      </div>
    </main>
  {/if}

  {#if activeView === 'issues'}
    <main class="issues-view">
      <div class="view-heading">
        <div><span class="kicker">CURRICULUM QA</span><h2>课程质量检查</h2><p>检查前置知识、相似音、例句长度、练习反馈、无障碍说明和依赖完整性；变化后相关结果立即失效重算。</p></div>
        <div class="issue-summary"><span><b>{errorCount}</b> 必须处理</span><span><b>{warningCount}</b> 建议调整</span><span><b>{diagnostics.length}</b> 全部提示</span></div>
      </div>

      <Tile class="recompute-card">
        <div class="section-title">
          <div><span class="kicker">INVALIDATION LOG</span><h3>失效与重算记录</h3><p>活动、依赖或版本一旦变化，相关下游活动和音素检查立即失效并重算，下列为原因。</p></div>
          <div class="recompute-actions">
            {#if wholeCourseStale}<Tag type="red">整门课程刚重算</Tag>{:else if staleActivityIds.size}<Tag type="magenta">{staleActivityIds.size} 个活动刚重算</Tag>{/if}
            {#if recomputeNotices.length}<Button size="small" kind="ghost" on:click={() => { recomputeNotices = []; staleActivityIds = new Set(); wholeCourseStale = false; }}>清空记录</Button>{/if}
          </div>
        </div>
        {#if recomputeNotices.length}
          <div class="recompute-list">
            {#each recomputeNotices.slice(0, 12) as notice (notice.id)}
              <button class="recompute-row" on:click={() => focusActivity(notice.activityId)}>
                <span class="recompute-badge {notice.trigger}">{notice.trigger === 'dependency' ? '依赖' : notice.trigger === 'phoneme' ? '音素' : notice.trigger === 'order' ? '顺序' : '版本'}</span>
                <span><b>{notice.activityId ? course.activities.find((a) => a.id === notice.activityId)?.title ?? '全部活动' : '全部活动'}</b><small>{notice.message}</small></span>
              </button>
            {/each}
          </div>
        {:else}
          <p class="empty-state">还没有变化。修改活动、依赖、音素、顺序或并入版本后，这里会列出失效范围与原因。</p>
        {/if}
      </Tile>

      <div class="issue-board">
        {#each diagnostics as issue, index}
          <article class:critical={issue.level === 'error'} class:caution={issue.level === 'warning'} class:info={issue.level === 'info'}
            class:fresh-invalid={staleActivityIds.has(issue.activityId) || wholeCourseStale}>
            <span class="issue-index">{String(index + 1).padStart(2, '0')}</span>
            <div><div class="issue-meta"><Tag type={issue.level === 'error' ? 'red' : issue.level === 'warning' ? 'magenta' : 'blue'}>{issue.category}</Tag><small>{issue.level === 'error' ? '必须处理' : issue.level === 'warning' ? '建议调整' : '教学提示'}</small>{#if staleActivityIds.has(issue.activityId) || wholeCourseStale}<small class="recomputed-tag">已按最新变化重算</small>{/if}</div><h3>{issue.title}</h3><p>{issue.detail}</p></div>
            <Button size="small" kind="ghost" on:click={() => focusIssue(issue)}>定位活动</Button>
          </article>
        {:else}
          <Tile class="all-clear"><h3>课程检查通过</h3><p>教学顺序、反馈与无障碍说明均已完成。</p></Tile>
        {/each}
        {#if diagnostics.length}
          <div class="rule-grid">
            <Tile><span>前置知识</span><strong>先教后用</strong><p>非音素活动使用未单独教学的音素时阻断。</p></Tile>
            <Tile><span>相似音</span><strong>对比教学</strong><p>发现 /b/-/p/、/f/-/v/ 等音对时建议增加辨音。</p></Tile>
            <Tile><span>例句</span><strong>≤ 12 词</strong><p>超过建议长度时提示拆分意群。</p></Tile>
            <Tile><span>练习</span><strong>必须有反馈</strong><p>每个练习活动都要提供可行动反馈。</p></Tile>
          </div>
        {/if}
      </div>
    </main>
  {/if}

  {#if activeView === 'versions'}
    <main class="versions-view">
      <div class="view-heading">
        <div><span class="kicker">REUSE & HISTORY</span><h2>版本与课程复用</h2><p>存档版本包含来源课程信息、完整活动、依赖和教学说明；合并产生的版本会标注来源课程包。</p></div>
        <div class="version-actions"><Button kind="tertiary" on:click={copyCourse}>复制课程</Button><Button kind="primary" on:click={saveVersion}>保存新版本</Button></div>
      </div>
      <div class="version-layout-svelte">
        <Tile class="version-timeline">
          <div class="section-title"><div><span class="kicker">TIMELINE</span><h3>课程版本</h3></div><Tag type="cool-gray">{course.versions.length} 个快照</Tag></div>
          {#each course.versions as version, index (version.id)}
            <article class:latest={index === course.versions.length - 1}>
              <span class="timeline-dot"></span>
              <div><b>{version.label}{#if version.mergedFromPackage}<Tag type="teal" style="margin-left:6px">合并</Tag>{/if}</b><h4>{version.note}</h4><p>{formatTime(version.savedAt)} · {version.activities.length} 个活动{#if version.mergedFromPackage} · 来源 {version.mergedFromPackage}{/if}</p></div>
            </article>
          {/each}
        </Tile>
        <Tile class="diff-card">
          <div class="section-title"><div><span class="kicker">COMPARE</span><h3>比较两个版本</h3></div></div>
          <div class="compare-pickers">
            <Select labelText="基准版本" selected={compareBaseId} on:change={(event) => compareBaseId = readText(event)}>
              {#each course.versions as version}<SelectItem value={version.id} text={`${version.label} · ${formatTime(version.savedAt)}`} />{/each}
            </Select>
            <Select labelText="目标版本" selected={compareTargetId} on:change={(event) => compareTargetId = readText(event)}>
              {#each course.versions as version}<SelectItem value={version.id} text={`${version.label} · ${formatTime(version.savedAt)}`} />{/each}
            </Select>
          </div>
          <div class="diff-list">
            {#each versionDiff as diff}
              <article class={diff.kind}><span>{diff.kind === 'added' ? '新增' : diff.kind === 'removed' ? '删除' : '修改'}</span><div><b>{diff.title}</b><p>{diff.detail}</p></div></article>
            {:else}
              <p class="empty-state">两个版本之间没有活动差异，或尚未选择版本。</p>
            {/each}
          </div>
        </Tile>
      </div>
    </main>
  {/if}

  {#if activeView === 'merge'}
    <main class="merge-view">
      <div class="view-heading">
        <div><span class="kicker">PACKAGE MERGE</span><h2>课程包合并</h2><p>课程包带来源版本与活动快照：单边新增、顺序或说明变化直接并入；同一活动两边都改时并列保留，全部选定前不写当前课程；依赖始终取两边并集。</p></div>
      </div>

      {#if mergeMessage}
        <InlineNotification class="merge-inline" lowContrast kind="success" title="合并处理进展" subtitle={mergeMessage} on:close={() => mergeMessage = ''} />
      {/if}

      <div class="merge-layout">
        <div class="merge-main">
          <Tile class="package-export">
            <span class="kicker">SEND AWAY</span><h3>生成给同事的课程包</h3>
            <p class="empty-state">课程包内含来源版本 id、该版本全部活动快照、当前活动与课程信息、课程修订号；同事离线修改后带回即可三向合并。</p>
            <div class="export-form">
              <TextInput labelText="打包人" value={exportBy} on:input={(event) => exportBy = readText(event)} />
              <TextInput labelText="带走说明（可选）" value={exportNote} on:input={(event) => exportNote = readText(event)} />
            </div>
            <Button kind="primary" on:click={handleExportPackage}>导出课程包（.json）</Button>
          </Tile>

          <Tile class="package-import">
            <span class="kicker">BRING BACK</span><h3>导入带回的课程包</h3>
            {#key fileInputKey}
              <FileUploader
                labelTitle="选择课程包文件"
                labelDescription="单次一个 .json 课程包；导入后进入待处理队列并生成合并预演，不会立即改动课程。"
                accept={['.json', 'application/json']}
                multiple={false}
                buttonLabel="选择课程包"
                on:add={acceptPackageFile}
              />
            {/key}
          </Tile>

          {#if mergePreview}
            {@const preview = mergePreview}
            <Tile class="merge-preview">
              <div class="section-title">
                <div>
                  <span class="kicker">THREE-WAY PREVIEW</span>
                  <h3>合并预演 · 来源版本 {preview.pkg.baseVersionId || '（无，按新增处理）'}</h3>
                  <p>预演不会改动当前课程。所有冲突选定前“确认并入”按钮保持禁用。</p>
                </div>
                <div class="merge-stats">
                  <Tag type="green">单边新增 {preview.addedLocal.length + preview.addedIncoming.length}</Tag>
                  <Tag type="purple">顺序变化 {preview.reordered.length}</Tag>
                  <Tag type="cyan">说明变化 {preview.notesChanged.length}</Tag>
                  <Tag type="blue">依赖变化 {preview.depsChanged.length}</Tag>
                  <Tag type={preview.conflicts.length ? 'red' : 'green'}>待决冲突 {preview.conflicts.length}</Tag>
                </div>
              </div>

              <ul class="merge-reasons">
                {#each preview.reasons.slice(0, 8) as reason}<li>{reason}</li>{/each}
              </ul>

              {#if preview.conflicts.length}
                <div class="conflict-list">
                  {#each preview.conflicts as conflict, ci (conflict.activityId)}
                    <section class="conflict-card" data-side={conflict.resolution ?? ''}>
                      <header>
                        <b>冲突 {ci + 1} · {previewTitle(conflict)}</b>
                        <small>分歧字段：{conflict.fields.join('、')}</small>
                        <Tag type={conflict.resolution ? 'green' : 'red'}>{conflict.resolution === 'local' ? '已选：保留本地' : conflict.resolution === 'incoming' ? '已选：采用带回' : conflict.resolution === 'drop' ? '已选：删除该活动' : '未选定，暂不写入'}</Tag>
                      </header>
                      <div class="conflict-columns">
                        <article class:chosen={conflict.resolution === 'local'}>
                          <div class="conflict-head"><span>本地版本</span><Button size="small" kind={conflict.resolution === 'local' ? 'primary' : 'tertiary'} disabled={!conflict.local} on:click={() => chooseConflict(conflict, 'local')}>保留本地</Button></div>
                          {#if conflict.local}
                            <ConflictDetail {conflict} side="local" />
                          {:else}<p class="empty-state">本地已删除该活动。</p>{/if}
                        </article>
                        <article class:chosen={conflict.resolution === 'incoming'}>
                          <div class="conflict-head"><span>课程包版本 · {preview.pkg.exportedBy}</span><Button size="small" kind={conflict.resolution === 'incoming' ? 'primary' : 'tertiary'} disabled={!conflict.incoming} on:click={() => chooseConflict(conflict, 'incoming')}>采用带回</Button></div>
                          {#if conflict.incoming}
                            <ConflictDetail {conflict} side="incoming" />
                          {:else}<p class="empty-state">课程包已删除该活动。</p>{/if}
                        </article>
                      </div>
                      <Button size="small" kind="danger-ghost" class="drop-conflict" on:click={() => chooseConflict(conflict, 'drop')}>两版都不要，合并后删除该活动</Button>
                    </section>
                  {/each}
                </div>
              {/if}

              {#if preview.danglingDependencies.length}
                <InlineNotification class="merge-inline" lowContrast kind="warning" title="合并后存在悬空依赖" subtitle={preview.danglingDependencies.map((d) => `${d.activityId} → ${d.missingId}`).join('；')} />
              {/if}

              <div class="merge-confirm">
                <Button kind="primary" disabled={!canApplyMerge()} on:click={() => applyMerge(pendingMerges.find((item) => item.pkg.exportedAt === preview.pkg.exportedAt))}>
                  {unresolvedCount ? `还有 ${unresolvedCount} 个冲突未选定` : '确认并入当前课程'}
                </Button>
                <Button kind="ghost" on:click={() => mergePreview = null}>取消预演</Button>
                <p class="empty-state">确认后会新增一个“合并自 {preview.pkg.exportedBy}”的存档版本；失败时原课程与待处理队列均保留。</p>
              </div>
            </Tile>
          {/if}
        </div>

        <aside class="merge-side">
          <Tile class="pending-card">
            <div class="section-title"><div><span class="kicker">QUEUE</span><h3>待处理课程包</h3></div><Tag type="cool-gray">{pendingMerges.length}</Tag></div>
            {#each pendingMerges as item (item.id)}
              <article class="pending-row">
                <b>{item.pkg.exportedBy}</b>
                <small>{formatTime(item.pkg.exportedAt)} · {item.pkg.activities.length} 个活动 · 来源版本 {item.pkg.baseVersionId || '无'}</small>
                <p>{item.pkg.note || '（无说明）'}</p>
                <div class="pending-actions">
                  <Button size="small" kind="tertiary" on:click={() => openPending(item)}>合并预演</Button>
                  <Button size="small" kind="danger-ghost" on:click={() => dropPending(item)}>移出队列</Button>
                </div>
              </article>
            {:else}
              <p class="empty-state">队列是空的。导入同事带回的课程包后，会先在这里排队，失败也不会丢失。</p>
            {/each}
          </Tile>

          <Tile class="drafts-card">
            <div class="section-title"><div><span class="kicker">SAVED DRAFTS</span><h3>并发冲突草稿</h3></div><Tag type={rejectedDrafts.length ? 'magenta' : 'cool-gray'}>{rejectedDrafts.length}</Tag></div>
            <p class="empty-state">两个标签页同时提交同一旧版本时，后提交者不覆盖先提交内容，其课程保留为草稿。</p>
            {#each rejectedDrafts as draft (draft.id)}
              <article class="draft-row">
                <b>{draft.label}</b>
                <small>{formatTime(draft.savedAt)} · {draft.course.activities.length} 个活动</small>
                <div class="pending-actions">
                  <Button size="small" kind="tertiary" on:click={() => exportDraftAsPackage(draft)}>导出为课程包并回</Button>
                  <Button size="small" kind="danger-ghost" on:click={() => discardDraft(draft)}>删除草稿</Button>
                </div>
              </article>
            {/each}
          </Tile>

          {#if reloadSuggested}
            <Tile class="reload-card">
              <span class="kicker">STALE TAB</span>
              <h3>本标签页基于旧版本</h3>
              <p class="empty-state">另一个标签页已经先提交。重载可看到最新课程；本页继续保存不会覆盖它，而是保留草稿。</p>
              <Button size="small" kind="primary" on:click={reloadFromStorage}>重载最新课程</Button>
            </Tile>
          {/if}
        </aside>
      </div>
    </main>
  {/if}

  <footer class="app-footer">
    <span>所有数据保存在当前浏览器 localStorage · 当前修订版本 {course.revision}</span>
    <span>Ctrl/Cmd + Z 撤销 · Ctrl/Cmd + Y 重做 · Alt + N 新建活动 · Ctrl/Cmd + S 保存</span>
  </footer>
</div>

