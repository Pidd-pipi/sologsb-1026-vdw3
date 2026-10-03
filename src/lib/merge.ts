// 课程包三方合并。
//
// 共同祖先 = 包内带来源版本活动快照（base）；
// 本地 = 当前课程活动（local）；对方 = 包内改后的活动（incoming）。
//
// 规则：
// - 单边新增直接并入；单边删除直接删除（两边都删也删除）。
// - 顺序或说明（标题/内容/提示等）只有一边变化时直接并入。
// - 同一活动两边都改动（或一边删一边改）时产生冲突，两个版本并列保留，
//   老师未选定前不写入当前课程。
// - 依赖按并集保留，绝不丢掉任一版依赖；悬空依赖保留并交给质量检查。

import type {
  Activity,
  ActivityFieldKey,
  AutoChange,
  ConflictKind,
  CoursePackage,
  MergeConflict,
  MergeResult
} from './types';

export const ACTIVITY_FIELDS: ActivityFieldKey[] = [
  'type',
  'title',
  'content',
  'phonemes',
  'dependencies',
  'difficulty',
  'prompt',
  'accessibility',
  'duration',
  'feedback'
];

const FIELD_LABELS: Record<ActivityFieldKey, string> = {
  type: '类型',
  title: '标题',
  content: '内容',
  phonemes: '音素',
  dependencies: '依赖',
  difficulty: '难度',
  prompt: '教学提示',
  accessibility: '无障碍说明',
  duration: '时长',
  feedback: '练习反馈'
};

export function fieldLabel(field: ActivityFieldKey): string {
  return FIELD_LABELS[field];
}

function byId(activities: Activity[]): Map<string, Activity> {
  return new Map(activities.map((activity) => [activity.id, activity]));
}

/** 浅比较字段；数组字段按集合比较（音素、依赖顺序无关，依赖顺序由课程顺序决定）。 */
export function fieldEqual(activity: Activity, other: Activity, field: ActivityFieldKey): boolean {
  const left = activity[field];
  const right = other[field];
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((value) => right.includes(value));
  }
  return left === right;
}

export function changedFields(before: Activity, after: Activity): ActivityFieldKey[] {
  return ACTIVITY_FIELDS.filter((field) => !fieldEqual(before, after, field));
}

function cloneActivity(activity: Activity): Activity {
  return { ...activity, phonemes: [...activity.phonemes], dependencies: [...activity.dependencies] };
}

/**
 * 计算合并后的活动顺序。
 * 以本地顺序为主干，把对方新增的活动按对方相对位置插入；
 * 两边各自重排时，只要不矛盾就同时保留（用稳定的拓扑式穿插）。
 */
function mergeOrder(base: Activity[], local: Activity[], incoming: Activity[]): string[] {
  const baseIds = base.map((activity) => activity.id);
  const localIds = local.map((activity) => activity.id);
  const incomingIds = incoming.map((activity) => activity.id);
  const localSet = new Set(localIds);
  const commonBase = baseIds.filter((id) => localSet.has(id) && incomingIds.includes(id));

  // 对方单边新增的活动，挂在它在 incoming 中最近的“本地已有”活动之后；
  // 找不到锚点（新增序列在最前面）时放到开头，多个新增保持 incoming 中的相对次序。
  const anchored: Array<{ id: string; after: string | null }> = [];
  for (let position = 0; position < incomingIds.length; position += 1) {
    const id = incomingIds[position];
    if (localSet.has(id)) continue;
    let anchor: string | null = null;
    for (let cursor = position - 1; cursor >= 0; cursor -= 1) {
      if (localSet.has(incomingIds[cursor])) {
        anchor = incomingIds[cursor];
        break;
      }
    }
    anchored.push({ id, after: anchor });
  }

  const merged = [...localIds];
  for (const { id, after } of anchored) {
    if (after === null) {
      // 找不到锚点（对方新增在最前面），放到开头并保持 incoming 中的相对次序。
      merged.unshift(id);
    } else {
      const anchorIndex = merged.indexOf(after);
      merged.splice(anchorIndex + 1, 0, id);
    }
  }

  // 两边都对共有活动重排时以本地顺序为准；本地保持祖先顺序而对方重排时采用对方顺序。
  if (!sameRelativeOrder(commonBase, merged)) {
    // 本地主动重排过，尊重本地顺序（已在 merged 中）。
    return merged;
  }

  // 本地未重排：若对方重排了共有活动，按对方顺序重排，单边新增活动仍保留在末尾。
  if (!sameRelativeOrder(commonBase, incomingIds)) {
    const incomingRank = new Map(incomingIds.map((id, index) => [id, index]));
    return merged.sort((left, right) => {
      const leftRank = incomingRank.get(left);
      const rightRank = incomingRank.get(right);
      if (leftRank === undefined) return 1; // 本地单边新增留在靠后
      if (rightRank === undefined) return -1;
      return leftRank - rightRank;
    });
  }

  return merged;
}

