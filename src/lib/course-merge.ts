import type { Activity, Course, CourseMeta, CourseVersion } from './types';

/** 课程包：同事带走的不只是活动，还有来源版本和每个活动的快照。 */
export interface CoursePackage {
  format: 'phonics-course-package';
  packageVersion: 1;
  courseId: string;
  courseTitle: string;
  /** 打包时基于的版本快照 id（三向合并的 base）。 */
  baseVersionId: string;
  baseSavedAt: string;
  exportedAt: string;
  exportedBy: string;
  note: string;
  /** 来源版本的完整活动快照。 */
  baseActivities: Activity[];
  baseMeta: CourseMeta;
  /** 带走后在包内补充的最新活动快照。 */
  activities: Activity[];
  meta: CourseMeta;
  /** 打包时课程的提交版本号，用于多标签页并发判断。 */
  revision: number;
}

export type ConflictSide = 'local' | 'incoming' | 'drop';
export type MergeStatus = 'auto' | 'conflict' | 'identical';

export interface ActivityConflict {
  activityId: string;
  title: string;
  fields: string[];
  local: Activity | null;
  incoming: Activity | null;
  /** 当前选定的版本；null 表示尚未选定，在选定前不会写入当前课程。 */
  resolution: ConflictSide | null;
}

export interface MergePreview {
  pkg: CoursePackage;
  baseActivities: Map<string, Activity>;
  localActivities: Map<string, Activity>;
  incomingActivities: Map<string, Activity>;
  merged: Activity[];
  conflicts: ActivityConflict[];
  /** 自动并入的活动 id（单边新增）。 */
  addedLocal: string[];
  addedIncoming: string[];
  /** 顺序变化（相对来源快照）。 */
  reordered: string[];
  /** 说明（prompt / accessibility / feedback）或内容字段发生变化的活动 id。 */
  notesChanged: string[];
  /** 依赖发生变化的活动 id。 */
  depsChanged: string[];
  metaChanged: (keyof CourseMeta)[];
  status: MergeStatus;
  /** 合并后仍指向不存在活动的依赖（两边新增活动 id 撞车时可能出现）。 */
  danglingDependencies: Array<{ activityId: string; missingId: string }>;
  reasons: string[];
}

export const ACTIVITY_FIELDS: Array<{ key: keyof Activity; label: string }> = [
  { key: 'type', label: '类型' },
  { key: 'title', label: '标题' },
  { key: 'content', label: '内容' },
  { key: 'phonemes', label: '音素' },
  { key: 'dependencies', label: '依赖' },
  { key: 'difficulty', label: '难度' },
  { key: 'duration', label: '时长' },
  { key: 'prompt', label: '教师提示' },
  { key: 'accessibility', label: '无障碍说明' },
  { key: 'feedback', label: '练习反馈' }
];

export const NOTE_FIELDS: Array<keyof Activity> = ['prompt', 'accessibility', 'feedback'];

export function cloneActivities(activities: Activity[]): Activity[] {
  return activities.map((activity) => ({ ...activity, phonemes: [...activity.phonemes], dependencies: [...activity.dependencies] }));
}

export function findBaseVersion(course: Course, pkg: CoursePackage): CourseVersion | undefined {
  return course.versions.find((version) => version.id === pkg.baseVersionId);
}

/** 导出课程包：以指定存档版本为来源快照，外加当前活动。 */
export function exportCoursePackage(course: Course, options: { exportedBy: string; note: string; baseVersionId?: string }): CoursePackage {
  const base = course.versions.find((version) => version.id === options.baseVersionId)
    ?? course.versions.at(-1);
  const meta = { title: course.title, level: course.level, ageRange: course.ageRange, objective: course.objective };
  const baseMeta = base?.meta ? { ...base.meta } : { ...meta };
  return {
    format: 'phonics-course-package',
    packageVersion: 1,
    courseId: course.id,
    courseTitle: course.title,
    baseVersionId: base?.id ?? '',
    baseSavedAt: base?.savedAt ?? new Date().toISOString(),
    exportedAt: new Date().toISOString(),
    exportedBy: options.exportedBy || '未署名老师',
    note: options.note,
    baseActivities: base ? cloneActivities(base.activities) : [],
    baseMeta,
    activities: cloneActivities(course.activities),
    meta: { ...meta },
    revision: course.revision
  };
}

export function parseCoursePackage(text: string): CoursePackage {
  const data = JSON.parse(text) as Partial<CoursePackage>;
  if (data?.format !== 'phonics-course-package' || !Array.isArray(data.activities) || !Array.isArray(data.baseActivities)) {
    throw new Error('文件不是有效的课程包（缺少来源版本或活动快照）。');
  }
  return data as CoursePackage;
}

