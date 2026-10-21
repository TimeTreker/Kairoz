// Bilingual labels for the closed vocabularies of the platform.

import type { Bilingual } from './i18n.tsx';

const b = (zh: string, en: string): Bilingual => ({ zh, en });

export const ROLE_LABELS: Record<string, Bilingual> = {
  BUSINESS_DEV: b('业务研发', 'Business Development'),
  BUSINESS_TEST: b('业务测试', 'Business Testing'),
  INTEGRATION_TEST: b('集成测试', 'Integration Testing'),
  DCL_ENGINEER: b('DCL 工程', 'DCL Engineering'),
  CONFIG_INTEGRATOR: b('配置集成', 'Config Integration'),
  CONFIG_RELEASE: b('配置发布', 'Config Release'),
  VEHICLE_RESOURCE: b('车辆资源', 'Vehicle Resources'),
  WORKSPACE_ADMIN: b('工作区管理员', 'Workspace Admin'),
  PLATFORM_OPS: b('平台运维', 'Platform Operations'),
};

export const ROLE_GOALS: Record<string, Bilingual> = {
  BUSINESS_DEV: b('把本组数据需求变成可验证的文件与采集策略变更', 'Turn the group’s data needs into verifiable file and policy changes'),
  BUSINESS_TEST: b('用仿真与实车证明固定提交可用', 'Prove a fixed commit works on simulation and real vehicles'),
  INTEGRATION_TEST: b('独立验证冻结的完整集成候选', 'Independently verify the frozen integration candidate'),
  DCL_ENGINEER: b('保障文件从车端到云端的接入、处理与合规', 'Keep vehicle-to-cloud intake, processing and compliance sound'),
  CONFIG_INTEGRATOR: b('收集已验证变更，解决冲突，冻结完整集合', 'Collect verified changes, resolve conflicts, freeze the full set'),
  CONFIG_RELEASE: b('发布已验证集合，控制量产下发风险', 'Release verified sets and control production rollout risk'),
  VEHICLE_RESOURCE: b('维护车辆归属、真实软件版本与环境', 'Maintain vehicle ownership, actual software and environment'),
  WORKSPACE_ADMIN: b('提供本工作区可用的实车与仿真资源', 'Provide usable physical and simulated vehicles to the workspace'),
  PLATFORM_OPS: b('维护组织、账号与授权，保障平台运行', 'Maintain organization, accounts and grants; keep the platform running'),
};

export const ENV_LABELS: Record<string, Bilingual> = {
  development: b('研发', 'Development'),
  testing: b('测试', 'Testing'),
  production: b('量产', 'Production'),
};

export const STAGE_LABELS: Record<string, Bilingual> = {
  DRAFT: b('草稿', 'Draft'),
  SUBMITTED: b('待 DCL 审核', 'Awaiting DCL review'),
  DCL_READY: b('DCL Ready', 'DCL Ready'),
  TESTING: b('测试中', 'Testing'),
  VERIFIED: b('已验证', 'Verified'),
  INTEGRATED: b('已集成', 'Integrated'),
  ARCHIVED: b('已归档', 'Archived'),
};

export const STAGE_COLORS: Record<string, string> = {
  DRAFT: 'default',
  SUBMITTED: 'orange',
  DCL_READY: 'blue',
  TESTING: 'purple',
  VERIFIED: 'green',
  INTEGRATED: 'cyan',
  ARCHIVED: 'default',
};

export const WORKSPACE_KIND_LABELS: Record<string, Bilingual> = {
  TEAM: b('团队', 'Team'),
  PROJECT: b('项目', 'Project'),
  INTEGRATION: b('集成', 'Integration'),
};

export const FILE_TYPE_LABELS: Record<string, Bilingual> = {
  text_log: b('文本日志', 'Text log'),
  bin_log: b('二进制日志', 'Binary log'),
  can_log: b('CAN 日志', 'CAN log'),
  camera_image: b('摄像头图像', 'Camera image'),
  camera_video: b('摄像头视频', 'Camera video'),
  pointcloud: b('点云', 'Point cloud'),
  gnss: b('GNSS / 轨迹', 'GNSS / trajectory'),
  unknown: b('未知格式', 'Unknown'),
};