/**
 * 三方合并入口。返回的 activities 在存在未解决冲突时不包含冲突活动的最终值——
 * 冲突活动先按本地版本占位（并列的两版放在 conflicts 中），由调用方决定何时落库。
 */
export function mergeCourses(
  base: Activity[],
  local: Activity[],
  incoming: Activity[]
): MergeResult {
  const baseMap = byId(base);
  const localMap = byId(local);
  const incomingMap = byId(incoming);
  const all = new Set<string>([...baseMap.keys(), ...localMap.keys(), ...incomingMap.keys()]);

  const autoChanges: AutoChange[] = [];
  const conflicts: MergeConflict[] = [];
  // 解决后的活动值（未解决冲突先不放），以及需要占位的冲突 id。
  const resolved = new Map<string, Activity>();
  const conflictIds = new Set<string>();
  const dangling: Array<{ activityId: string; dependencyId: string }> = [];

  for (const id of all) {
    const baseActivity = baseMap.get(id) ?? null;
    const localActivity = localMap.get(id) ?? null;
    const incomingActivity = incomingMap.get(id) ?? null;

    // 新增（祖先中不存在）。
    if (!baseActivity) {
      if (localActivity && incomingActivity) {
        // 两边各自新建了同 id 活动（时间戳撞车的极端情况）：按双方修改处理。
        const fields = ACTIVITY_FIELDS.filter(
          (field) => !fieldEqual(localActivity, incomingActivity, field)
        );
        if (fields.length === 0) {
          resolved.set(id, cloneActivity(localActivity));
        } else {
          conflictIds.add(id);
          conflicts.push(buildConflict(id, localActivity, incomingActivity, fields, 'both-modified'));
        }
        continue;
      }
      if (localActivity) {
        resolved.set(id, cloneActivity(localActivity));
        autoChanges.push({
          kind: 'added-local',
          activityId: id,
          title: localActivity.title,
          detail: `本地新增${localActivity.type}活动（${localActivity.duration} 分钟），保留。`
        });
        continue;
      }
      if (incomingActivity) {
        resolved.set(id, cloneActivity(incomingActivity));
        autoChanges.push({
          kind: 'added-incoming',
          activityId: id,
          title: incomingActivity.title,
          detail: `同事新增${incomingActivity.type}活动（${incomingActivity.duration} 分钟），直接并入。`
        });
        continue;
      }
    }

    // 删除情形。
    const localDeleted = !localActivity;
    const incomingDeleted = !incomingActivity;
    if (localDeleted || incomingDeleted) {
      if (localDeleted && incomingDeleted) {
        // 两边都删，确认删除，不产生变化说明。
        continue;
      }
      const surviving = localActivity ?? incomingActivity;
      const changedOnOtherSide = surviving
        ? changedFields(baseActivity as Activity, surviving)
        : [];
      if (changedOnOtherSide.length > 0) {
        // 一边删除、一边修改：冲突，两版并列保留（删除也是一种可选版本）。
        conflictIds.add(id);
        conflicts.push({
          activityId: id,
          title: baseActivity?.title ?? surviving?.title ?? id,
          kind: 'delete-vs-modify',
          fieldSuggestion: false,
          changedFields: changedOnOtherSide,
          localActivity: localActivity ? cloneActivity(localActivity) : null,
          incomingActivity: incomingActivity ? cloneActivity(incomingActivity) : null,
          resolution: null
        });
      } else {
        // 单边删除，另一边没动：直接删除。
        autoChanges.push({
          kind: 'deleted',
          activityId: id,
          title: baseActivity?.title ?? id,
          detail: localDeleted
            ? '本地删除了该活动，同事未改动，按删除并入。'
            : '同事删除了该活动，本地未改动，直接删除。'
        });
      }
      continue;
    }

    // 三方都在：比较各自相对祖先的改动。
    const localChanged = changedFields(baseActivity as Activity, localActivity);
    const incomingChanged = changedFields(baseActivity as Activity, incomingActivity);

    if (localChanged.length === 0 && incomingChanged.length === 0) {
      resolved.set(id, cloneActivity(localActivity));
      continue;
    }
    if (incomingChanged.length === 0) {
      // 只有本地改：保留本地。
      resolved.set(id, cloneActivity(localActivity));
      continue;
    }
    if (localChanged.length === 0) {
      // 只有对方改：直接并入对方版本。
      resolved.set(id, cloneActivity(incomingActivity));
      pushSideChange(autoChanges, incomingChanged, id, incomingActivity.title, 'incoming');
      continue;
    }

    // 两边都改了：冲突，并列保留，等老师选择。
    conflictIds.add(id);
    const allChanged = new Set<ActivityFieldKey>([...localChanged, ...incomingChanged]);
    conflicts.push(
      buildConflict(
        id,
        localActivity,
        incomingActivity,
        [...allChanged],
        'both-modified',
        baseActivity
      )
    );
  }

  // 顺序说明。
  const baseOrder = base.map((activity) => activity.id);
  const localOrder = local.map((activity) => activity.id);
  const incomingOrder = incoming.map((activity) => activity.id);
  const commonBase = baseOrder.filter((id) => localMap.has(id) && incomingMap.has(id));
  const localReordered = !sameRelativeOrder(commonBase, localOrder);
  const incomingReordered = !sameRelativeOrder(commonBase, incomingOrder);
  let orderNote = '';
  if (incomingReordered && !localReordered) {
    orderNote = '同事调整了活动顺序，本地顺序未变，已按同事版本重排。';
    autoChanges.push({
      kind: 'order',
      activityId: '',
      title: '活动顺序',
      detail: orderNote
    });
  } else if (localReordered && !incomingReordered) {
    orderNote = '本地调整了活动顺序，同事未改，保留本地顺序。';
  } else if (localReordered && incomingReordered) {
    orderNote = '两边都调整了顺序，已保留本地顺序，请人工核对同事的顺序意图。';
    autoChanges.push({
      kind: 'order',
      activityId: '',
      title: '活动顺序',
      detail: orderNote
    });
  }

  const mergedOrder = mergeOrder(base, local, incoming);

  // 组装最终活动。
  // 未解决冲突：先用本地版本占位（若本地已删则用对方版本占位），保证两边内容都不丢——
  // 但调用方在全部冲突解决前不得把结果写回当前课程。
  const activities: Activity[] = [];
  for (const id of mergedOrder) {
    if (resolved.has(id)) {
      activities.push(cloneActivity(resolved.get(id) as Activity));
      continue;
    }
    if (conflictIds.has(id)) {
      const conflict = conflicts.find((item) => item.activityId === id);
      const placeholder = conflict?.localActivity
        ? cloneActivity(conflict.localActivity)
        : cloneActivity(conflict?.incomingActivity as Activity);
      activities.push(placeholder);
    }
  }

  // 依赖并集：对每个已解决活动，合并两边相对祖先新增的依赖，绝不丢弃。
  const finalActivities = activities.map((activity) => {
    if (conflictIds.has(activity.id)) return activity; // 冲突活动等选定后再合并依赖
    return unionDependencies(activity.id, baseMap, localMap, incomingMap, activity);
  });

  // 悬空依赖检查。
  const finalIds = new Set(finalActivities.map((activity) => activity.id));
  for (const activity of finalActivities) {
    for (const dependency of activity.dependencies) {
      if (!finalIds.has(dependency)) {
        dangling.push({ activityId: activity.id, dependencyId: dependency });
      }
    }
  }

  return {
    activities: finalActivities,
    autoChanges,
    conflicts,
    orderNote,
    danglingDependencies: dedupeDangling(dangling)
  };
}

