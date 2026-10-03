<script lang="ts">
  import { onMount } from 'svelte';
  import {
    Button,
    Checkbox,
    InlineNotification,
    Select,
    SelectItem,
    Tag,
    TextArea,
    TextInput,
    Tile
  } from 'carbon-components-svelte';
  import {
    analyzeCourse,
    buildInvalidationNotice,
    type ChangeTrigger
  } from '$lib/analysis';
  import {
    ACTIVITY_FIELDS,
    applyResolvedMerge,
    buildFieldMergedActivity,
    fieldEqual,
    fieldLabel,
    mergeCourses,
    parsePackage
  } from '$lib/merge';
  import {
    addInvalidation,
    addPendingItem,
    addStashedDraft,
    bootstrapCourse,
    clearInvalidations,
    commitCourse,
    readInvalidations,
    readLegacyCourse,
    readPendingItems,
    readStashedDrafts,
    readStoredCourse,
    removePendingItem,
    removeStashedDraft,
    STORAGE_KEY,
    subscribeStorage,
    writePendingItems
  } from '$lib/storage';
  import {
    compareCourseVersions,
    createVersionSnapshot,
    downloadPackage,
    exportCoursePackage
  } from '$lib/versions';
  import type {
    Activity,
    ActivityFieldKey,
    ActivityType,
    ConflictSide,
    Course,
    CoursePackage,
    Diagnostic,
    InvalidationNotice,
    PendingItem,
    PendingMergeReview,
    PreviewWidth,
    StashedDraft,
    VersionDiff,
    ViewMode
  } from '$lib/types';

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
        activities: []
      },
      {
        id: 'v-2', label: '增加句子迁移', savedAt: '2026-09-24T15:30:00+08:00', note: '补充 A man sat and had a nap.',
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

  // 乐观并发：本地课程基于哪个 revision；另一个标签页已提交时用于提示重载。
  let baseRevision = 1;
  let remoteCourse: Course | null = null;
  let reloadNotice = '';
  // 提交失败（旧版本）后保留的草稿。
  let stashNotice = '';
  // 课程包导入与合并评审。
  let fileError = '';
  let activePendingId = '';
  let pendingItems: PendingItem[] = [];
  let stashedDrafts: StashedDraft[] = [];
  let exportSender = '同事';
  let fileInput: HTMLInputElement | null = null;
  // 失效重算记录。
  let invalidations: InvalidationNotice[] = [];
  let lastInvalidationId = '';

  $: selectedActivity = course.activities.find((activity) => activity.id === selectedActivityId) ?? course.activities[0] ?? null;
  $: diagnostics = analyzeCourse(course);
  $: versionDiff = compareCourseVersions(course, compareBaseId, compareTargetId);
  $: errorCount = diagnostics.filter((issue) => issue.level === 'error').length;
  $: warningCount = diagnostics.filter((issue) => issue.level === 'warning').length;
  $: totalMinutes = course.activities.reduce((sum, activity) => sum + activity.duration, 0);
  $: activePending = pendingItems.find((item) => item.id === activePendingId)?.review ?? null;
  $: unresolvedCount = activePending?.conflicts.filter((conflict) => conflict.resolution === null).length ?? 0;
  $: lastInvalidation = invalidations.find((item) => item.id === lastInvalidationId) ?? invalidations[0] ?? null;

  onMount(() => {
    const stored = readStoredCourse();
    if (stored) {
      course = migrateCourse(stored);
    } else {
      // 首次：兼容旧版 v1 存储，否则写入种子课程（revision=1）。
      const legacy = readLegacyCourse() as Course | null;
      if (legacy && Array.isArray(legacy.activities)) {
        course = migrateCourse({ ...legacy, revision: 1 });
      }
      course = bootstrapCourse(course);
    }
    baseRevision = course.revision;
    selectedActivityId = course.activities[0]?.id ?? '';
    compareBaseId = course.versions[0]?.id ?? '';
    compareTargetId = course.versions.at(-1)?.id ?? '';
    pendingItems = readPendingItems();
    stashedDrafts = readStashedDrafts();
    invalidations = readInvalidations();
    savedLabel = `已恢复 · r${course.revision} · ${formatTime(course.updatedAt)}`;
    hydrated = true;

    const updateNetwork = () => {
      online = navigator.onLine;
      showOfflineNotice = !online;
    };
    updateNetwork();
    window.addEventListener('online', updateNetwork);
    window.addEventListener('offline', updateNetwork);

    // 另一个标签页提交：本页若已落后，提示重载，绝不静默覆盖。
    const unsubscribe = subscribeStorage((key) => {
      if (key !== STORAGE_KEY) {
        if (key === 'sologsb-1026-phonics-pending-v1') pendingItems = readPendingItems();
        if (key === 'sologsb-1026-phonics-stash-v1') stashedDrafts = readStashedDrafts();
        return;
      }
      const latest = readStoredCourse();
      if (!latest || latest.revision <= baseRevision) return;
      remoteCourse = latest;
      reloadNotice =
        `另一个标签页已提交 r${latest.revision}（当前停留在 r${baseRevision}）。请先重载再继续，本页不会覆盖它的内容。`;
    });

    return () => {
      window.removeEventListener('online', updateNetwork);
      window.removeEventListener('offline', updateNetwork);
      unsubscribe();
    };
  });

  function migrateCourse(value: Course): Course {
    if (!value.id || !Array.isArray(value.activities)) return initialCourse();
    value.versions ??= [];
    value.revision ??= 1;
    return value;
  }

  // 记录一次“失效重算”：写入跨标签页可见的记录，并在页面顶部说明原因。
  function recordInvalidation(trigger: ChangeTrigger, activities: Activity[]): void {
    if (!hydrated) return;
    const notice = buildInvalidationNotice(trigger, activities);
    invalidations = [notice, ...invalidations].slice(0, 30);
    lastInvalidationId = notice.id;
    addInvalidation(notice);
  }

  /**
   * 所有修改的唯一入口：乐观提交。
   * expectedRevision 落后时提交失败，原课程保持不变，待处理项仍可继续处理。
   */
  function commit(
    recipe: (draft: Course) => void,
    options: { trigger?: ChangeTrigger; trackHistory?: boolean } = {}
  ): boolean {
    const trackHistory = options.trackHistory !== false;
    const trigger = options.trigger;
    if (trackHistory) history = [...history.slice(-49), structuredClone(course)];
    const draft = structuredClone(course);
    recipe(draft);
    const activitiesForInvalidation = draft.activities;
    const result = commitCourse(draft, baseRevision);
    if (!result.ok || !result.course) {
      // 乐观锁失败：回退本页状态，保留先提交内容；当前编辑意图存入草稿。
      if (trackHistory) history = history.slice(0, -1);
      stashDraft(draft, result.remoteRevision, 'stale-revision');
      return false;
    }
    course = result.course;
    baseRevision = result.course.revision;
    if (trackHistory) future = [];
    reloadNotice = '';
    savedLabel = `已保存 · r${course.revision} · ${formatTime(course.updatedAt)}`;
    if (trigger) recordInvalidation(trigger, activitiesForInvalidation);
    return true;
  }

  function stashDraft(draft: Course, remoteRevision: number, reason: StashedDraft['reason'], pendingItemId = ''): void {
    // 同一旧版本上连续编辑失败时只更新同一份草稿，避免每次按键都堆一条草稿。
    const existing = stashedDrafts.find((item) => item.baseRevision === baseRevision && item.remoteRevision === remoteRevision);
    const stash: StashedDraft = existing
      ? { ...existing, course: structuredClone(draft), createdAt: new Date().toISOString(), pendingItemId: pendingItemId || existing.pendingItemId }
      : {
          id: `stash-${Date.now()}`,
          createdAt: new Date().toISOString(),
          reason,
          remoteRevision,
          baseRevision,
          course: draft,
          pendingItemId,
          note:
            `这份草稿基于旧版本 r${baseRevision}，另一个标签页已先提交到 r${remoteRevision}。` +
            '已保留草稿，请在版本与复用页重载新课程后再处理；先提交的内容未被覆盖。'
        };
    if (existing) {
      const items = stashedDrafts.map((item) => (item.id === existing.id ? stash : item));
      localStorage.setItem('sologsb-1026-phonics-stash-v1', JSON.stringify(items));
    } else {
      addStashedDraft(stash);
    }
    stashedDrafts = readStashedDrafts();
    stashNotice = stash.note;
  }

  /** 放弃本页未提交视图，改用主存储中的最新课程。 */
  function reloadRemoteCourse(): void {
    if (!remoteCourse) return;
    history = [];
    future = [];
    course = migrateCourse(remoteCourse);
    baseRevision = course.revision;
    selectedActivityId = course.activities[0]?.id ?? '';
    reloadNotice = '';
    savedLabel = `已重载 · r${course.revision} · ${formatTime(course.updatedAt)}`;
  }

  function undo(): void {
    const previous = history.at(-1);
    if (!previous) return;
    const currentSnapshot = structuredClone(course);
    const ok = commit(() => structuredClone(previous), { trackHistory: false });
    if (!ok) return;
    future = [currentSnapshot, ...future].slice(0, 50);
    history = history.slice(0, -1);
    selectedActivityId = course.activities[0]?.id ?? '';
  }

  function redo(): void {
    const next = future[0];
    if (!next) return;
    const currentSnapshot = structuredClone(course);
    const ok = commit(() => structuredClone(next), { trackHistory: false });
    if (!ok) return;
    history = [...history, currentSnapshot].slice(-50);
    future = future.slice(1);
    selectedActivityId = course.activities[0]?.id ?? '';
  }

  function saveNow(): void {
    const result = commitCourse(course, baseRevision);
    if (!result.ok || !result.course) {
      stashDraft(course, result.remoteRevision, 'stale-revision');
      return;
    }
    course = result.course;
    baseRevision = course.revision;
    savedLabel = `已保存 · r${course.revision} · ${formatTime(course.updatedAt)}`;
  }

  function updateCourse(field: 'title' | 'level' | 'ageRange' | 'objective', value: string): void {
    commit((draft) => { draft[field] = value; });
  }

  function updateActivity(field: keyof Activity, value: unknown): void {
    if (!selectedActivity) return;
    const id = selectedActivity.id;
    const before = course.activities.find((activity) => activity.id === id);
    if (!before) return;
    const changed: ActivityFieldKey[] = [];
    const candidateField = field as ActivityFieldKey;
    if (ACTIVITY_FIELDS.includes(candidateField)) {
      const after = { ...before, [field]: value } as Activity;
      if (!fieldEqual(before, after, candidateField)) changed.push(candidateField);
    }
    commit((draft) => {
      const target = draft.activities.find((activity) => activity.id === id);
      if (target) (target as unknown as Record<string, unknown>)[field] = value;
    }, { trigger: changed.length ? { kind: 'activity', activityId: id, fields: changed } : undefined });
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
    const ok = commit((draft) => {
      draft.activities.push({
        id, type, title: `新的${type}活动`, content: '', phonemes: [], dependencies: [],
        difficulty: 1, prompt: '请输入教师提示语。', accessibility: '请描述视觉、听觉或键盘无障碍支持。',
        duration: type === '练习' ? 10 : 8, feedback: ''
      });
    }, { trigger: { kind: 'add', activityId: id } });
    if (ok) {
      selectedActivityId = id;
      activeView = 'compose';
    }
  }

  function deleteActivity(): void {
    if (!selectedActivity || course.activities.length <= 1) return;
    const id = selectedActivity.id;
    const ok = commit((draft) => {
      draft.activities = draft.activities.filter((activity) => activity.id !== id);
      draft.activities.forEach((activity) => {
        activity.dependencies = activity.dependencies.filter((dependency) => dependency !== id);
      });
    }, { trigger: { kind: 'remove', activityId: id } });
    if (ok) selectedActivityId = course.activities[0]?.id ?? '';
  }

  function duplicateActivity(): void {
    if (!selectedActivity) return;
    const source = structuredClone(selectedActivity);
    source.id = `a-${Date.now()}`;
    source.title = `${source.title}（副本）`;
    source.dependencies = [...source.dependencies];
    const ok = commit((draft) => {
      const index = draft.activities.findIndex((activity) => activity.id === selectedActivity?.id);
      draft.activities.splice(index + 1, 0, source);
    }, { trigger: { kind: 'add', activityId: source.id } });
    if (ok) selectedActivityId = source.id;
  }

  function moveActivity(direction: -1 | 1): void {
    if (!selectedActivity) return;
    const id = selectedActivity.id;
    const index = course.activities.findIndex((activity) => activity.id === id);
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= course.activities.length) return;
    const ok = commit((draft) => {
      const current = draft.activities.findIndex((activity) => activity.id === id);
      const target = current + direction;
      if (target < 0 || target >= draft.activities.length) return;
      const [item] = draft.activities.splice(current, 1);
      draft.activities.splice(target, 0, item);
    }, { trigger: { kind: 'order' } });
    if (ok) return;
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

  function saveVersion(): void {
    const snapshot = createVersionSnapshot(course);
    const number = course.versions.length + 1;
    commit((draft) => {
      draft.versions.push(snapshot);
    }, { trigger: { kind: 'merge', detail: '存档了新版本快照：版本集合变化，全部检查基于当前活动重新计算。' } });
    compareTargetId = snapshot.id;
    if (!compareBaseId) compareBaseId = course.versions.at(-2)?.id ?? '';
    savedLabel = `版本 ${number} 已存档 · r${baseRevision}`;
  }

  function copyCourse(): void {
    commit((draft) => {
      const copy = structuredClone(draft);
      copy.id = `course-${Date.now()}`;
      copy.title = `${copy.title} · 副本`;
      copy.versions = [];
      copy.activities.forEach((activity) => {
        activity.title = activity.title.replace('（副本）', '') + '（复制）';
      });
      draft.id = copy.id;
      draft.title = copy.title;
      draft.versions = copy.versions;
      draft.activities = copy.activities;
    }, { trigger: { kind: 'merge', detail: '整门课程复制为新草稿，活动与依赖重新生成，全部检查重新计算。' } });
    savedLabel = '课程已复制为新草稿';
  }

  // --- 课程包导出 / 导入 / 合并评审 ---

  function handleExport(): void {
    const base = course.versions.at(-1);
    if (!base) {
      fileError = '请先至少存档一个版本，课程包需要带来源版本快照。';
      return;
    }
    fileError = '';
    const data = exportCoursePackage(course, base, exportSender);
    downloadPackage(data);
    savedLabel = `课程包已导出（基于 r${course.revision}）`;
  }

  function triggerImport(): void {
    fileInput?.click();
  }

  function handleImportFile(event: Event): void {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    file.text().then((text) => {
      try {
        const data = parsePackage(text);
        openMergeReview(data);
      } catch (error) {
        fileError = error instanceof Error ? error.message : '课程包解析失败。';
      }
    }).catch(() => {
      fileError = '课程包读取失败，请重试。';
    });
  }

  function openMergeReview(data: CoursePackage): void {
    fileError = '';
    if (data.courseId !== course.id) {
      fileError = `课程包属于另一门课程（${data.courseId}），不能并入当前课程（${course.id}）。`;
      return;
    }
    const mergeResult = mergeCourses(data.baseActivities, course.activities, data.activities);
    const review: PendingMergeReview = {
      id: `review-${Date.now()}`,
      packageData: data,
      conflicts: mergeResult.conflicts,
      autoChanges: mergeResult.autoChanges,
      mergeResult,
      mergedAt: new Date().toISOString(),
      mergedFromRevision: baseRevision
    };
    const item: PendingItem = { id: review.id, createdAt: review.mergedAt, review };
    addPendingItem(item);
    pendingItems = readPendingItems();
    activePendingId = review.id;
    activeView = 'versions';
  }

  function openPending(item: PendingItem): void {
    activePendingId = item.id;
  }

  function discardPending(item: PendingItem): void {
    removePendingItem(item.id);
    pendingItems = readPendingItems();
    if (activePendingId === item.id) activePendingId = '';
  }

  function setConflictResolution(conflictId: string, resolution: ConflictSide): void {
    if (!activePending) return;
    const review = structuredClone(activePending);
    const conflict = review.conflicts.find((item) => item.activityId === conflictId);
    if (!conflict) return;
    conflict.resolution = resolution;
    if (resolution === 'merged') {
      conflict.mergedActivity = buildFieldMergedActivity(conflict, review.packageData.baseActivities);
    }
    persistActiveReview(review);
  }

  function persistActiveReview(review: PendingMergeReview): void {
    const items = pendingItems.map((item) =>
      item.id === review.id ? { ...item, review } : item
    );
    writePendingItems(items);
    pendingItems = items;
    activePendingId = review.id;
  }

  /** 全部冲突选定后提交合并；未选定前不写当前课程。 */
  function confirmMerge(): void {
    if (!activePending || unresolvedCount > 0) return;
    const review = activePending;
    const { activities } = applyResolvedMerge(
      { baseActivities: review.packageData.baseActivities, conflicts: review.conflicts },
      review.mergeResult
    );
    const ok = commit((draft) => {
      draft.activities = activities;
    }, {
      trigger: {
        kind: 'merge',
        detail:
          `并入“${review.packageData.sender}”的课程包：单边新增/顺序/说明变化已直接合并，` +
          `${review.conflicts.length} 个冲突已按选定版本保留，依赖取两边并集，全部下游与音素检查重算。`
      }
    });
    if (ok) {
      removePendingItem(review.id);
      pendingItems = readPendingItems();
      activePendingId = '';
      selectedActivityId = activities[0]?.id ?? '';
      savedLabel = `课程包已并入 · r${baseRevision}`;
    } else {
      // 提交失败：把合并结果也存进草稿，待处理项保留，重载后仍可继续处理。
      stashDraft(
        Object.assign(structuredClone(course), { activities }),
        readStoredCourse()?.revision ?? baseRevision,
        'stale-revision',
        review.id
      );
    }
  }

  function restoreDraft(draft: StashedDraft): void {
    history = [];
    future = [];
    course = migrateCourse(structuredClone(draft.course));
    // 载入后以远端最新 revision 为乐观锁基准，保存成功即把草稿内容接续到新版本之后，
    // 若期间又有新提交，保存会再次失败并提示，而不会覆盖别人。
    baseRevision = draft.remoteRevision;
    selectedActivityId = course.activities[0]?.id ?? '';
    removeStashedDraft(draft.id);
    stashedDrafts = readStashedDrafts();
    stashNotice = '';
    if (draft.pendingItemId) activePendingId = draft.pendingItemId;
    activeView = 'versions';
    savedLabel = '已载入旧草稿 · 保存即接续到最新版本之后';
  }

  function discardDraft(draft: StashedDraft): void {
    removeStashedDraft(draft.id);
    stashedDrafts = readStashedDrafts();
  }

  function focusIssue(issue: Diagnostic): void {
    selectedActivityId = issue.activityId;
    activeView = 'compose';
  }

  function formatTime(value: string): string {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(date);
  }

  function activityTitle(id: string): string {
    return course.activities.find((activity) => activity.id === id)?.title ?? id;
  }

  function fieldValue(activity: Activity | null, field: ActivityFieldKey): string {
    if (!activity) return '— 该版本已删除 —';
    const value = activity[field];
    if (Array.isArray(value)) return value.length ? value.join('、') : '（空）';
    return String(value ?? '');
  }

  function sideName(side: ConflictSide): string {
    return side === 'local' ? '本地版' : side === 'incoming' ? '同事版' : side === 'merged' ? '字段拼合版' : '未选定';
  }

  /** 该字段在指定一侧是否与另一侧不同（用于并列对比高亮）。 */
  function isSideChanged(conflict: { localActivity: Activity | null; incomingActivity: Activity | null }, side: 'local' | 'incoming', field: ActivityFieldKey): boolean {
    const left = side === 'local' ? conflict.localActivity : conflict.incomingActivity;
    const right = side === 'local' ? conflict.incomingActivity : conflict.localActivity;
    if (!left || !right) return true;
    return !fieldEqual(left, right, field);
  }

  function clearInvalidationLog(): void {
    clearInvalidations();
    invalidations = [];
    lastInvalidationId = '';
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

  {#if reloadNotice}
    <div class="merge-banner stale">
      <InlineNotification lowContrast kind="warning" title="课程已被另一个标签页更新，需要重载" subtitle={reloadNotice}>
        <svelte:fragment slot="actions">
          <Button size="small" kind="primary" on:click={reloadRemoteCourse}>重载最新课程（r{remoteCourse?.revision}）</Button>
        </svelte:fragment>
      </InlineNotification>
    </div>
  {/if}
  {#if stashNotice}
    <div class="merge-banner">
      <InlineNotification lowContrast kind="error" title="提交基于旧版本，已保留草稿且未覆盖先提交内容" subtitle={stashNotice}>
        <svelte:fragment slot="actions">
          <Button size="small" kind="ghost" on:click={() => { stashNotice = ''; activeView = 'versions'; }}>去处理草稿</Button>
        </svelte:fragment>
      </InlineNotification>
    </div>
  {/if}
  {#if fileError}
    <div class="merge-banner">
      <InlineNotification lowContrast kind="error" title="课程包无法导入" subtitle={fileError} on:close={() => (fileError = '')} />
    </div>
  {/if}
  {#if lastInvalidation}
    <div class="merge-banner invalidation">
      <InlineNotification lowContrast kind="info" title={lastInvalidation.title} subtitle={lastInvalidation.reason}>
        <svelte:fragment slot="actions">
          <Button size="small" kind="ghost" on:click={() => (lastInvalidationId = '')}>知道了</Button>
        </svelte:fragment>
      </InlineNotification>
    </div>
  {/if}

  {#if showOfflineNotice}
    <div class="offline-notice">
      <InlineNotification lowContrast kind="info" title="已切换到离线模式" subtitle="所有修改会先保存在本机浏览器，恢复网络后仍可继续编辑。" />
    </div>
  {/if}

  <section class="course-hero">
    <div class="hero-copy">
      <span class="kicker">COURSE BUILDER / {course.level} · r{baseRevision}</span>
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

  <nav class="workspace-tabs" aria-label="工作区">
    <button class:active={activeView === 'compose'} on:click={() => (activeView = 'compose')}><span>01</span><b>课程编排</b><small>活动、依赖与教学说明</small></button>
    <button class:active={activeView === 'path'} on:click={() => (activeView = 'path')}><span>02</span><b>学习路径</b><small>多屏幕顺序预览</small></button>
    <button class:active={activeView === 'issues'} on:click={() => (activeView = 'issues')}><span>03</span><b>质量检查</b><small>音素、句子与反馈</small></button>
    <button class:active={activeView === 'versions'} on:click={() => (activeView = 'versions')}><span>04</span><b>版本与合并{pendingItems.length ? `（${pendingItems.length}）` : ''}</b><small>课程包导入与三方合并</small></button>
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
            <button class:selected={activity.id === selectedActivityId} class="activity-row" on:click={() => (selectedActivityId = activity.id)}>
              <span class="sequence">{String(index + 1).padStart(2, '0')}</span>
              <span class="activity-type {activity.type}">{activity.type}</span>
              <span class="activity-copy"><b>{activity.title}</b><small>{activity.duration} 分钟 · 难度 {activity.difficulty}/5</small></span>
              {#if activity.dependencies.length}<i title="有前置依赖">↳</i>{/if}
            </button>
          {/each}
        </div>
        <div class="sidebar-help">快捷键：Alt + N 新建 · Alt + ↑/↓ 调整顺序</div>
      </aside>

      <section class="editor-column">
        {#if selectedActivity}
          <div class="editor-toolbar">
            <div>
              <span class="kicker">ACTIVITY EDITOR</span>
              <h3>{selectedActivity.type}活动</h3>
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
              <div><span class="kicker">PREREQUISITES</span><h3>前置活动与依赖关系</h3><p>只有完成选中的活动后，系统才会按当前顺序推荐本活动。合并时两边依赖取并集，不会丢失。</p></div>
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
          <Button size="small" kind="ghost" on:click={() => (activeView = 'issues')}>查看全部检查</Button>
        </Tile>
        {#if lastInvalidation}
          <Tile class="compact-card invalidation-card">
            <div class="section-title"><div><span class="kicker">INVALIDATION</span><h3>检查已失效重算</h3></div></div>
            <p class="empty-state">{lastInvalidation.reason}</p>
            <div class="invalidation-tags">
              {#each lastInvalidation.invalidatedChecks as check}<Tag type="blue">{check}</Tag>{/each}
            </div>
            {#if lastInvalidation.affectedActivityIds.length}
              <small>影响下游活动：{lastInvalidation.affectedActivityIds.slice(0, 5).map(activityTitle).join('、')}{lastInvalidation.affectedActivityIds.length > 5 ? ' 等' : ''}</small>
            {/if}
          </Tile>
        {/if}
      </aside>
    </main>
  {/if}

  {#if activeView === 'path'}
    <main class="path-view">
      <div class="path-toolbar">
        <div><span class="kicker">RESPONSIVE SEQUENCE</span><h2>学习顺序预览</h2><p>按活动依赖和课程顺序生成，可切换设备宽度检查信息密度。</p></div>
        <div class="width-switcher">
          <button class:active={previewWidth === 'phone'} on:click={() => (previewWidth = 'phone')}>手机</button>
          <button class:active={previewWidth === 'tablet'} on:click={() => (previewWidth = 'tablet')}>平板</button>
          <button class:active={previewWidth === 'desktop'} on:click={() => (previewWidth = 'desktop')}>桌面</button>
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
        <div><span class="kicker">CURRICULUM QA</span><h2>课程质量检查</h2><p>检查前置知识、相似音、例句长度、练习反馈、无障碍说明和依赖完整性。活动、依赖或版本变化后这里会立即重算。</p></div>
        <div class="issue-summary"><span><b>{errorCount}</b> 必须处理</span><span><b>{warningCount}</b> 建议调整</span><span><b>{diagnostics.length}</b> 全部提示</span></div>
      </div>
      {#if lastInvalidation}
        <Tile class="invalidation-banner">
          <b>{lastInvalidation.title}</b>
          <p>{lastInvalidation.reason}</p>
          <div class="invalidation-tags">{#each lastInvalidation.invalidatedChecks as check}<Tag type="blue">{check}</Tag>{/each}</div>
        </Tile>
      {/if}
      <div class="issue-board">
        {#each diagnostics as issue, index}
          <article class:critical={issue.level === 'error'} class:caution={issue.level === 'warning'} class:info={issue.level === 'info'}>
            <span class="issue-index">{String(index + 1).padStart(2, '0')}</span>
            <div><div class="issue-meta"><Tag type={issue.level === 'error' ? 'red' : issue.level === 'warning' ? 'magenta' : 'blue'}>{issue.category}</Tag><small>{issue.level === 'error' ? '必须处理' : issue.level === 'warning' ? '建议调整' : '教学提示'}</small></div><h3>{issue.title}</h3><p>{issue.detail}</p></div>
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
        <div><span class="kicker">MERGE & REUSE</span><h2>版本、课程包与三方合并</h2><p>导出的课程包带来源版本号和活动快照；导入后单边新增、顺序或说明变化直接并入，同活动两边改动并列保留，选定后才写入当前课程。</p></div>
        <div class="version-actions">
          <Button kind="tertiary" on:click={copyCourse}>复制课程</Button>
          <Button kind="primary" on:click={saveVersion}>保存新版本</Button>
        </div>
      </div>

      <Tile class="package-card">
        <div class="section-title">
          <div><span class="kicker">COURSE PACKAGE</span><h3>交给同事带走 / 收回合并</h3><p>课程包记录来源 revision、来源版本和活动快照，回收时据此做三方合并。</p></div>
          <Tag type="cool-gray">当前课程 r{baseRevision}</Tag>
        </div>
        <div class="package-row">
          <TextInput labelText="带走人标识（写进课程包）" value={exportSender} on:input={(event) => (exportSender = readText(event))} />
          <div class="package-buttons">
            <Button kind="tertiary" on:click={handleExport}>导出课程包</Button>
            <Button kind="primary" on:click={triggerImport}>导入课程包</Button>
            <input bind:this={fileInput} type="file" accept="application/json,.json" class="hidden-file" on:change={handleImportFile} />
          </div>
        </div>
      </Tile>

      {#if activePending}
        <section class="merge-review" aria-label="课程包合并评审">
          <div class="review-heading">
            <div>
              <span class="kicker">THREE-WAY MERGE</span>
              <h3>合并评审 · {activePending.packageData.sender} 的课程包</h3>
              <p>
                来源版本“{activePending.packageData.baseVersionLabel}”（r{activePending.packageData.baseRevision}），
                导入时本地为 r{activePending.mergedFromRevision}。
                {#if activePending.conflicts.length === 0}
                  本次合并没有“两边都改同一活动”的情况：单边新增、顺序与说明变化已直接并入，依赖已取两边并集，确认后即写入当前课程。
                {:else}
                  单边变化已自动并入；同活动两边改动并列保留，{unresolvedCount > 0 ? `还剩 ${unresolvedCount} 个未选定，未选定前不会写入当前课程。` : '冲突已全部选定，可以并入。'}
                {/if}
              </p>
            </div>
            <div class="review-actions">
              <Tag type={unresolvedCount ? 'red' : 'green'}>{unresolvedCount ? `${unresolvedCount} 待选定` : '可并入'}</Tag>
              <Button size="small" kind="ghost" on:click={() => discardPending({ id: activePending.id, createdAt: '', review: activePending })}>放弃本次合并</Button>
              <Button size="small" kind="primary" disabled={unresolvedCount > 0} on:click={confirmMerge}>并入当前课程</Button>
            </div>
          </div>

          {#if activePending.autoChanges.length}
            <Tile class="auto-changes">
              <span class="kicker">AUTO MERGED</span>
              <h4>直接并入的变化（{activePending.autoChanges.length}）</h4>
              <ul>
                {#each activePending.autoChanges as change}
                  <li class={change.kind}><span>{({
                    'added-incoming': '同事新增',
                    'added-local': '本地新增',
                    deleted: '删除',
                    order: '顺序',
                    description: '说明变化'
                  })[change.kind]}</span><b>{change.title}</b><p>{change.detail}</p></li>
                {/each}
              </ul>
            </Tile>
          {/if}

          {#if activePending.mergeResult.danglingDependencies.length}
            <InlineNotification lowContrast kind="warning" title="存在悬空依赖，但未被丢弃" subtitle="有依赖指向被单边删除的活动，已保留在依赖列表中，并入后请在质量检查中处理。" />
          {/if}

          <div class="conflict-list">
            {#each activePending.conflicts as conflict, index (conflict.activityId)}
              <Tile class="conflict-card {conflict.resolution !== null ? 'resolved' : ''}">
                <div class="conflict-head">
                  <div>
                    <span class="kicker">CONFLICT {String(index + 1).padStart(2, '0')} · {conflict.kind === 'delete-vs-modify' ? '删除/修改冲突' : '两边都改了'}</span>
                    <h4>{conflict.title}</h4>
                    <small>涉及字段：{conflict.changedFields.map(fieldLabel).join('、')}{conflict.fieldSuggestion ? '（两边改的字段不重叠，可一键字段拼合）' : ''}</small>
                  </div>
                  <Tag type={conflict.resolution ? 'green' : 'red'}>{sideName(conflict.resolution)}</Tag>
                </div>
                <div class="conflict-sides">
                  <article class:chosen={conflict.resolution === 'local'}>
                    <div class="side-head"><b>本地版</b><Button size="small" kind={conflict.resolution === 'local' ? 'primary' : 'tertiary'} on:click={() => setConflictResolution(conflict.activityId, 'local')}>{conflict.resolution === 'local' ? '已选定' : '选这版'}</Button></div>
                    {#if conflict.localActivity}
                      <div class="side-fields">
                        {#each conflict.changedFields as field}
                          <div class:changed={isSideChanged(conflict, 'local', field)}>
                            <span>{fieldLabel(field)}</span><p>{fieldValue(conflict.localActivity, field)}</p>
                          </div>
                        {/each}
                      </div>
                    {:else}
                      <p class="empty-state">本地已删除该活动（选这版表示确认删除）。</p>
                    {/if}
                  </article>
                  <article class:chosen={conflict.resolution === 'incoming'}>
                    <div class="side-head"><b>同事版</b><Button size="small" kind={conflict.resolution === 'incoming' ? 'primary' : 'tertiary'} on:click={() => setConflictResolution(conflict.activityId, 'incoming')}>{conflict.resolution === 'incoming' ? '已选定' : '选这版'}</Button></div>
                    {#if conflict.incomingActivity}
                      <div class="side-fields">
                        {#each conflict.changedFields as field}
                          <div class:changed={isSideChanged(conflict, 'incoming', field)}>
                            <span>{fieldLabel(field)}</span><p>{fieldValue(conflict.incomingActivity, field)}</p>
                          </div>
                        {/each}
                      </div>
                    {:else}
                      <p class="empty-state">同事已删除该活动（选这版表示确认删除）。</p>
                    {/if}
                  </article>
                  {#if conflict.fieldSuggestion && conflict.resolution === 'merged'}
                    <article class="chosen merged-side">
                      <div class="side-head"><b>字段拼合版</b><Tag type="green">将采用</Tag></div>
                      <div class="side-fields">
                        {#each conflict.changedFields as field}
                          <div class="changed"><span>{fieldLabel(field)}</span><p>{fieldValue(conflict.mergedActivity ?? null, field)}</p></div>
                        {/each}
                      </div>
                    </article>
                  {/if}
                </div>
                {#if conflict.fieldSuggestion && conflict.resolution !== 'merged'}
                  <Button size="small" kind="ghost" on:click={() => setConflictResolution(conflict.activityId, 'merged')}>改用字段拼合（各取两边改动的字段，依赖仍取并集）</Button>
                {/if}
              </Tile>
            {/each}
          </div>
        </section>
      {/if}

      {#if pendingItems.length}
        <Tile class="pending-card">
          <div class="section-title"><div><span class="kicker">PENDING</span><h3>待处理的课程包（{pendingItems.length}）</h3><p>合并未完成或提交失败后仍保留在这里，随时可以继续处理，不会丢失。</p></div></div>
          {#each pendingItems as item}
            <div class="pending-row">
              <div>
                <b>{item.review.packageData.sender} · 来源“{item.review.packageData.baseVersionLabel}”（r{item.review.packageData.baseRevision}）</b>
                <p>{item.review.conflicts.filter((c) => c.resolution === null).length} 个冲突未选定 · {item.review.autoChanges.length} 项自动并入 · 导入于 {formatTime(item.createdAt)}</p>
              </div>
              <div class="package-buttons">
                <Button size="small" kind={activePendingId === item.id ? 'primary' : 'tertiary'} on:click={() => openPending(item)}>{activePendingId === item.id ? '评审中' : '继续处理'}</Button>
                <Button size="small" kind="ghost" on:click={() => discardPending(item)}>移除</Button>
              </div>
            </div>
          {/each}
        </Tile>
      {/if}

      {#if stashedDrafts.length}
        <Tile class="pending-card stash">
          <div class="section-title"><div><span class="kicker">STASHED DRAFTS</span><h3>旧版本草稿（{stashedDrafts.length}）</h3><p>这些草稿基于已被先提交取代的旧版本，载入后不会自动覆盖当前课程，请对照后重新提交。</p></div></div>
          {#each stashedDrafts as draft}
            <div class="pending-row">
              <div>
                <b>草稿 r{draft.baseRevision} → 远端 r{draft.remoteRevision}</b>
                <p>{draft.note}{draft.pendingItemId ? '（关联一个待处理合并）' : ''}</p>
              </div>
              <div class="package-buttons">
                <Button size="small" kind="tertiary" on:click={() => restoreDraft(draft)}>载入草稿</Button>
                <Button size="small" kind="ghost" on:click={() => discardDraft(draft)}>删除</Button>
              </div>
            </div>
          {/each}
        </Tile>
      {/if}

      <div class="version-layout-svelte">
        <Tile class="version-timeline">
          <div class="section-title"><div><span class="kicker">TIMELINE</span><h3>课程版本</h3></div><Tag type="cool-gray">{course.versions.length} 个快照</Tag></div>
          {#each course.versions as version, index (version.id)}
            <article class:latest={index === course.versions.length - 1}>
              <span class="timeline-dot"></span>
              <div><b>{version.label}</b><h4>{version.note}</h4><p>{formatTime(version.savedAt)} · {version.activities.length} 个活动</p></div>
            </article>
          {/each}
        </Tile>
        <Tile class="diff-card">
          <div class="section-title"><div><span class="kicker">COMPARE</span><h3>比较两个版本</h3></div></div>
          <div class="compare-pickers">
            <Select labelText="基准版本" selected={compareBaseId} on:change={(event) => (compareBaseId = readText(event))}>
              {#each course.versions as version}<SelectItem value={version.id} text={`${version.label} · ${formatTime(version.savedAt)}`} />{/each}
            </Select>
            <Select labelText="目标版本" selected={compareTargetId} on:change={(event) => (compareTargetId = readText(event))}>
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

      {#if invalidations.length}
        <Tile class="invalidation-log">
          <div class="section-title">
            <div><span class="kicker">RECALCULATION LOG</span><h3>失效重算记录</h3><p>活动、依赖或版本变化后，受影响的下游活动和音素检查立即失效并按新状态重算。</p></div>
            <Button size="small" kind="ghost" on:click={clearInvalidationLog}>清空记录</Button>
          </div>
          {#each invalidations.slice(0, 8) as item}
            <div class="invalidation-row">
              <b>{item.title}</b>
              <p>{item.reason}</p>
              <div class="invalidation-tags">{#each item.invalidatedChecks as check}<Tag type="blue" size="sm">{check}</Tag>{/each}</div>
              <small>{formatTime(item.at)}</small>
            </div>
          {/each}
        </Tile>
      {/if}
    </main>
  {/if}

  <footer class="app-footer">
    <span>所有数据保存在当前浏览器 localStorage · 乐观锁防止两个标签页互相覆盖</span>
    <span>Ctrl/Cmd + Z 撤销 · Ctrl/Cmd + Y 重做 · Alt + N 新建活动 · Ctrl/Cmd + S 保存</span>
  </footer>
</div>