export const DATA_STATUS_LABELS: Record<string, Bilingual> = {
  PENDING: b('已登记', 'Registered'),
  REVIEW: b('待查重', 'Overlap review'),
  ACTIVE: b('已提交', 'Committed'),
  ARCHIVED: b('已归档', 'Archived'),
};

export const REVIEW_STATUS_LABELS: Record<string, Bilingual> = {
  PENDING: b('待审核', 'Pending'),
  APPROVED: b('已批准', 'Approved'),
  REJECTED: b('已拒绝', 'Rejected'),
};

export const REFERENCE_STATUS_LABELS: Record<string, Bilingual> = {
  NONE: b('未申请', 'Not requested'),
  PENDING: b('待决定', 'Pending'),
  APPROVED: b('已授权', 'Granted'),
  REJECTED: b('已拒绝', 'Rejected'),
  REVOKED: b('已撤销', 'Revoked'),
};

export const FEEDBACK_LABELS: Record<string, Bilingual> = {
  RETURNED: b('DCL 退回', 'Returned by DCL'),
  REVIEW_REJECTED: b('敏感审核拒绝', 'Sensitive review rejected'),
  BINDING_CHANGED: b('DCL 调整处理绑定', 'Binding changed by DCL'),
  REFERENCE_REVOKED: b('引用被撤销', 'Reference revoked'),
};

export const DENY_REASON_LABELS: Record<string, Bilingual> = {
  ROLE_NOT_GRANTED: b('没有该角色的授权', 'no grant with the required role'),
  WORKSPACE_NOT_GRANTED: b('授权未覆盖该工作区', 'no grant covers this workspace'),
  GROUP_NOT_GRANTED: b('授权未覆盖该业务分组', 'no grant covers this business group'),
  SCOPE_NOT_GRANTED: b('授权未覆盖该范围', 'no grant covers this scope'),
  ENV_NOT_GRANTED: b('授权未覆盖所需环境', 'no grant covers the required environment'),
  DISPATCH_ONLY_GRANT: b('仅下发授权不能执行此操作', 'dispatch-only grants cannot do this'),
  NO_SINGLE_GRANT: b('各条件分别被不同授权满足，但授权不能拼接', 'conditions are met only by combining grants, which is not allowed'),
  NOT_VISIBLE: b('无权查看该分组配置', 'not allowed to view this group’s configuration'),
};