/** 依赖 id 的三方并集：保留祖先依赖 ∪ 本地新增 ∪ 对方新增，两边删掉同一依赖才删除。 */
function unionDependencyIds(
  id: string,
  baseMap: Map<string, Activity>,
  localMap: Map<string, Activity>,
  incomingMap: Map<string, Activity>
): string[] | null {
  const baseActivity = baseMap.get(id);
  const localActivity = localMap.get(id);
  const incomingActivity = incomingMap.get(id);
  if (!localActivity || !incomingActivity) return null;
  if (!baseActivity) {
    return [...new Set([...localActivity.dependencies, ...incomingActivity.dependencies])];
  }
  const baseDeps = new Set(baseActivity.dependencies);
  const localDeps = new Set(localActivity.dependencies);
  const incomingDeps = new Set(incomingActivity.dependencies);
  const deps = new Set<string>();
  for (const dependency of new Set([...baseDeps, ...localDeps, ...incomingDeps])) {
    const removedByLocal = baseDeps.has(dependency) && !localDeps.has(dependency);
    const removedByIncoming = baseDeps.has(dependency) && !incomingDeps.has(dependency);
    if (removedByLocal && removedByIncoming) continue; // 两边都删才真正删除
    deps.add(dependency);
  }
  return [...deps];
}

