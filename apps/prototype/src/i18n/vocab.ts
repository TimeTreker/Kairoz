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
  VEHICLE_BUSY: b('车辆还有未完成的下发（等待回执或 OTA 未结束），请完成后再操作', 'The vehicle still has an unfinished dispatch (awaiting a receipt or an open OTA rollout); try again when it finishes'),
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

/** Merge preview statuses; AWAITING_DCL is a READY preview whose processing set DCL has not confirmed yet. */
export const PLAN_STATUS_LABELS: Record<string, Bilingual> = {
  AWAITING_DCL: b('等待 DCL 确认', 'Awaiting DCL confirmation'),
  READY: b('可冻结', 'Ready'),
  CONFLICT: b('有冲突', 'Conflicts'),
  BLOCKED: b('集合有问题', 'Blocked'),
  FROZEN: b('已冻结为候选', 'Frozen'),
  SUPERSEDED: b('已被新预览取代', 'Superseded'),
};
export const PLAN_STATUS_COLORS: Record<string, string> = { AWAITING_DCL: 'gold', READY: 'green', CONFLICT: 'red', BLOCKED: 'orange', FROZEN: 'blue', SUPERSEDED: 'default' };

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
  INVALID_DCL_VERSION: b('策略集版本格式为 major.minor.patch，例如 1.0.1', 'A policy set version is major.minor.patch, e.g. 1.0.1'),
  DCL_VERSION_TAKEN: b('该策略集版本已存在', 'That policy set version already exists'),
  DCL_VERSION_NOT_NEWER: b('新版本必须高于已发布的最新策略集版本', 'The version must be newer than the latest policy set'),
  NO_VEHICLE_VERSIONS: b('请选择适用的整车软件版本', 'Choose the whole-vehicle software versions it applies to'),
  VERSION_NOT_TESTED: b('部分适用版本没有通过的集成测试', 'Some listed software versions have no passing integration test'),
  OTA_BLOCKED: b('OTA 被拒绝：并非所有车辆都满足条件', 'OTA blocked: not every vehicle qualifies'),
  NOTHING_TO_ROLL_OUT: b('所有车辆都已运行该策略集', 'Every vehicle already runs this policy set'),
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

export const REQUEST_STATUS_LABELS: Record<string, Bilingual> = {
  PENDING: b('待审批', 'Pending'),
  APPROVED: b('已批准', 'Approved'),
  REJECTED: b('已驳回', 'Rejected'),
  EXECUTED: b('已执行', 'Executed'),
  WITHDRAWN: b('已撤回', 'Withdrawn'),
};
export const REQUEST_STATUS_COLORS: Record<string, string> = { PENDING: 'gold', APPROVED: 'green', REJECTED: 'red', EXECUTED: 'blue', WITHDRAWN: 'default' };

Object.assign(ERROR_LABELS, {
  APPROVAL_REQUIRED: b('该车辆组的下发需要已批准的团队测试申请', 'This vehicle group takes approved team test requests'),
  SELF_APPROVAL: b('不能审批自己的申请', 'Nobody decides their own request'),
  MEMBERS_CHANGED: b('车辆清单已变化，请重新申请', 'The vehicle list changed; ask for a new request'),
  REQUEST_USED: b('批准只能使用一次', 'An approval is used once'),
  REQUEST_NOT_APPROVED: b('申请尚未批准', 'The request is not approved'),
  REQUEST_DECIDED: b('申请已处理', 'The request is already decided'),
  GOAL_REQUIRED: b('请填写测试目标', 'Say what the test should show'),
  SIMULATION_RUNNING: b('仿真实例运行中，请先停止', 'The simulation is running; stop it first'),
  SIMULATION_STOPPED: b('仿真实例已停止，无法应用配置', 'The simulation is stopped and cannot apply configurations'),
  VEHICLE_RESERVED: b('车辆已被预约，请先解除预约', 'The vehicle is reserved; release it first'),
  CONTROLLERS_REQUIRED: b('请逐个填写域控的版本与结果', 'Report every controller with its version and result'),
  CHECKSUM_MISMATCH: b('分片校验不一致，未保存', 'The chunk checksum does not match; it was not stored'),
  CALLBACK_TOO_EARLY: b('事件尚未处理完成', 'The event is not processed yet'),
  INVALID_DIGEST: b('摘要须为 sha256:<64 位十六进制> 或标注的 sha256:mock-…', 'The digest must be sha256:<64 hex> or a labelled sha256:mock-…'),
});