/** Error codes with friendlier text; others fall back to the engine message. */
export const ERROR_LABELS: Record<string, Bilingual> = {
  FORBIDDEN: b('无权执行', 'Not authorized'),
  UNAUTHENTICATED: b('账号已失效，请重新进入', 'The account is no longer active; sign in again'),
  NOT_FOUND: b('对象不存在', 'Not found'),
  VALIDATION_FAILED: b('输入不完整或格式不正确', 'Some input is missing or invalid'),
  TEMPLATE_MISSING: b('该文件类型尚无 DCL 发布的默认处理模板，请联系 DCL 工程', 'No default processing template for this file type yet; ask DCL engineering'),
  SENSITIVE_TYPE_DOWNGRADE: b('文件来源显示为敏感类型，不能申报为普通类型', 'The source looks sensitive; it cannot be declared as a non-sensitive type'),
  DATA_SOURCE_OWNED_ELSEWHERE: b('该来源已由其他分组登记，请申请只读引用', 'Another group registered this source; request a read-only reference'),
  FILE_ALREADY_IN_DRAFT: b('该来源已在草稿中', 'This source is already in the draft'),
  FILE_CAPTURED_BY_POLICY: b('仍有策略采集该文件，请先从策略中移除', 'Policies still capture this file; remove it from them first'),
  INVALID_POLICY: b('策略无效', 'The policy is invalid'),
  INVALID_POLICY_ID: b('策略 ID 必须以本组代码开头', 'The policy id must start with the group code'),
  POLICY_OWNED_ELSEWHERE: b('该策略由其他分组维护', 'Another group maintains this policy'),
  POLICY_NAMESPACE_TAKEN: b('策略 ID 属于其他分组的命名空间', 'The policy id belongs to another group’s namespace'),
  SUBMIT_BLOCKED: b('草稿暂不能提交', 'The draft cannot be submitted yet'),
  NO_CHANGES: b('内容未变化，无需提交', 'Nothing changed'),
  CHANGES_REQUESTED: b('DCL 已对该提交提出修改要求，请修改后再提交', 'Changes were requested on this commit; change the draft first'),
  FEATURE_IMMUTABLE: b('当前阶段不能修改', 'The Feature cannot change in this stage'),
  FEATURE_NAME_TAKEN: b('本组已有同名 Feature', 'The group already has a Feature with this name'),
  INVALID_FEATURE_NAME: b('Feature 名称须为小写字母开头，3–46 位字母、数字、_ 或 -', 'Feature names: lower-case start, 3–46 letters, digits, _ or -'),
  TEST_GROUP_CANNOT_OWN_CONFIG: b('测试用途分组不能维护文件和策略', 'Test groups do not maintain files or policies'),
  INCOMPLETE_CONTROLS: b('批准前须确认全部控制项', 'Confirm every control before approving'),
  STALE_COMMIT: b('Feature 已有更新的提交，请审核最新提交', 'The Feature has a newer commit; review that one'),
  NOT_IN_INTAKE: b('Feature 不在 DCL 接入中', 'The Feature is not in DCL intake'),
  REVIEW_NOT_REQUIRED: b('该文件不需要敏感审核', 'This file does not need sensitive review'),
  REASON_REQUIRED: b('请填写原因', 'Give a reason'),
  INCOMPATIBLE_BINDING: b('车端 / 云端处理绑定不兼容', 'The Edge/Cloud binding is not compatible'),
  REFERENCE_NOT_GRANTED: b('没有有效的引用授权', 'No approved reference'),
  REFERENCE_ALREADY_OPEN: b('已有进行中的申请或有效授权', 'A request or grant is already open'),
  NOT_COMMITTED: b('该数据尚未提交，不能引用', 'This data is not committed yet'),
  OWN_DATA_ITEM: b('这是本组自己的数据', 'This is the group’s own data'),
  LAST_ADMINISTRATOR: b('必须保留至少一名覆盖全部环境的平台运维', 'At least one platform administrator covering every environment must remain'),
  INVALID_GRANTS: b('授权配置不正确', 'The grants are invalid'),
  ACCOUNT_EXISTS: b('账号已存在', 'The account already exists'),
  ID_TAKEN: b('ID 已被使用', 'The id is already used'),
  GROUP_CODE_NESTED: b('分组代码不能与其他分组代码互为前缀', 'Group codes cannot nest inside each other'),
  ORG_CYCLE: b('不能移动到自己的下级', 'A unit cannot move beneath itself'),
};

export const RESOURCE_TYPE_LABELS: Record<string, Bilingual> = {
  PHYSICAL: b('实车', 'Physical'),
  SIMULATION: b('仿真', 'Simulation'),
};

export const RESOURCE_STATUS_LABELS: Record<string, Bilingual> = {
  AVAILABLE: b('可用', 'Available'),
  MAINTENANCE: b('维护中', 'Maintenance'),
  RETIRED: b('已报废', 'Retired'),
};

export const VEHICLE_GROUP_PURPOSE_LABELS: Record<string, Bilingual> = {
  DEV: b('研发', 'Development'),
  TEST: b('测试', 'Testing'),
  PRODUCTION: b('量产', 'Production'),
};

export const TARGET_STATUS_LABELS: Record<string, Bilingual> = {
  QUEUED: b('待放量', 'Queued'),
  PENDING: b('等待回执', 'Awaiting receipt'),
  APPLIED: b('已生效', 'Applied'),
  FAILED: b('失败', 'Failed'),
  CANCELLED: b('已取消', 'Cancelled'),
};

export const TARGET_STATUS_COLORS: Record<string, string> = {
  QUEUED: 'default',
  PENDING: 'processing',
  APPLIED: 'success',
  FAILED: 'error',
  CANCELLED: 'default',
};