function sameActivity(a: Activity | undefined, b: Activity | undefined): boolean {
  if (!a || !b) return false;
  return ACTIVITY_FIELDS.every(({ key }) => JSON.stringify(a[key]) === JSON.stringify(b[key]));
}

function changedFields(base: Activity | undefined, current: Activity): string[] {
  if (!base) return [];
  return ACTIVITY_FIELDS.filter(({ key }) => JSON.stringify(base[key]) !== JSON.stringify(current[key])).map(({ label }) => label);
}

/** 依赖并集：同一活动两边各加的前置都保留，一个都不能丢。 */
function mergeDependencies(base: string[] | undefined, local: string[], incoming: string[]): string[] {
  return [...new Set([...(base ?? []), ...local, ...incoming])];
}

/**
 * 顺序融合：以来源快照为共同基准，按“本地相对基准的位移”投影外来活动，
 * 再把双方单边新增的活动追加到双方都认识的锚点之后。
 */
function mergeOrder(base: Activity[], local: Activity[], incoming: Activity[], mergedIds: Set<string>): string[] {
  const baseIds = base.map((a) => a.id).filter((id) => mergedIds.has(id));
  const localIds = local.map((a) => a.id);
  const incomingIds = incoming.map((a) => a.id);
  const localSet = new Set(localIds);
  const incomingSet = new Set(incomingIds);

  // 记录外来活动相对锚点的偏移：anchor 为 null 表示应放在最前。
  const incomingInserts = new Map<string, { anchor: string | null; offset: number }>();
  incomingIds.forEach((id, index) => {
    if (mergedIds.has(id) && !baseIds.includes(id)) return; // 外来单边新增稍后处理
    let anchor: string | null = null;
    for (let i = index - 1; i >= 0; i--) {
      if (baseIds.includes(incomingIds[i])) { anchor = incomingIds[i]; break; }
    }
    incomingInserts.set(id, { anchor, offset: index - (anchor ? incomingIds.indexOf(anchor) : -1) });
  });

  // 以本地顺序为主线，把外来移动过的共同活动按其在外来序列中的锚点插入。
  const result: string[] = [];
  const placed = new Set<string>();
  const placeBefore = (id: string) => {
    if (placed.has(id) || !mergedIds.has(id)) return;
    const info = incomingInserts.get(id);
    // 若外来序列中该活动紧贴在某个共同锚点之后，而本地把它排到别处，则采用外来位置。
    if (info && info.offset === 1) {
      result.push(id);
      placed.add(id);
    }
  };

  for (const id of localIds) {
    if (!mergedIds.has(id)) continue;
    // 在放下本地活动前，先放入外来序列中锚定到“上一个已放置活动”之后的共同活动。
    const anchor = result[result.length - 1] ?? null;
    for (const [incomingId, info] of incomingInserts) {
      if (info.anchor === anchor && !placed.has(incomingId) && incomingId !== id) {
        // 仅当该活动在本地存在但位置更靠后（外来顺序变化）时提前插入。
        if (localIds.includes(incomingId) && localIds.indexOf(incomingId) > localIds.indexOf(id)) {
          result.push(incomingId);
          placed.add(incomingId);
        }
      }
    }
    placeBefore(id);
    if (!placed.has(id)) { result.push(id); placed.add(id); }
  }

  // 外来单边新增的活动：放到各自锚点之后，锚点缺失时追加到末尾。
  for (const id of incomingIds) {
    if (placed.has(id) || !mergedIds.has(id)) continue;
    const info = incomingInserts.get(id);
    if (info?.anchor) {
      const anchorIndex = result.indexOf(info.anchor);
      if (anchorIndex >= 0) { result.splice(anchorIndex + 1, 0, id); placed.add(id); continue; }
    }
    result.push(id);
    placed.add(id);
  }
  // 本地单边新增且未放置（理论上上面已覆盖），兜底追加。
  for (const id of localIds) {
    if (!placed.has(id) && mergedIds.has(id)) { result.push(id); placed.add(id); }
  }
  return result;
}