// Organization, workspace, catalog and vehicle setup.
Object.assign(ERROR_LABELS, {
  ALREADY_RUNNING: b('仿真实例已在运行', 'The simulation is already running'),
  ALREADY_STOPPED: b('仿真实例已停止', 'The simulation is already stopped'),
  CROSS_TREE_MOVE: b('组织节点只能在本组织树内移动', 'A unit can only move within its own organization tree'),
  DOMAIN_OUTSIDE_WORKSPACE: b('该域不在工作区的范围内', 'The domain is not in the workspace scopes'),
  DUPLICATE_MEMBERS: b('分组、范围与来源不能重复', 'Groups, scopes and sources must not repeat'),
  GROUP_ARCHIVED: b('业务分组已归档', 'The business group is archived'),
  GROUP_CODE_TAKEN: b('分组代码已被使用', 'The group code is already used'),
  GROUP_IN_USE: b('该工作区中有 Feature 的分组不能移除', 'Groups with Features in this workspace cannot be removed'),
  GROUP_NOT_IN_WORKSPACE: b('请选择本工作区的业务分组', 'Choose a business group of this workspace'),
  GROUP_OUTSIDE_TEAM: b('团队工作区只能使用本团队的分组', 'Team workspaces only use their team’s groups'),
  GROUP_TREE_MISMATCH: b('分组所属节点不在工作区的组织树内', 'The group’s unit is outside the workspace’s organization tree'),
  IMAGE_MODEL_MISMATCH: b('镜像属于其他车型', 'The image is for another vehicle model'),
  INVALID_FILE: b('文件名须 1–100 字，用途须 1–500 字', 'File names take 1–100 characters and purposes 1–500'),
  INVALID_GROUP_CODE: b('分组代码格式不正确（小写字母、数字，以点分段，如 chassis.brake）', 'The group code is malformed (lower-case dotted segments, e.g. chassis.brake)'),
  INVALID_SOURCE: b('数据源不合法：域控名、以 / 开头的绝对目录与文件模式须符合格式', 'The source is invalid: the unit, an absolute directory starting with / and the file pattern must be well formed'),
  INVALID_ID: b('ID 格式不正确（车辆如 VEH-001、SIM-021；镜像用小写字母、数字、. _ -）', 'The id is malformed (vehicles like VEH-001 or SIM-021; images use lower-case letters, digits, . _ -)'),
  INVALID_PIPELINE: b('处理版本须填写格式与步骤', 'A pipeline needs formats and steps'),
  INVALID_TEMPLATE: b('默认保留天数须为正整数', 'Default retention must be a positive number of days'),
  INVALID_USERNAME: b('用户名须以小写字母开头，3–32 位小写字母、数字或下划线', 'Usernames start with a lower-case letter and have 3–32 lower-case letters, digits or _'),
  INVALID_VERSION: b('版本格式如 1.0 或 1.2.3', 'Versions look like 1.0 or 1.2.3'),
  MODEL_MISMATCH: b('车型不一致', 'The vehicle model does not match'),
  NAME_REQUIRED: b('请填写显示名', 'A display name is required'),
  NAME_TAKEN: b('工作区中已有同名车辆组', 'The workspace already has a vehicle group with this name'),
  NOT_APPROVED: b('只能撤销已批准的引用', 'Only an approved reference can be revoked'),
  NOT_A_SIMULATION: b('不是仿真实例', 'Not a simulation instance'),
  NOTE_REQUIRED: b('请说明决定理由', 'Explain the decision'),
  NOT_PENDING: b('状态已变化，不再等待处理', 'It is no longer pending'),
  NOT_RESERVED: b('车辆没有被预约', 'The vehicle is not reserved'),
  NOT_UNDER_REVIEW: b('该数据项不在重叠判定中', 'The data item is not awaiting an overlap decision'),
  NOT_YOUR_REQUEST: b('只有申请人可以撤回申请', 'Only the requester withdraws a request'),
  PARENT_ARCHIVED: b('上级节点已归档', 'The parent unit is archived'),
  PARENT_REQUIRED: b('项目节点需要上级节点', 'Project units need a parent'),
  PIPELINE_SIDE_FIXED: b('处理代码只属于一侧（车端或云端），不能改变', 'A pipeline code belongs to one side (edge or cloud) only'),
  POOL_OUTSIDE_WORKSPACE: b('资源池不在工作区的范围内', 'The pool is not in the workspace scopes'),
  PRODUCTION_IN_TEAM: b('量产车辆组只能建在项目或集成工作区', 'Production vehicle groups belong to project or integration workspaces'),
  PRODUCTION_SIMULATION: b('仿真实例只用于研发与测试环境', 'Simulation instances are for development and testing'),
  PROJECT_NOT_ESTABLISHED: b('项目尚未成立', 'The project is not established'),
  PROJECT_ROOT_FIXED: b('项目根节点不能移动', 'A project root cannot be moved'),
  PURPOSE_ENV_MISMATCH: b('量产车辆组必须且只能使用量产环境', 'Production vehicle groups are exactly the groups in the production environment'),
  PURPOSE_REQUIRED: b('请说明预约用途', 'Say what the reservation is for'),
  SELF_SOURCE: b('工作区不能以自己为来源', 'A workspace cannot be its own source'),
  SOURCE_ARCHIVED: b('来源工作区已归档', 'The source workspace is archived'),
  SOURCE_MODEL_MISMATCH: b('来源工作区属于其他车型', 'The source workspace is for another vehicle model'),
  SOURCE_REQUIRED: b('请填写可信来源（如 DIP 上报、软件 OTA 回执）', 'Name the trusted source (e.g. a DIP report or software OTA receipt)'),
  TEAM_HAS_NO_SOURCES: b('团队工作区维护自己的修改，没有来源工作区', 'Team workspaces maintain their own changes and take no sources'),
  UNIT_ARCHIVED: b('组织节点已归档', 'The organization unit is archived'),
  UNIT_OUTSIDE_WORKSPACE: b('分组须属于工作区的组织节点或其下级', 'The group must belong to the workspace’s unit or below it'),
  UNKNOWN_GRANT_REFERENCE: b('授权引用了不存在的工作区或分组', 'Grants reference unknown workspaces or groups'),
  UVID_TAKEN: b('该 UVID 已登记', 'The UVID is already registered'),
  VEHICLE_GROUP_ARCHIVED: b('车辆组已归档', 'The vehicle group is archived'),
  VEHICLE_MODEL_RETIRED: b('车型已停用', 'The vehicle model is retired'),
  VEHICLE_UNAVAILABLE: b('车辆当前不可用', 'The vehicle is not available'),
  VERSION_EXISTS: b('该版本已登记', 'The version is already recorded'),
  VIN_TAKEN: b('该 VIN 已登记', 'The VIN is already registered'),
  WORKSPACE_ARCHIVED: b('工作区已归档', 'The workspace is archived'),
  WORKSPACE_REQUIRED: b('请指定车辆所属工作区', 'Name the workspace of the vehicles'),
  WORKSPACE_TREE_MISMATCH: b('团队工作区须建在团队节点上，项目与集成工作区须建在项目节点上', 'Team workspaces sit on team units; project and integration workspaces on project units'),
});

