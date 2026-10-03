// 课程编排工具的共享数据模型。

export type ActivityType = '音素' | '单词' | '句子' | '练习';
export type ViewMode = 'compose' | 'path' | 'issues' | 'versions';
export type PreviewWidth = 'phone' | 'tablet' | 'desktop';
export type IssueLevel = 'error' | 'warning' | 'info';

export interface Activity {
  id: string;
  type: ActivityType;
  title: string;
  content: string;
  phonemes: string[];
  dependencies: string[];
  difficulty: number;
  prompt: string;
  accessibility: string;
  duration: number;
  feedback: string;
}

export interface CourseVersion {
  id: string;
  label: string;
  savedAt: string;
  note: string;
  activities: Activity[];
}

export interface Course {
  id: string;
  title: string;
  level: string;
  ageRange: string;
  objective: string;
  activities: Activity[];
  versions: CourseVersion[];
  updatedAt: string;
  /** 乐观并发版本号：每次落库 +1，用于检测另一个标签页的提交。 */
  revision: number;
}

export interface Diagnostic {
  id: string;
  activityId: string;
  level: IssueLevel;
  category: string;
  title: string;
  detail: string;
}

export interface VersionDiff {
  id: string;
  title: string;
  kind: 'added' | 'removed' | 'changed';
  detail: string;
}

// ---------------------------------------------------------------------------
// 课程包与三方合并
// ---------------------------------------------------------------------------

/** 活动的全部可比字段（id/type 单独处理，type 也算可改字段）。 */
export type ActivityFieldKey =
  | 'type'
  | 'title'
  | 'content'
  | 'phonemes'
  | 'dependencies'
  | 'difficulty'
  | 'prompt'
  | 'accessibility'
  | 'duration'
  | 'feedback';

/** 同事带走的课程包：带来源版本号 + 活动快照 + 改后的完整活动表。 */
export interface CoursePackage {
  kind: 'phonics-course-package';
  packageVersion: 1;
  courseId: string;
  /** 导出时课程的乐观版本号，提交时用于判断两边谁先落库。 */
  baseRevision: number;
  baseVersionId: string;
  baseVersionLabel: string;
  exportedAt: string;
  sender: string;
  /** 来源版本的活动快照（三方合并的共同祖先）。 */
  baseActivities: Activity[];
  /** 对方修改后的完整活动表。 */
  activities: Activity[];
}

export type AutoChangeKind = 'added-incoming' | 'added-local' | 'deleted' | 'order' | 'description';

/** 无需老师选择、直接并入的变化。 */
export interface AutoChange {
  kind: AutoChangeKind;
  activityId: string;
  title: string;
  detail: string;
}

export type ConflictKind = 'both-modified' | 'delete-vs-modify';
export type ConflictSide = 'local' | 'incoming' | 'merged' | null;

export interface MergeConflict {
  activityId: string;
  title: string;
  kind: ConflictKind;
  /** 两边都改了但字段互不重叠时给出的字段级三方建议；同活动并列保留直到老师选择。 */
  fieldSuggestion: boolean;
  changedFields: ActivityFieldKey[];
  localActivity: Activity | null;
  incomingActivity: Activity | null;
  /** 字段级拼合后的版本（老师选择“字段拼合”时生成）。 */
  mergedActivity?: Activity | null;
  /** 未选定前为 null，选定后按该版写入。 */
  resolution: ConflictSide;
}

export interface PendingMergeReview {
  id: string;
  packageData: CoursePackage;
  conflicts: MergeConflict[];
  autoChanges: AutoChange[];
  /** 三方合并的完整结果（冲突活动为本地占位），冲突解决后基于它生成最终活动表。 */
  mergeResult: MergeResult;
  /** 导入时当前课程的 revision，提交时用于判断期间是否有其他提交。 */
  mergedAt: string;
  mergedFromRevision: number;
}

/** 失败后仍可继续处理的待处理项（跨标签页共享，放独立存储区）。 */
export interface PendingItem {
  id: string;
  createdAt: string;
  review: PendingMergeReview;
}

/** 后提交方保留下来的草稿（未覆盖先提交内容）。 */
export interface StashedDraft {
  id: string;
  createdAt: string;
  reason: 'stale-revision' | 'merge-rejected';
  remoteRevision: number;
  baseRevision: number;
  course: Course;
  /** 草稿来自一次合并时，保留待处理项 id 以便继续解决冲突。 */
  pendingItemId?: string;
  note: string;
}

/** 活动、依赖或版本变化后“失效重算”的说明。 */
export interface InvalidationNotice {
  id: string;
  at: string;
  title: string;
  reason: string;
  affectedActivityIds: string[];
  invalidatedChecks: string[];
}

export interface MergeResult {
  activities: Activity[];
  autoChanges: AutoChange[];
  conflicts: MergeConflict[];
  orderNote: string;
  /** 合并后悬空的依赖（来源活动被单边删除），不丢弃，交给质量检查提示。 */
  danglingDependencies: Array<{ activityId: string; dependencyId: string }>;
}