/** 三向合并预演：不修改当前课程，只产出合并方案和冲突清单。 */
export function previewMerge(course: Course, pkg: CoursePackage, baseOverride?: Activity[]): MergePreview {
  const storedBase = findBaseVersion(course, pkg);
  const baseList = baseOverride ?? storedBase?.activities ?? pkg.baseActivities;
  const baseActivities = new Map(baseList.map((a) => [a.id, a]));
  const localActivities = new Map(course.activities.map((a) => [a.id, a]));
  const incomingActivities = new Map(pkg.activities.map((a) => [a.id, a]));

  const conflicts: ActivityConflict[] = [];
  const mergedById = new Map<string, Activity>();
  const addedLocal: string[] = [];
  const addedIncoming: string[] = [];
  const notesChanged: string[] = [];
  const depsChanged: string[] = [];
  const reasons: string[] = [];

  const allIds = new Set<string>([...localActivities.keys(), ...incomingActivities.keys()]);

  for (const id of allIds) {
    const base = baseActivities.get(id);
    const local = localActivities.get(id);
    const incoming = incomingActivities.get(id);

    if (local && !incoming) {
      // 单边删除（外来删、本地留）时保留本地，避免丢掉任一侧的工作。
      if (base) reasons.push(`「${local.title}」仅本地保留（来源版本存在、课程包已删除），予以保留。`);
      else { addedLocal.push(id); reasons.push(`「${local.title}」是本地单边新增，直接并入。`); }
      mergedById.set(id, cloneActivity(local));
      continue;
    }
    if (!local && incoming) {
      if (base) {
        // 本地删除、外来修改：不能擅自丢掉任一版，先作为待决冲突并列保留。
        mergedById.set(id, cloneActivity(incoming));
        conflicts.push({ activityId: id, title: incoming.title, fields: ['本地已删除 / 课程包已修改'], local: null, incoming: cloneActivity(incoming), resolution: null });
      } else {
        addedIncoming.push(id);
        reasons.push(`「${incoming.title}」是课程包单边新增，直接并入。`);
        mergedById.set(id, cloneActivity(incoming));
      }
      continue;
    }
    if (!local || !incoming) continue;

    if (sameActivity(local, incoming)) {
      mergedById.set(id, cloneActivity(local));
      continue;
    }
    if (!base) {
      // 两边都有但来源快照没有（id 撞车的各自新增）：按冲突并列处理。
      const collision = cloneActivity(local);
      collision.dependencies = mergeDependencies(undefined, local.dependencies, incoming.dependencies);
      mergedById.set(id, collision);
      conflicts.push({ activityId: id, title: local.title, fields: ACTIVITY_FIELDS.map((f) => f.label), local: cloneActivity(local), incoming: cloneActivity(incoming), resolution: null });
      continue;
    }

    const localChanged = new Set(changedFields(base, local));
    const incomingChanged = new Set(changedFields(base, incoming));
    const bothChanged = [...localChanged].filter((field) => incomingChanged.has(field));
    const onlyIncoming = [...incomingChanged].filter((field) => !localChanged.has(field));

    let pick: Activity = cloneActivity(local);
    let hadConflict = false;

    if (bothChanged.length > 0 && !bothChanged.every((field) => {
      const key = ACTIVITY_FIELDS.find((f) => f.label === field)!.key;
      return JSON.stringify(local[key]) === JSON.stringify(incoming[key]);
    })) {
      // 同一字段两边都改且取值不同：并列保留，等老师选定，选定前不写入。
      conflicts.push({
        activityId: id,
        title: local.title,
        fields: bothChanged,
        local: cloneActivity(local),
        incoming: cloneActivity(incoming),
        resolution: null
      });
      hadConflict = true;
    } else {
      // 只有一边改的字段直接采用改动侧；两边改成相同值自然一致。
      for (const { key, label } of ACTIVITY_FIELDS) {
        if (key === 'dependencies') continue; // 依赖单独做并集
        if (localChanged.has(label) && incomingChanged.has(label)) continue;
        if (onlyIncoming.includes(label)) (pick as unknown as Record<string, unknown>)[key] = structuredClone(incoming[key]);
      }
      if ([...localChanged, ...incomingChanged].some((label) => NOTE_FIELDS.includes(ACTIVITY_FIELDS.find((f) => f.label === label)!.key))) {
        notesChanged.push(id);
      }
    }

    // 依赖：无论是否冲突都先算并集，冲突选定版本后仍以并集为准，不丢任一版依赖。
    const unionDeps = mergeDependencies(base.dependencies, local.dependencies, incoming.dependencies);
    pick.dependencies = unionDeps;
    if (JSON.stringify([...base.dependencies].sort()) !== JSON.stringify([...unionDeps].sort())) depsChanged.push(id);

    if (!hadConflict && (localChanged.has('依赖') || incomingChanged.has('依赖'))) {
      reasons.push(`「${local.title}」的依赖按两边并集合并：${unionDeps.length ? unionDeps.join('、') : '无依赖'}。`);
    }
    mergedById.set(id, pick);
  }

  const mergedIds = new Set(mergedById.keys());
  const orderedIds = mergeOrder(baseList, course.activities, pkg.activities, mergedIds);
  const merged = orderedIds.map((id) => mergedById.get(id)!).filter(Boolean);

  // 顺序变化：与来源快照相比，共同活动的相对顺序发生了变化。
  const baseOrder = baseList.map((a) => a.id);
  const commonInMerged = merged.map((a) => a.id).filter((id) => baseOrder.includes(id));
  const baseCommon = baseOrder.filter((id) => mergedIds.has(id));
  const reordered: string[] = [];
  for (let i = 0; i < commonInMerged.length; i++) {
    const id = commonInMerged[i];
    const prevMerged = commonInMerged[i - 1];
    const baseIndex = baseCommon.indexOf(id);
    const prevBase = prevMerged ? baseCommon.indexOf(prevMerged) : -1;
    if (baseIndex >= 0 && prevBase >= 0 && baseIndex < prevBase) reordered.push(id);
  }

  // 课程信息：单边变化直接并入；两边都变且不同则提示冲突（课程级冲突并入 reasons，不阻断活动合并）。
  const metaChanged: (keyof CourseMeta)[] = [];
  const metaKeys: Array<keyof CourseMeta> = ['title', 'level', 'ageRange', 'objective'];
  for (const key of metaKeys) {
    const localValue = course[key];
    const incomingValue = pkg.meta[key];
    const baseValue = pkg.baseMeta[key];
    if (localValue === incomingValue) continue;
    if (localValue === baseValue && incomingValue !== baseValue) {
      metaChanged.push(key);
      reasons.push(`课程${metaLabel(key)}单边采用课程包内容。`);
    } else if (incomingValue === baseValue && localValue !== baseValue) {
      metaChanged.push(key);
      reasons.push(`课程${metaLabel(key)}保持本地修改。`);
    } else if (localValue !== incomingValue) {
      metaChanged.push(key);
      reasons.push(`课程${metaLabel(key)}两边都做了修改，当前保留本地版本，可在合并后手动调整。`);
    }
  }

  const danglingDependencies: Array<{ activityId: string; missingId: string }> = [];
  for (const activity of merged) {
    for (const dep of activity.dependencies) {
      if (!mergedIds.has(dep)) danglingDependencies.push({ activityId: activity.id, missingId: dep });
    }
  }

  const status: MergeStatus = conflicts.length ? 'conflict' : merged.some((a, i) => !sameActivity(a, course.activities[i])) || metaChanged.length || addedIncoming.length || addedLocal.length ? 'auto' : 'identical';

  return {
    pkg,
    baseActivities,
    localActivities,
    incomingActivities,
    merged,
    conflicts,
    addedLocal,
    addedIncoming,
    reordered,
    notesChanged,
    depsChanged,
    metaChanged,
    status,
    danglingDependencies,
    reasons
  };
}