export const CONFIG_ANSWER_LABELS: Record<string, Bilingual> = {
  HELD: b('保持已确认（同步暂停）', 'Held (sync paused)'),
  TASK: b('当前任务目标', 'Rollout target'),
  LATEST_RELEASE: b('软件版本当前适用的策略集', 'Policy set in effect for its software'),
  GROUP_TARGET: b('车辆组发布内容（本车基线）', 'Group publication (on this vehicle’s base)'),
  REPUBLISH: b('软件或策略集已变化，需重新下发', 'Software or policy set changed; publish again'),
  BASE_CONFLICT: b('与新基线冲突，保持已生效配置', 'Conflicts with the new base; keeps the applied configuration'),
  NO_BASE: b('没有适用基线，保持已生效配置', 'No base applies; keeps the applied configuration'),
  APPLIED: b('已生效配置', 'Applied configuration'),
  INITIAL: b('初始研发配置', 'Initial configuration'),
  BLOCKED: b('阻止', 'Blocked'),
};

// Client reports (DCL Client 实际状态上报)
Object.assign(ERROR_LABELS, {
  INVALID_DEVICE_KEY: b('请填写设备密钥编号与设备公钥（mock-ed25519:…）', 'Give a key id and the device’s public key (mock-ed25519:…)'),
  DEVICE_NOT_REGISTERED: b('设备密钥未登记，不能上报', 'The device key is not registered; the vehicle cannot report'),
  SIGNATURE_INVALID: b('上报签名与登记的设备密钥不符', 'The report’s signature does not match the registered device key'),
  REPORT_IDENTITY_MISMATCH: b('上报的车辆身份（资源 ID、VIN/UVID）与登记不符', 'The report’s vehicle identity (id, VIN/UVID) differs from the registration'),
  REPORT_BOOT_CONFLICT: b('同一启动计数已有另一个启动 ID', 'This boot counter already has another boot id'),
  REPORT_SEQUENCE_CONFLICT: b('同一启动与序号已上报过不同内容', 'This boot and sequence were already reported with other content'),
  REPORT_SCHEMA_UNSUPPORTED: b('上报格式不受支持', 'The report format is not supported'),
  REPORT_TOO_LARGE: b('上报内容超出限制（每类最多 256 项，执行信息最多 8 KiB）', 'The report is too large (256 items per list, 8 KiB of execution detail)'),
  CLIENT_NOT_RUNNING: b('车端客户端未运行（仿真实例已停止或车辆已报废）', 'The vehicle client is not running (instance stopped or vehicle retired)'),
  NOTHING_TO_REPLAY: b('客户端还没有发送过上报', 'The client has not sent a report yet'),
});