export const DEPLOYMENT_STATUS_LABELS: Record<string, Bilingual> = {
  PENDING: b('进行中', 'In progress'),
  COMPLETED: b('已结束', 'Finished'),
  CANCELLED: b('已取消', 'Cancelled'),
  PAUSED: b('已暂停', 'Paused'),
  ROLLED_BACK: b('已回滚', 'Rolled back'),
};

Object.assign(ERROR_LABELS, {
  DISPATCH_BLOCKED: b('下发被拒绝：并非所有车辆都满足条件', 'Dispatch blocked: not every vehicle qualifies'),
  NOT_DCL_READY: b('只有 DCL Ready 的 Feature 才能下发', 'Only DCL Ready Features can be dispatched'),
  NO_VEHICLE_GROUPS: b('请选择车辆组', 'Choose vehicle groups'),
  NOT_APPLIED: b('车辆尚未确认应用该配置', 'The vehicle has not confirmed applying this configuration'),
  NOT_A_TEST_TARGET: b('该车辆不在本提交的验证目标中', 'This vehicle is not a test target of the commit'),
  SIMULATION_FIRST: b('实车测试前须先有仿真测试通过', 'A simulation test must pass before a physical one'),
  VERIFY_BLOCKED: b('暂不能确认 Verified', 'Cannot verify yet'),
  NOT_TESTING: b('不在测试中', 'Not in testing'),
  SUMMARY_REQUIRED: b('请填写测试说明', 'Describe the test'),
  VEHICLE_BUSY: b('车辆正在等待另一次下发的回执', 'The vehicle is waiting for another dispatch'),
  VEHICLE_ALREADY_GROUPED: b('车辆已属于另一个车辆组，请先移出', 'The vehicle is in another vehicle group; remove it there first'),
  VEHICLE_NOT_ASSIGNABLE: b('车辆不符合本工作区（车型、资源池或环境）或已加入', 'The vehicle does not fit this workspace (model, pool, environment) or is already assigned'),
  VEHICLE_NOT_IN_WORKSPACE: b('请先把车辆加入工作区', 'Add the vehicle to the workspace first'),
  VEHICLE_IN_GROUP: b('请先把车辆移出车辆组', 'Remove the vehicle from its vehicle group first'),
  ENV_MISMATCH: b('车辆环境与车辆组不一致', 'The vehicle’s environment differs from the group'),
  GROUP_HAS_MEMBERS: b('请先移出全部车辆', 'Move all vehicles out first'),
  SIMULATION_SOFTWARE_FROM_IMAGE: b('仿真车的软件版本由镜像决定', 'A simulation’s software comes from its image'),
  UNKNOWN_SOFTWARE_VERSION: b('该软件版本尚未登记', 'That software version is not recorded'),
  INVALID_VIN: b('VIN 为 17 位，不含 I、O、Q', 'A VIN has 17 characters without I, O or Q'),
  RECEIPT_CONFLICT: b('该尝试已有不同的回执', 'A different receipt exists for this attempt'),
  STALE_ATTEMPT: b('回执的尝试次数已过期', 'The receipt is for an old attempt'),
  TARGET_NOT_PENDING: b('该目标未在等待回执', 'The target is not awaiting a receipt'),
});

export const PLAN_STATUS_LABELS: Record<string, Bilingual> = {
  READY: b('可冻结', 'Ready'),
  CONFLICT: b('有冲突', 'Conflicts'),
  BLOCKED: b('集合有问题', 'Blocked'),
  FROZEN: b('已冻结为候选', 'Frozen'),
  SUPERSEDED: b('已被新预览取代', 'Superseded'),
};
export const PLAN_STATUS_COLORS: Record<string, string> = { READY: 'green', CONFLICT: 'red', BLOCKED: 'orange', FROZEN: 'blue', SUPERSEDED: 'default' };