function metaLabel(key: keyof CourseMeta): string {
  return key === 'title' ? '名称' : key === 'level' ? '等级' : key === 'ageRange' ? '适用年龄' : '学习目标';
}

function cloneActivity(activity: Activity): Activity {
  return { ...activity, phonemes: [...activity.phonemes], dependencies: [...activity.dependencies] };
}

/** 全部冲突均已选定时，生成最终活动列表；并列的两版按选定结果落为一版。 */
export function resolvePreview(preview: MergePreview): Activity[] {
  const dropped = new Set(preview.conflicts.filter((conflict) => conflict.resolution === 'drop').map((conflict) => conflict.activityId));
  return preview.merged
    .filter((activity) => !dropped.has(activity.id))
    .map((activity) => {
      const conflict = preview.conflicts.find((item) => item.activityId === activity.id);
      const side = conflict?.resolution;
      if (!side || side === 'drop' || !conflict) return activity; // 未选定的占位保留，调用方应阻止写入
      const source = side === 'local' ? conflict.local : conflict.incoming;
      if (!source) return activity;
      const winner = cloneActivity(source);
      // 依赖仍然使用并集：选定字段版本不等于放弃另一侧补充的依赖。
      winner.dependencies = [...activity.dependencies];
      return winner;
    });
}

export function unresolvedConflicts(preview: MergePreview): ActivityConflict[] {
  return preview.conflicts.filter((conflict) => conflict.resolution === null);
}

/** 合并课程信息：单边修改采用修改侧，双边不同保持本地。 */
export function mergeMeta(course: Course, pkg: CoursePackage): CourseMeta {
  const meta: CourseMeta = { title: course.title, level: course.level, ageRange: course.ageRange, objective: course.objective };
  for (const key of ['title', 'level', 'ageRange', 'objective'] as Array<keyof CourseMeta>) {
    if (course[key] === pkg.baseMeta[key] && pkg.meta[key] !== pkg.baseMeta[key]) meta[key] = pkg.meta[key];
  }
  return meta;
}