export const REPORT_RESULT_LABELS: Record<string, Bilingual> = {
  ACCEPTED: b('已接收', 'Accepted'),
  STALE: b('较旧，仅入历史', 'Older; history only'),
  REPLAYED: b('重复上报，已忽略', 'Duplicate; ignored'),
  QUEUED: b('离线，已暂存待补报', 'Offline; queued'),
};

/** Statuses a client reports for its controllers, nodes, policies and files. */
export const CLIENT_ITEM_STATUS_LABELS: Record<string, Bilingual> = {
  CONFIGURED: b('已配置', 'Configured'),
  DISABLED: b('已关闭（车辆组开关）', 'Switched off (group switch)'),
  RUNNING: b('运行中', 'Running'),
  STOPPED: b('已停止', 'Stopped'),
  PASS: b('通过', 'Pass'),
  FAIL: b('失败', 'Fail'),
  CONSISTENT: b('一致', 'Consistent'),
  PARTIAL_FAILURE: b('部分失败', 'Partial failure'),
  UNKNOWN: b('未知', 'Unknown'),
};

// Subsystem (domain) integration
Object.assign(ERROR_LABELS, {
  CROSS_DOMAIN_SOURCE: b('该 Feature 属于其他域，不能纳入本域的子系统集成', 'The Feature belongs to another domain; a subsystem merge takes only its own domain'),
  SCOPE_OUTSIDE_WORKSPACE: b('该工作区不负责这个集成范围', 'This workspace does not integrate that scope'),
  SUBSYSTEM_NOT_ALLOWED: b('子系统集成只收集本域 Feature，会自动包含本域当前的子系统发布', 'A subsystem merge takes Features only; it includes the domain’s current subsystem release by itself'),
  SUBSYSTEM_CANDIDATE: b('子系统候选由本域发布为子系统，不能发布为 DCL 策略集版本', 'A subsystem candidate is published by its domain as a subsystem release, not promoted to a DCL policy set'),
  NOT_A_SUBSYSTEM_CANDIDATE: b('整车候选应发布为 DCL 策略集版本，而不是子系统发布', 'A whole-vehicle candidate is promoted to a DCL policy set, not published as a subsystem'),
});