export const CANDIDATE_STATUS_LABELS: Record<string, Bilingual> = {
  CANDIDATE: b('待集成测试', 'Awaiting tests'),
  TESTING: b('集成测试中', 'Testing'),
  VERIFIED: b('集成已验证', 'Verified'),
  RELEASED: b('已发布', 'Released'),
  CANCELLED: b('已取消', 'Cancelled'),
};
export const CANDIDATE_STATUS_COLORS: Record<string, string> = { CANDIDATE: 'default', TESTING: 'processing', VERIFIED: 'green', RELEASED: 'purple', CANCELLED: 'default' };

export const CONFLICT_OWNER_LABELS: Record<string, Bilingual> = {
  BUSINESS: b('业务方解决', 'Business resolves'),
  DCL: b('DCL 解决（处理字段）', 'DCL resolves (processing)'),
};

export const MERGE_SECTION_LABELS: Record<string, Bilingual> = {
  files: b('文件', 'File'),
  policies: b('策略', 'Policy'),
  references: b('引用', 'Reference'),
};

Object.assign(ERROR_LABELS, {
  NOT_A_MERGE_WORKSPACE: b('合并预览在项目工作区，或以团队工作区为来源的集成工作区进行', 'Merges run in a project workspace, or an integration workspace with team sources'),
  NO_SOURCES: b('请选择要合并的 Verified Feature', 'Choose Verified Features to merge'),
  SOURCE_NOT_ALLOWED: b('该 Feature 不是本工作区来源中的 Verified Feature', 'Not a Verified Feature from this workspace’s sources'),
  PLAN_NOT_READY: b('只有无冲突、无问题的预览可以确认或冻结', 'Only a conflict-free, unblocked preview can be confirmed or frozen'),
  UNAPPROVED_SENSITIVE_FILES: b('集合中有未获敏感审核批准的文件', 'Sensitive files in the set lack an approval'),
  ALREADY_CONFIRMED: b('该预览已确认', 'This preview is already confirmed'),
  PROCESSING_NOT_CONFIRMED: b('须先由 DCL 确认最终处理集合', 'DCL must confirm the final processing set first'),
  TARGET_CHANGED: b('目标版本已变化，请重新预览', 'The target release changed; preview again'),
  SOURCE_CHANGED: b('来源 Feature 在预览后有变化，请重新预览', 'A source Feature changed since the preview; preview again'),
  CANDIDATE_OPEN: b('本工作区还有未结束的集成候选', 'An open candidate exists in this workspace'),
  NO_INTEGRATION_WORKSPACE: b('没有以本项目为来源的集成测试工作区', 'No integration workspace takes this project as its source'),
  LABEL_REQUIRED: b('请为候选命名', 'Name the candidate'),
  CANDIDATE_CLOSED: b('候选已结束', 'The candidate is closed'),
  REASON_REQUIRED: b('请填写原因', 'Give a reason'),
  USE_ROLLOUT_CONTROLS: b('请使用发布控制操作该下发', 'Use the rollout controls for this deployment'),
});

Object.assign(ERROR_LABELS, {
  CANDIDATE_NOT_VERIFIED: b('只有通过集成测试的候选才能发布', 'Only a candidate verified by integration testing can be released'),
  INVALID_DCL_VERSION: b('DCL 版本格式为 major.minor.patch，例如 1.0.1', 'A DCL version is major.minor.patch, e.g. 1.0.1'),
  DCL_VERSION_TAKEN: b('该 DCL 版本已存在', 'That DCL version already exists'),
  DCL_VERSION_NOT_NEWER: b('新版本必须高于已发布的最新版本', 'The version must be newer than the latest release'),
  NO_VEHICLE_VERSIONS: b('请选择适用的整车软件版本', 'Choose the whole-vehicle software versions it applies to'),
  VERSION_NOT_TESTED: b('部分适用版本没有通过的集成测试', 'Some listed software versions have no passing integration test'),
  OTA_BLOCKED: b('OTA 被拒绝：并非所有车辆都满足条件', 'OTA blocked: not every vehicle qualifies'),
  NOTHING_TO_ROLL_OUT: b('所有车辆都已运行该版本', 'Every vehicle already runs this release'),
  OTA_PAUSED: b('OTA 已暂停，请先恢复', 'The rollout is paused; resume it first'),
  OTA_CLOSED: b('OTA 已结束', 'The rollout is finished'),
  OTA_NOT_RUNNING: b('只有进行中的 OTA 可以暂停', 'Only a running rollout can be paused'),
  OTA_NOT_PAUSED: b('OTA 未暂停', 'The rollout is not paused'),
  NOTHING_QUEUED: b('请选择待放量的车辆', 'Choose queued vehicles'),
  ROLLBACK_BLOCKED: b('回滚被拒绝：并非所有车辆都能回到兼容的上一正式配置', 'Rollback blocked: not every vehicle can return to a compatible earlier formal configuration'),
});

