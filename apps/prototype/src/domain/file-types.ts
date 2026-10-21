import { globsIntersect } from './data-source.ts';
import { rule } from './errors.ts';

export const FILE_TYPES = [
  'text_log',
  'bin_log',
  'can_log',
  'camera_image',
  'camera_video',
  'pointcloud',
  'gnss',
  'unknown',
] as const;
export type FileType = (typeof FILE_TYPES)[number];

export const FILE_TYPE_LABELS: Record<FileType, string> = {
  text_log: '文本日志',
  bin_log: '二进制日志',
  can_log: 'CAN 日志',
  camera_image: '摄像头图像',
  camera_video: '摄像头视频',
  pointcloud: '点云',
  gnss: 'GNSS / 轨迹',
  unknown: '未知格式',
};

const SENSITIVE_TYPES: ReadonlySet<FileType> = new Set(['camera_image', 'camera_video', 'pointcloud', 'gnss']);
export const SENSITIVE_TAGS = ['location', 'identity', 'image', 'voice', 'sensitive'] as const;

export const PRIVACY_LEVELS = ['P1', 'P2', 'P3'] as const;
export type Privacy = (typeof PRIVACY_LEVELS)[number];

export function isSensitiveType(type: FileType): boolean {
  return SENSITIVE_TYPES.has(type);
}

/** Types whose processing template must always require review. */
export function typeAlwaysRequiresReview(type: FileType): boolean {
  return isSensitiveType(type) || type === 'unknown';
}

/** Best-effort type from the file pattern, e.g. `*.mp4` -> camera_video. */
export function inferFileType(pattern: string): FileType {
  if (/\.(jpg|jpeg|png|webp)$/i.test(pattern)) return 'camera_image';
  if (/\.(mp4|avi|h264|h265)$/i.test(pattern)) return 'camera_video';
  if (/\.(pcd|las|laz)$/i.test(pattern)) return 'pointcloud';
  if (/(gnss|gps|trajectory|location)/i.test(pattern)) return 'gnss';
  if (/\.(asc|blf|mcap)$/i.test(pattern)) return 'can_log';
  if (/\.(pb|bin)$/i.test(pattern)) return 'bin_log';
  if (/\.(log|txt|jsonl)$/i.test(pattern)) return 'text_log';
  return 'unknown';
}

const SENSITIVE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp', 'mp4', 'avi', 'h264', 'h265', 'pcd', 'las', 'laz'];

/**
 * True if a wildcard pattern could pick up files with a sensitive extension, e.g. `front_*.mp?`
 * or `*`. Such a source needs review whatever type is declared.
 */
export function mayMatchSensitiveFiles(pattern: string): boolean {
  const lower = pattern.toLowerCase();
  return SENSITIVE_EXTENSIONS.some((ext) => globsIntersect(lower, `*.${ext}`));
}

/** A source that looks sensitive cannot be declared as a non-sensitive type. */
export function assertNotDowngraded(pattern: string, declared: FileType): void {
  const inferred = inferFileType(pattern);
  if (isSensitiveType(inferred) && declared !== inferred) {
    throw rule('SENSITIVE_TYPE_DOWNGRADE', `pattern ${pattern} indicates ${inferred}; it cannot be declared as ${declared}`, {
      inferred,
      declared,
    });
  }
}

export function requiresSensitiveReview(input: {
  fileType: FileType;
  privacy: Privacy;
  contentTags: readonly string[];
  templateRequiresReview: boolean;
  pattern: string;
}): boolean {
  return (
    input.templateRequiresReview ||
    mayMatchSensitiveFiles(input.pattern) ||
    typeAlwaysRequiresReview(input.fileType) ||
    input.privacy !== 'P1' ||
    input.contentTags.some((t) => (SENSITIVE_TAGS as readonly string[]).includes(t))
  );
}