/** 依赖三方合并：以 winner 为字段载体，依赖取两边并集，绝不丢掉任一版依赖。 */
function unionDependencies(
  id: string,
  baseMap: Map<string, Activity>,
  localMap: Map<string, Activity>,
  incomingMap: Map<string, Activity>,
  winner?: Activity
): Activity {
  const localActivity = localMap.get(id);
  const incomingActivity = incomingMap.get(id);
  const chosen = winner ?? localActivity ?? incomingActivity;
  if (!chosen) throw new Error(`unionDependencies: 活动 ${id} 不存在`);
  const union = unionDependencyIds(id, baseMap, localMap, incomingMap);
  const dependencies = union ?? [...new Set(chosen.dependencies)];
  return { ...cloneActivity(chosen), dependencies };
}

/** 字段级拼合：对方改动过的字段取对方，其余取本地（仅在两边改动字段不重叠时无歧义）。 */
export function buildFieldMergedActivity(conflict: MergeConflict, base: Activity[]): Activity | null {
  if (!conflict.localActivity || !conflict.incomingActivity) return null;
  const baseActivity = byId(base).get(conflict.activityId);
  const localChanges = baseActivity ? changedFields(baseActivity, conflict.localActivity) : conflict.changedFields;
  const merged = cloneActivity(conflict.localActivity);
  for (const field of ACTIVITY_FIELDS) {
    const incomingChangedHere = baseActivity
      ? !fieldEqual(baseActivity, conflict.incomingActivity, field)
      : conflict.changedFields.includes(field);
    if (incomingChangedHere && !localChanges.includes(field)) {
      (merged as unknown as Record<ActivityFieldKey, unknown>)[field] =
        (conflict.incomingActivity as unknown as Record<ActivityFieldKey, unknown>)[field];
      if (field === 'phonemes' || field === 'dependencies') {
        (merged as unknown as Record<string, string[]>)[field] = [
          ...(conflict.incomingActivity[field] as string[])
        ];
      }
    }
  }
  return merged;
}

export function conflictWantsDelete(conflict: MergeConflict): boolean {
  if (conflict.kind !== 'delete-vs-modify') return false;
  if (conflict.resolution === 'local') return conflict.localActivity === null;
  if (conflict.resolution === 'incoming') return conflict.incomingActivity === null;
  return false;
}

function chosenActivity(conflict: MergeConflict): Activity | null {
  if (conflict.resolution === 'incoming') return conflict.incomingActivity;
  if (conflict.resolution === 'merged') return conflict.mergedActivity ?? null;
  if (conflict.resolution === 'local') return conflict.localActivity;
  return null;
}

