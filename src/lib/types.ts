export type ActivityType = '音素' | '单词' | '句子' | '练习';
export type IssueLevel = 'error' | 'warning' | 'info';

export interface Diagnostic {
  id: string;
  activityId: string;
  level: IssueLevel;
  category: string;
  title: string;
  detail: string;
}

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

export interface CourseMeta {
  title: string;
  level: string;
  ageRange: string;
  objective: string;
}

export interface CourseVersion {
  id: string;
  label: string;
  savedAt: string;
  note: string;
  activities: Activity[];
  /** 新版本快照会同时记录课程信息，供课程包三向合并判断单边修改；旧数据可能没有该字段。 */
  meta?: CourseMeta | null;
  /** 合并存档时记录来源课程包，便于追溯。 */
  mergedFromPackage?: string | null;
}

export interface Course extends CourseMeta {
  id: string;
  activities: Activity[];
  versions: CourseVersion[];
  updatedAt: string;
  /** 单调递增的提交版本号，用于多标签页乐观并发控制；旧数据迁移为 1。 */
  revision: number;
}

export interface VersionDiff {
  id: string;
  title: string;
  kind: 'added' | 'removed' | 'changed';
  detail: string;
}