export const EVENT_STATUS_LABELS: Record<string, Bilingual> = {
  UPLOADING: b('车端上传中', 'Uploading'),
  PROCESSING: b('云端处理中', 'Processing'),
  DONE: b('处理完成', 'Processed'),
  FAILED: b('处理失败', 'Failed'),
};
export const EVENT_STATUS_COLORS: Record<string, string> = { UPLOADING: 'processing', PROCESSING: 'processing', DONE: 'green', FAILED: 'red' };

export const FILE_PROCESS_LABELS: Record<string, Bilingual> = {
  PENDING: b('等待', 'Pending'),
  UPLOADED: b('已上传', 'Uploaded'),
  DONE: b('已完成', 'Done'),
  PARSER_FAILED: b('解析失败', 'Parser failed'),
};

export const QUALITY_LABELS: Record<string, Bilingual> = {
  A: b('A', 'A'),
  B: b('B', 'B'),
  C: b('C', 'C'),
  UNKNOWN: b('未知', 'Unknown'),
};

export const TRAINING_USE_LABELS: Record<string, Bilingual> = {
  ALLOWED: b('允许训练', 'Allowed'),
  DENIED: b('不允许训练', 'Denied'),
  UNCONFIRMED: b('用途待确认', 'Unconfirmed'),
};

export const EVENT_ORIGIN_LABELS: Record<string, Bilingual> = {
  MOCK_SAMPLE: b('演示样例', 'Demo sample'),
  MOCK_EXECUTION: b('模拟执行', 'Simulated run'),
};

Object.assign(ERROR_LABELS, {
  NO_APPLIED_CONFIG: b('车辆没有已生效的配置，不会触发采集', 'The vehicle runs no confirmed configuration, so nothing fires'),
  POLICY_NOT_ON_VEHICLE: b('该策略不在车辆运行的配置中', 'That policy is not in the configuration the vehicle runs'),
  EVENT_NOT_FAILED: b('只有处理失败的事件可以重新处理', 'Only a failed event can be reprocessed'),
  NOTHING_SELECTED: b('请选择要导出的数据', 'Select data to export'),
  NOT_SELECTABLE: b('部分数据不可用于训练', 'Some data cannot be used for training'),
});

/** Reasons data is not selectable for training (engine strings). */
export const TRAINING_BLOCKER_LABELS: Record<string, Bilingual> = {
  'processing failed': b('处理失败', 'processing failed'),
  'processing not finished': b('处理未完成', 'processing not finished'),
  'captured files incomplete': b('捕获文件不完整', 'captured files incomplete'),
  'quality unknown': b('质量未知', 'quality unknown'),
  'quality C': b('质量 C', 'quality C'),
  'training use not confirmed': b('训练用途待确认', 'training use not confirmed'),
  'training use denied': b('不允许训练', 'training use denied'),
};

export const GROUP_CHANGE_LABELS: Record<string, Bilingual> = {
  ADDED: b('新增 Added', 'Added'),
  CHANGED: b('变更 Changed', 'Changed'),
  REMOVED: b('移除 Removed', 'Removed'),
  INHERITED: b('继承 Inherited', 'Inherited'),
  EMPTY: b('无配置（继承）', 'Empty (inherited)'),
};
export const GROUP_CHANGE_COLORS: Record<string, string> = { ADDED: 'green', CHANGED: 'blue', REMOVED: 'red', INHERITED: 'default', EMPTY: 'default' };