/**
 * 全部冲突解决后，生成最终活动表。
 * 非冲突活动沿用 mergeResult.activities（依赖已按并集合并）；
 * 冲突活动按选定版本写入，并再与另一版做依赖并集，保证不丢任一版依赖。
 */
export function applyResolvedMerge(reviewPackage: {
  baseActivities: Activity[];
  conflicts: MergeConflict[];
} , merged: MergeResult): { activities: Activity[]; danglingDependencies: Array<{ activityId: string; dependencyId: string }> } {
  const baseMap = byId(reviewPackage.baseActivities);
  const result: Activity[] = [];

  for (const placeholder of merged.activities) {
    const conflict = reviewPackage.conflicts.find((item) => item.activityId === placeholder.id);
    if (!conflict) {
      result.push(cloneActivity(placeholder));
      continue;
    }
    if (conflictWantsDelete(conflict)) continue; // 老师选择了“删除”一侧
    const chosen = chosenActivity(conflict);
    if (!chosen) continue;
    const localMap = new Map<string, Activity>();
    const incomingMap = new Map<string, Activity>();
    if (conflict.localActivity) localMap.set(conflict.activityId, conflict.localActivity);
    if (conflict.incomingActivity) incomingMap.set(conflict.activityId, conflict.incomingActivity);
    // 以选定版本为载体，再与另一版做依赖并集。
    result.push(unionDependencies(conflict.activityId, baseMap, localMap, incomingMap, chosen));
  }

  const finalIds = new Set(result.map((activity) => activity.id));
  const dangling: Array<{ activityId: string; dependencyId: string }> = [];
  for (const activity of result) {
    for (const dependency of activity.dependencies) {
      if (!finalIds.has(dependency)) dangling.push({ activityId: activity.id, dependencyId: dependency });
    }
  }
  return { activities: result, danglingDependencies: dedupeDangling(dangling) };
}

function buildConflict(
  id: string,
  localActivity: Activity,
  incomingActivity: Activity,
  fields: ActivityFieldKey[],
  kind: ConflictKind,
  baseActivity?: Activity | null
): MergeConflict {
  // 字段互不重叠时，三方合并可自动拼成一版，但仍并列保留等老师确认。
  const baseLocal = baseActivity ? changedFields(baseActivity, localActivity) : fields;
  const baseIncoming = baseActivity ? changedFields(baseActivity, incomingActivity) : fields;
  const overlap = baseLocal.some((field) => baseIncoming.includes(field));
  return {
    activityId: id,
    title: localActivity.title || incomingActivity.title || id,
    kind,
    fieldSuggestion: !overlap && fields.length > 0,
    changedFields: fields,
    localActivity: cloneActivity(localActivity),
    incomingActivity: cloneActivity(incomingActivity),
    resolution: null
  };
}

function pushSideChange(
  autoChanges: AutoChange[],
  fields: ActivityFieldKey[],
  id: string,
  title: string,
  side: 'incoming' | 'local'
): void {
  const labels = fields.map(fieldLabel);
  autoChanges.push({
    kind: 'description',
    activityId: id,
    title,
    detail:
      (side === 'incoming' ? '同事修改了' : '本地修改了') +
      `${labels.join('、')}，另一侧未改动，直接并入。`
  });
}

function sameRelativeOrder(reference: string[], order: string[]): boolean {
  let last = -1;
  for (const id of reference) {
    const index = order.indexOf(id);
    if (index === -1) continue;
    if (index < last) return false;
    last = index;
  }
  return true;
}

function dedupeDangling(
  items: Array<{ activityId: string; dependencyId: string }>
): Array<{ activityId: string; dependencyId: string }> {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = `${item.activityId}->${item.dependencyId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** 校验课程包 JSON。 */
export function parsePackage(text: string): CoursePackage {
  const data = JSON.parse(text) as CoursePackage;
  if (!data || data.kind !== 'phonics-course-package' || data.packageVersion !== 1) {
    throw new Error('不是有效的课程包文件（缺少课程包标识或版本不支持）。');
  }
  if (data.courseId == null || !Array.isArray(data.baseActivities) || !Array.isArray(data.activities)) {
    throw new Error('课程包内容不完整：缺少来源版本快照或活动数据。');
  }
  return data;
}