export const SUBSYSTEM_STATUS_LABELS: Record<string, Bilingual> = {
  ACTIVE: b('可供整车集成', 'Ready for whole-vehicle integration'),
  INTEGRATING: b('整车集成中', 'In a whole-vehicle candidate'),
  INTEGRATED: b('已纳入正式版本', 'In a formal release'),
  SUPERSEDED: b('已被新子系统发布替代', 'Superseded by a newer subsystem release'),
};

// DCL policy sets and software versions
Object.assign(ERROR_LABELS, {
  INVALID_MANIFEST: b('软件清单格式不对：信号为点分标识符，数据源为 单元:/绝对目录', 'The software manifest is malformed: signals are dotted identifiers, sources UNIT:/absolute/directory'),
  MANIFEST_RECORDED: b('该软件版本已有软件清单，不能替换', 'This software version already has a manifest; it is never replaced'),
  MANIFEST_MISSING: b('该软件版本还没有软件清单，无法逐条检查策略；请车辆资源先登记清单', 'The software version has no manifest, so policies cannot be checked; vehicle resources record it first'),
  ALREADY_APPLIES: b('该策略集已适用于这个软件版本', 'The policy set already applies to this software version'),
  APPLICABILITY_SHADOWED: b('已有更新的策略集适用于这个软件版本，确认旧策略集不会生效', 'A newer policy set already applies to this software version; confirming an older one would change nothing'),
  CHECK_OPEN: b('该策略集与软件版本已有进行中的适用性确认单', 'An applicability check for this set and version is already open'),
  CHECK_CLOSED: b('适用性确认单已关闭', 'The applicability check is closed'),
  CHECK_NOT_VERIFIED: b('集成测试尚未确认该策略集在此软件上通过', 'Integration testing has not verified the set on this software'),
  INCOMPATIBLE_POLICIES: b('部分策略需要的信号或数据源在该软件中不存在，需发布修改后的策略集', 'Some policies need signals or sources the software lacks; publish a changed policy set instead'),
  NOT_APPLICABLE: b('该策略集并不适用于这个软件版本', 'The policy set does not apply to this software version'),
  PRODUCTION_GROUP_BASE: b('量产车辆组总是取软件版本当前适用的策略集，不能指定显式基线', 'Production groups always take the set in effect for their software; they have no explicit base'),
  POLICY_NOT_SWITCHABLE: b('只能关闭其他业务分组的策略；本分组的策略只能通过提交修改', 'Only other business groups’ policies can be switched off; a group changes its own policies by commit'),
});

/** How a DCL policy set version reads: 策略集 1.0.0 / Policy set 1.0.0. */
export const setName = (version: string): Bilingual => b(`策略集 ${version}`, `Policy set ${version}`);

export const CHECK_STATUS_LABELS: Record<string, Bilingual> = {
  OPEN: b('待测试', 'Open'),
  TESTING: b('测试中', 'Testing'),
  VERIFIED: b('集成测试已确认', 'Verified'),
  CONFIRMED: b('已确认适用', 'Confirmed'),
  SUPERSEDED: b('已被替代', 'Superseded'),
  CANCELLED: b('已取消', 'Cancelled'),
};

export const CHECK_STATUS_COLORS: Record<string, string> = { OPEN: 'gold', TESTING: 'processing', VERIFIED: 'cyan', CONFIRMED: 'green', SUPERSEDED: 'default', CANCELLED: 'default' };

export const COMPATIBILITY_LABELS: Record<string, Bilingual> = {
  OK: b('可运行', 'Runs'),
  MISSING: b('缺少信号或数据源', 'Missing signals or sources'),
  UNKNOWN: b('无软件清单，无法检查', 'No manifest, cannot check'),
};

export const GROUP_EVENT_LABELS: Record<string, Bilingual> = {
  CREATED: b('创建', 'Created'),
  MEMBER_ADDED: b('加入车辆', 'Vehicle added'),
  MEMBER_REMOVED: b('移出车辆', 'Vehicle removed'),
  BOUND: b('发布', 'Published'),
  BASE_SET: b('设置基线', 'Base set'),
  ARCHIVED: b('归档', 'Archived'),
  APPROVAL_REQUIRED: b('下发需审批', 'Approval required'),
  APPROVAL_NOT_REQUIRED: b('直接下发', 'Direct dispatch'),
};
