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
  MAINLINE_DECLINED: b('补丁修复不合入主线', 'Patch fix not merged into the mainline'),
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
  WORKSPACE_ARCHIVED: b('工作区已归档，恢复前不能操作', 'the workspace is archived; nothing acts in it until it is restored'),
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

/** Dispatch (下发) and push (推送) are separate: a pending target is pushed once the vehicle is on and connected. */
export const DELIVERY_STATE_LABELS: Record<string, Bilingual> = {
  QUEUED: b('待放量', 'Queued'),
  NOT_PUSHED: b('已下发·待推送', 'Dispatched, not pushed'),
  PUSHED: b('已推送·待回执', 'Pushed, awaiting receipt'),
  APPLIED: b('已生效', 'Applied'),
  FAILED: b('失败', 'Failed'),
  CANCELLED: b('已取消', 'Cancelled'),
};
export const DELIVERY_STATE_COLORS: Record<string, string> = {
  QUEUED: 'default',
  NOT_PUSHED: 'default',
  PUSHED: 'processing',
  APPLIED: 'success',
  FAILED: 'error',
  CANCELLED: 'default',
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
  RECEIPT_HELD: b('车辆已应用这次尝试，回执等待补发', 'The vehicle already applied this attempt; its receipt waits to be sent again'),
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
  TARGET_CHANGED: b('目标策略集已变化，请重新预览', 'The target policy set changed; preview again'),
  SOURCE_CHANGED: b('来源 Feature 在预览后有变化，请重新预览', 'A source Feature changed since the preview; preview again'),
  CANDIDATE_OPEN: b('本工作区在这条线上还有未结束的集成候选', 'An open candidate exists in this workspace on this line'),
  NOT_A_PATCH_TARGET: b('补丁只能以仍有整车软件版本在用的旧策略集为目标，不能是主线', 'A patch targets an older policy set still in effect for some software, not the mainline'),
  PATCH_FEATURES_ONLY: b('同软件版本补丁是整车合并，只收 Verified Feature', 'A same-software patch is a whole-vehicle merge of Verified Features'),
  NOT_PATCHED: b('该 Feature 不是进入补丁后待合入主线的 Verified Feature', 'Not a Verified Feature from a patch waiting for the mainline'),
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
  RESOURCE_BUDGET: b('有策略单次采集就超出车型资源预算，DCL 不能确认', 'A policy’s single capture exceeds the vehicle model’s budget; DCL cannot confirm'),
  INVALID_BUDGET: b('预算值必须为正数，触发上限为整数', 'Budget values must be positive; the trigger limit a whole number'),
  NO_VEHICLE_BUDGET: b('该车辆没有单独的预算', 'The vehicle has no budget of its own'),
  REQUEST_PENDING: b('该车辆对这条策略已有等待执行的售后请求', 'The vehicle already has a pending after-sales request for this policy'),
  REQUEST_ANSWERED: b('车辆已处理该请求', 'The vehicle already answered the request'),
  TECHNICAL_BINDINGS_ONLY: b('DCL 技术变更只能调整处理绑定，不能改文件、策略或引用', 'A DCL technical change only changes processing bindings, never files, policies or references'),
  NOTHING_TO_REBIND: b('基线中没有该业务分组的文件可以调整', 'The base has no files of this group to rebind'),
  ALREADY_LATEST: b('引用已经固定在对方最新的已提交版本', 'The reference already pins the owner’s latest committed version'),
  NOT_TECHNICAL: b('只有 DCL 技术变更可以这样调整；业务 Feature 请在接入中调整', 'Only a DCL technical change is rebound this way; adjust a business Feature in intake'),
  PATCH_FIX_MISSING: b('该软件版本运行着补丁，补丁里的修复尚未合入主线（或写明不合入）', 'That software runs a patch whose fixes have not reached the mainline (or been closed for it)'),
  VEHICLE_RETIRED: b('报废的车辆不能恢复使用', 'A retired vehicle stays retired'),
  SIMULATION_QUOTA: b('工作区的仿真运行配额已用满，请先停止一个', 'The workspace runs as many simulations as its quota allows; stop one first'),
  INVALID_QUOTA: b('配额须为 0 或正整数', 'A quota is a whole number, 0 or more'),
  QUOTA_BELOW_RUNNING: b('配额不能低于正在运行的仿真数量，请先停止', 'A quota cannot be below the simulations running now; stop some first'),
  NOT_UPLOADING: b('车辆没有在上传这次采集（排队、未保留或被抑制）', 'The vehicle is not uploading this capture (waiting, dropped or suppressed)'),
  COLLECTION_PAUSED: b('该车辆的采集已紧急暂停', 'Collection on this vehicle is paused'),
  ALREADY_PAUSED: b('该车辆的采集已经暂停', 'Collection on this vehicle is already paused'),
  NOT_PAUSED: b('该车辆的采集没有暂停', 'Collection on this vehicle is not paused'),
  PAUSE_UNCONFIRMED: b('车辆尚未确认暂停，确认后才能恢复', 'The vehicle has not confirmed the pause yet'),
  NOTHING_TO_CONFIRM: b('没有待车辆确认的暂停或恢复', 'No pause or resume waiting for the vehicle'),
  DCL_VERSION_NOT_NEWER: b('主线版本必须高于本车型已有的所有策略集版本', 'A mainline version must be newer than every policy set of the model'),
  PATCH_VERSION_LINE: b('补丁沿目标的 major.minor 编号，并高于该系列已有的版本', 'A patch is numbered in its target’s major.minor line, above every set of that line'),
  PATCH_VERSION_OUTSIDE_TARGET: b('补丁只能适用目标策略集正在服务的整车软件版本', 'A patch applies only to the software versions its target is in effect for'),
  NO_VEHICLE_VERSIONS: b('请选择适用的整车软件版本', 'Choose the whole-vehicle software versions it applies to'),
  VERSION_NOT_TESTED: b('部分适用版本没有通过的集成测试', 'Some listed software versions have no passing integration test'),
  OTA_BLOCKED: b('OTA 被拒绝：并非所有车辆都满足条件', 'OTA blocked: not every vehicle qualifies'),
  NOTHING_TO_ROLL_OUT: b('所有车辆都已运行该策略集', 'Every vehicle already runs this policy set'),
  OTA_PAUSED: b('OTA 已暂停，请先恢复', 'The rollout is paused; resume it first'),
  OTA_WAVE_PENDING: b('已下发的车辆尚未全部回执成功，暂不能扩大范围', 'Vehicles already sent have not all applied it yet; the rollout cannot be expanded'),
  OTA_CLOSED: b('OTA 已结束', 'The rollout is finished'),
  OTA_NOT_RUNNING: b('只有进行中的 OTA 可以暂停', 'Only a running rollout can be paused'),
  OTA_NOT_PAUSED: b('OTA 未暂停', 'The rollout is not paused'),
  NOTHING_QUEUED: b('请选择待放量的车辆', 'Choose queued vehicles'),
  ROLLBACK_BLOCKED: b('回滚被拒绝：并非所有车辆都能回到兼容的上一正式配置', 'Rollback blocked: not every vehicle can return to a compatible earlier formal configuration'),
});

export const EVENT_STATUS_LABELS: Record<string, Bilingual> = {
  HELD: b('预算排队', 'Waiting for budget'),
  UPLOADING: b('车端上传中', 'Uploading'),
  PROCESSING: b('云端处理中', 'Processing'),
  DONE: b('处理完成', 'Processed'),
  FAILED: b('处理失败', 'Failed'),
  DROPPED: b('未保留', 'Dropped'),
  SUPPRESSED: b('洪峰抑制', 'Suppressed (flood)'),
};
export const EVENT_STATUS_COLORS: Record<string, string> = { HELD: 'gold', UPLOADING: 'processing', PROCESSING: 'processing', DONE: 'green', FAILED: 'red', DROPPED: 'volcano', SUPPRESSED: 'default' };

/** Why the vehicle's budget guard acted on a capture. */
export const BUDGET_NOTE_LABELS: Record<string, Bilingual> = {
  CPU: b('超出每小时 CPU 预算', 'over the hourly CPU budget'),
  IO: b('超出每小时存储预算', 'over the hourly storage budget'),
  MEMORY: b('车端缓存已满', 'vehicle buffer full'),
  NETWORK: b('单次超出每小时上传预算', 'larger than an hour’s upload budget'),
  EVICTED: b('为高优先级采集让出缓存', 'evicted for a HIGH-priority capture'),
  FLOOD: b('超过策略每小时触发上限', 'over the policy’s hourly trigger limit'),
  EMERGENCY_HOLD: b('紧急停采', 'emergency collection pause'),
  OVER_BUDGET_HIGH: b('高优先级，超预算仍采集', 'HIGH priority, collected over budget'),
  DEFERRED: b('售后优先，Grader 延迟', 'deferred: after-sales first'),
};

/** Where a capture came from. */
export const CAPTURE_SOURCE_LABELS: Record<string, Bilingual> = {
  TRIGGER: b('触发', 'Trigger'),
  AFTERSALES: b('售后', 'After-sales'),
  GRADER: b('Grader', 'Grader'),
};
export const CAPTURE_SOURCE_COLORS: Record<string, string> = { TRIGGER: 'default', AFTERSALES: 'magenta', GRADER: 'cyan' };

export const CAPTURE_REQUEST_LABELS: Record<string, Bilingual> = {
  PENDING: b('等待车辆执行', 'Waiting for the vehicle'),
  CAPTURED: b('已采集', 'Captured'),
  CANCELLED: b('已取消', 'Cancelled'),
};
export const CAPTURE_REQUEST_COLORS: Record<string, string> = { PENDING: 'processing', CAPTURED: 'green', CANCELLED: 'default' };

/** The four budget dimensions. */
export const BUDGET_DIMENSION_LABELS: Record<string, Bilingual> = {
  cpu: b('CPU', 'CPU'),
  memory: b('内存（车端缓存）', 'memory (buffer)'),
  io: b('存储 IO', 'storage IO'),
  network: b('上传网络', 'upload network'),
};

export const POLICY_BUDGET_LABELS: Record<string, Bilingual> = {
  OK: b('在预算内', 'Within budget'),
  MAY_THROTTLE: b('高频时会被限流', 'May be throttled'),
  NEVER_FITS: b('单次就超出预算', 'Never fits'),
};
export const POLICY_BUDGET_COLORS: Record<string, string> = { OK: 'green', MAY_THROTTLE: 'gold', NEVER_FITS: 'red' };

export const BUDGET_SOURCE_LABELS: Record<string, Bilingual> = {
  VEHICLE: b('车辆单独预算', 'vehicle override'),
  MODEL: b('车型预算', 'model budget'),
  DEFAULT: b('默认预算', 'default budget'),
};

/** A vehicle's collection pause (紧急停采). */
export const HOLD_STATE_LABELS: Record<string, Bilingual> = {
  PAUSING: b('停采待车辆确认', 'Pause awaiting the vehicle'),
  PAUSED: b('采集已暂停', 'Collection paused'),
  RESUMING: b('恢复待车辆确认', 'Resume awaiting the vehicle'),
  ACTIVE: b('采集中', 'Collecting'),
};
export const HOLD_STATE_COLORS: Record<string, string> = { PAUSING: 'orange', PAUSED: 'red', RESUMING: 'orange', ACTIVE: 'green' };

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
  PERSONAL: b('本人刚下发的个人配置', 'Personal configuration its owner just sent'),
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

/** Faults a simulated vehicle plays when it applies a configuration (prototype tool). */
export const DEVICE_FAULT_LABELS: Record<string, Bilingual> = {
  NONE: b('无', 'None'),
  CHECKSUM: b('配置包校验失败', 'Package checksum fails'),
  SIGNATURE: b('配置包签名无效', 'Package signature invalid'),
  APPLY_INTERRUPTED: b('应用中断', 'Apply interrupted'),
  DROP_RECEIPT: b('回执丢失', 'Receipt lost'),
};

export const REPORT_RESULT_LABELS: Record<string, Bilingual> = {
  ACCEPTED: b('已接收', 'Accepted'),
  STALE: b('较旧，仅入历史', 'Older; history only'),
  REPLAYED: b('重复上报，已忽略', 'Duplicate; ignored'),
  QUEUED: b('离线，已暂存待补报', 'Offline; queued'),
};

/** Statuses a client reports for its controllers, nodes, policies and files. */
export const CLIENT_ITEM_STATUS_LABELS: Record<string, Bilingual> = {
  CONFIGURED: b('已配置', 'Configured'),
  DISABLED: b('已关闭（下发时关闭）', 'Switched off at dispatch'),
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
  POLICY_NOT_IN_SET: b('该策略不在这个策略集中', 'The policy is not in this policy set'),
  SET_NOT_IN_EFFECT: b('该策略集当前不适用于任何软件版本，无需紧急停用', 'The policy set is in effect for no software version; there is nothing to stop'),
  STOP_PENDING: b('该策略已有待决定的紧急停用申请', 'A stop of this policy is already waiting for a decision'),
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
  LENT_OUT: b('借出至', 'Lent to'),
  BORROWED_IN: b('借用加入', 'Borrowed in'),
  LOAN_RETURNED: b('借用归还', 'Loan returned'),
  LOAN_RECALLED: b('借用收回', 'Loan recalled'),
  BOUND: b('发布', 'Published'),
  BASE_SET: b('设置基线', 'Base set'),
  ARCHIVED: b('归档', 'Archived'),
  APPROVAL_REQUIRED: b('下发需审批', 'Approval required'),
  APPROVAL_NOT_REQUIRED: b('直接下发', 'Direct dispatch'),
};

export const STOP_STATUS_LABELS: Record<string, Bilingual> = {
  REQUESTED: b('待批准', 'Awaiting decision'),
  APPROVED: b('已批准', 'Approved'),
  REJECTED: b('已拒绝', 'Rejected'),
};

export const STOP_STATUS_COLORS: Record<string, string> = { REQUESTED: 'gold', APPROVED: 'red', REJECTED: 'default' };

// Company directory and base grants
Object.assign(ERROR_LABELS, {
  DIRECTORY_MANAGED: b('该组织节点来自公司目录，只能在目录中修改', 'This unit mirrors the company directory; change it there'),
  DIRECTORY_NOT_CONNECTED: b('本安装未接入公司目录', 'This installation has no company directory'),
  DIRECTORY_USERNAME_TAKEN: b('目录中已有这个账号名', 'The directory already has this username'),
  PERSON_LEFT: b('该人员已离职', 'The person has left'),
  SAME_DEPARTMENT: b('请选择另一个部门', 'Choose another department'),
  NO_REVIEW_PENDING: b('该账号没有待复核的授权', 'The account has no grants waiting for review'),
  UNIT_NOT_TEAM: b('基础权限跟随团队组织，请选择团队组织节点', 'Base rights follow the team organization; choose a team unit'),
  GRANT_NOT_BASE_ELIGIBLE: b('按组织规则只能授予研发环境的业务研发；其他权限须显式授予到人', 'Org rules only give business development in the development environment; other rights are granted to people explicitly'),
  RULE_ARCHIVED: b('该授权规则已停用', 'The rule is already archived'),
});

export const SYNC_KIND_LABELS: Record<string, Bilingual> = {
  UNIT_CREATED: b('新建组织节点', 'Unit created'),
  UNIT_RENAMED: b('组织节点改名', 'Unit renamed'),
  UNIT_MOVED: b('组织节点移动', 'Unit moved'),
  UNIT_ARCHIVED: b('组织节点撤销', 'Unit removed'),
  ACCOUNT_CREATED: b('新建账号', 'Account created'),
  ACCOUNT_LINKED: b('关联已有账号', 'Account linked'),
  ACCOUNT_MOVED: b('人员调岗', 'Person moved'),
  ACCOUNT_DISABLED: b('离职停用', 'Disabled (left)'),
  ACCOUNT_REACTIVATED: b('重新启用', 'Reactivated'),
  ACCOUNT_SKIPPED: b('跳过', 'Skipped'),
  PERSONAL_SIMS_RELEASED: b('释放个人仿真', 'Personal simulations released'),
};

// Personal simulation (个人研发仿真)
Object.assign(ERROR_LABELS, {
  PERSONAL_SIM_OWNER: b('个人仿真只能由创建人本人操作', 'Only its owner uses a personal simulation'),
  PERSONAL_SIMULATION: b('个人仿真不能加入工作区车辆、车辆组或团队测试', 'A personal simulation never joins workspace vehicles, vehicle groups or team tests'),
  NOT_PERSONAL_SIMULATION: b('这不是个人仿真', 'This is not a personal simulation'),
  PERSONAL_QUOTA: b('个人仿真配额已用完（每个工作区 3 个），请先释放一个', 'Personal simulation quota used up (3 per workspace); release one first'),
  PERSONAL_DEVELOPMENT_ONLY: b('个人仿真只能用于研发环境', 'Personal simulations run in the development environment only'),
  PERSONAL_GROUP_MISMATCH: b('个人仿真只运行本工作区、本业务分组的 Feature 草稿', 'A personal simulation runs drafts of its own business group in its own workspace'),
  PERSONAL_SIM_RELEASED: b('该个人仿真已释放', 'The personal simulation was released'),
  PERSONAL_NOT_APPLIED: b('仿真上还没有生效的草稿配置；请先配置草稿并等待回执', 'The simulation runs no draft yet; configure it and wait for the receipt'),
  PERSONAL_TRIAL_ONLY: b('个人仿真只能试触发，不产生采集事件', 'A personal simulation only makes trial captures, never collection events'),
  DRAFT_NOT_RUNNABLE: b('草稿还有问题，修正后才能运行', 'The draft has problems; fix them before running it'),
  SENSITIVE_NOT_REVIEWED: b('敏感文件须先通过 DCL 审核，个人仿真也不能采集', 'Sensitive files need a current DCL approval first, even on a personal simulation'),
  CONFIG_ALREADY_APPLIED: b('仿真已在运行这份草稿和基线', 'The simulation already runs this draft on this base'),
  INVALID_RESULT: b('结果只能是 PASS 或 FAIL', 'The result is PASS or FAIL'),
  BASE_CONFLICT: b('该基线已改变本 Feature 的业务分组，请在新基线上新建 Feature', 'The base changed this Feature’s business group; start a Feature on it'),
  NO_BASE: b('没有适用于该软件版本的策略集，请指定显式基线', 'No policy set applies to this software; choose an explicit base'),
});

// Simulation software (仿真车软件)
Object.assign(ERROR_LABELS, {
  IMAGE_CHANGE_PENDING: b('仿真正在等待镜像变更结果，请先确认或撤回', 'The simulation is waiting for an image change; answer or withdraw it first'),
  IMAGE_NOT_IN_CATALOG: b('派生镜像只属于构建它的仿真，请选择平台镜像目录中的镜像', 'A derived image belongs to the simulation that built it; choose a catalog image'),
  DERIVED_DEVELOPMENT_ONLY: b('派生镜像只用于研发环境仿真；集成测试使用平台正式镜像', 'Derived images run on development simulations only; integration tests use catalog images'),
  UNKNOWN_MODULE: b('该模块未接入构建服务', 'The module is not connected to the build provider'),
  INVALID_REPOSITORY: b('请填写 GitHub 仓库地址：https://github.com/<owner>/<repo>', 'Use a GitHub repository address: https://github.com/<owner>/<repo>'),
  INVALID_REF: b('源码版本只能是分支、Tag 或 Commit（字母、数字与 . _ / -）', 'The ref is a branch, tag or commit (letters, digits, . _ / -)'),
  NO_IMAGE: b('仿真没有运行镜像', 'The simulation runs no image'),
  BUILD_OPEN: b('已有未完成的构建，请先部署或取消', 'An open build exists; deploy or cancel it first'),
  BUILD_CLOSED: b('构建任务已结束', 'The build is closed'),
  BUILD_NOT_DEPLOYABLE: b('该构建没有可部署的镜像', 'The build has no image to deploy'),
  STALE_BUILD: b('仿真的运行镜像已不是构建时的基础镜像，请重新构建', 'The simulation no longer runs the image the build started from; build again'),
  SAME_IMAGE: b('仿真已在运行该镜像', 'The simulation already runs this image'),
  NOTHING_TO_ROLL_BACK: b('没有可回滚的镜像变更（回滚只能执行一次）', 'No image change to roll back (a rollback is done once)'),
});

export const BUILD_STATUS_LABELS: Record<string, Bilingual> = {
  REQUESTED: b('待构建', 'Requested'),
  BUILT: b('已构建', 'Built'),
  BUILD_FAILED: b('构建失败', 'Build failed'),
  CANCELLED: b('已取消', 'Cancelled'),
  DEPLOYED: b('已部署', 'Deployed'),
};
export const BUILD_STATUS_COLORS: Record<string, string> = { REQUESTED: 'processing', BUILT: 'blue', BUILD_FAILED: 'red', CANCELLED: 'default', DEPLOYED: 'green' };

export const IMAGE_CHANGE_KIND_LABELS: Record<string, Bilingual> = {
  SWITCH: b('切换基础镜像', 'Base image switch'),
  DEPLOY: b('部署构建', 'Build deployed'),
  ROLLBACK: b('回滚', 'Rollback'),
};
export const IMAGE_CHANGE_STATUS_LABELS: Record<string, Bilingual> = {
  PENDING: b('等待仿真服务', 'Waiting for the provider'),
  APPLIED: b('已生效', 'Applied'),
  FAILED: b('失败', 'Failed'),
  CANCELLED: b('已撤回', 'Withdrawn'),
};
export const IMAGE_CHANGE_STATUS_COLORS: Record<string, string> = { PENDING: 'processing', APPLIED: 'green', FAILED: 'red', CANCELLED: 'default' };

// Vehicle software changes (整车软件版本变化)
Object.assign(ERROR_LABELS, {
  NOT_A_TEAM_CHANGE: b('这次变化没有需要车辆组团队确认的内容', 'This change has no vehicle group team to confirm it'),
  ALREADY_ACKNOWLEDGED: b('已经确认过', 'Already confirmed'),
});

export const CHANGE_OUTCOME_LABELS: Record<string, Bilingual> = {
  NONE: b('无需修改', 'No change needed'),
  FIX: b('需修改本组文件或策略', 'Fix the group’s files or policies'),
  REPUBLISH: b('基线已变化，需重新下发', 'Base changed; publish again'),
  NEW_FEATURE: b('基线改了本组内容，需在新基线上新建 Feature', 'The new base changed this group; start a Feature on it'),
  NO_BASE: b('新软件没有适用的策略集', 'No policy set applies to the new software'),
  UNKNOWN_SOFTWARE: b('整车软件版本未知，无法检查', 'Software version unknown; cannot check'),
  CANNOT_CHECK: b('新软件没有软件清单，无法检查', 'The new software has no manifest; cannot check'),
  PRODUCTION: b('量产车按适用的策略集处理', 'Production: the set in effect applies'),
  NOT_PUBLISHED: b('车辆组没有发布 Feature', 'No Feature published to its group'),
  UNRECORDED: b('上报的版本尚未登记', 'Reported version not recorded yet'),
};
export const CHANGE_OUTCOME_COLORS: Record<string, string> = {
  NONE: 'green',
  FIX: 'orange',
  REPUBLISH: 'gold',
  NEW_FEATURE: 'red',
  NO_BASE: 'red',
  UNKNOWN_SOFTWARE: 'default',
  CANNOT_CHECK: 'default',
  PRODUCTION: 'default',
  NOT_PUBLISHED: 'default',
  UNRECORDED: 'purple',
};

export const FILE_CHECK_LABELS: Record<string, Bilingual> = {
  OK: b('可用', 'OK'),
  SOURCE_MISSING: b('来源缺失', 'Source missing'),
  REFERENCE_CHANGED: b('引用文件已变化', 'Referenced file changed'),
  REFERENCE_REMOVED: b('引用文件已删除', 'Referenced file removed'),
};

export const POLICY_CHECK_LABELS: Record<string, Bilingual> = {
  OK: b('可运行', 'Runnable'),
  MISSING: b('有问题', 'Problem'),
  UNKNOWN: b('无法检查', 'Cannot check'),
};

export const SOFTWARE_SOURCE_LABELS: Record<string, Bilingual> = {
  CLIENT_REPORT: b('客户端上报', 'Client report'),
  CONFIRMED: b('车辆资源确认', 'Vehicle resources confirmation'),
  CONTROLLERS: b('域控上报', 'Controller report'),
};

// Delivery and following the group (下发与推送、跟随车辆组)
Object.assign(ERROR_LABELS, {
  NOT_IN_VEHICLE_GROUP: b('车辆不在任何车辆组中', 'The vehicle routes through no vehicle group'),
  NO_FEATURE_PUBLICATION: b('车辆组还没有下发过 Feature，请按车辆组下发', 'Nothing of a Feature was dispatched to the group yet; dispatch to the group'),
});
export const FOLLOW_REASON_LABELS: Record<string, Bilingual> = {
  JOINED: b('加入车辆组', 'Joined the group'),
  SOFTWARE_UPDATED: b('整车软件已更新', 'Software updated'),
};
export const DEPLOYMENT_TRIGGER_LABELS: Record<string, Bilingual> = {
  DISPATCH: b('下发', 'Dispatch'),
  GROUP_FOLLOW: b('随车辆组推送', 'Pushed to follow the group'),
};

// Whole-vehicle software updates (整车软件更新)
Object.assign(ERROR_LABELS, {
  SOFTWARE_UPDATE_PENDING: b('车辆正在等待整车软件更新，请等待结果或撤回', 'The vehicle is waiting for a software update; wait for it or withdraw it'),
  NOT_IN_TEAM_GROUP: b('车辆不在业务组的车辆组中，请由工作区管理员更新', 'The vehicle is in no business group’s vehicle group; ask the workspace admin'),
  PRODUCTION_SOFTWARE: b('量产车只能通过整车 OTA 计划更换软件', 'Production vehicles change software only through the vehicle OTA program'),
  SOFTWARE_NOT_RECORDED: b('该整车软件版本尚未登记', 'This software version is not recorded'),
  SAME_SOFTWARE: b('车辆已经运行这个版本', 'The vehicle already runs this version'),
});
export const SOFTWARE_REQUEST_STATUS_LABELS: Record<string, Bilingual> = {
  PENDING: b('等待整车 OTA', 'Waiting for vehicle OTA'),
  APPLIED: b('已完成', 'Done'),
  FAILED: b('失败', 'Failed'),
  CANCELLED: b('已撤回', 'Withdrawn'),
};
export const SOFTWARE_REQUEST_STATUS_COLORS: Record<string, string> = { PENDING: 'processing', APPLIED: 'green', FAILED: 'red', CANCELLED: 'default' };

// Borrowing (借用) and simulated time
Object.assign(ERROR_LABELS, {
  LOAN_NOT_LENDABLE: b('该车辆不能借用：量产车、个人仿真、已报废车辆和其他车型都不能借', 'This vehicle cannot be lent: production, personal, retired and other-model vehicles never are'),
  ALREADY_IN_WORKSPACE: b('车辆已经在本工作区中', 'The vehicle is already in this workspace'),
  LOAN_OPEN: b('本工作区已有该车辆的借用申请或借用', 'This workspace already has an open loan of the vehicle'),
  LOAN_TARGET_GROUP: b('请选择本工作区一个可用的、环境相同的研发或测试车辆组', 'Choose an active development or testing vehicle group of this workspace, in the vehicle’s environment'),
  INVALID_DUE_DATE: b('归还日期须晚于今天（延期时晚于原日期），且不超过 90 天', 'The last day is after today (and the current one, when extending) and at most 90 days ahead'),
  LOAN_PURPOSE_REQUIRED: b('请说明借用用途', 'Say what the vehicle is borrowed for'),
  LOAN_NOT_PENDING: b('借用申请已经结束', 'The loan request is no longer open'),
  ALREADY_ANSWERED: b('该工作区已经答复过', 'This workspace already answered'),
  LENDER_NOT_AGREED: b('须先由正在使用该车的工作区同意', 'Every workspace using the vehicle agrees first'),
  LOAN_NOT_APPROVABLE: b('车辆现在不能借出', 'The vehicle cannot be lent now'),
  LOAN_NOT_ACTIVE: b('借用不在进行中', 'The loan is not active'),
  EXTENSION_PENDING: b('已有延期申请在等待车辆资源处理', 'An extension is already waiting for vehicle resources'),
  NO_EXTENSION_PENDING: b('没有待处理的延期申请', 'No extension is waiting'),
  VEHICLE_ON_LOAN: b('车辆借用中：只有借用方可以使用，借用方只能通过归还移出', 'The vehicle is on loan: only the borrower uses it, and returns it to let it go'),
  INVALID_CLOCK_STEP: b('每次可将时间推进 1 到 30 天', 'Move the clock forward 1 to 30 days'),
  LOAN_NOT_NEEDED: b('这辆车在本工作区的资源池中且无人使用，请直接加入', 'The vehicle is in this workspace’s pools and nobody uses it; add it directly'),
});
export const LOAN_STATUS_LABELS: Record<string, Bilingual> = {
  REQUESTED: b('待审批', 'Requested'),
  TO_AGREE: b('待使用方同意', 'Waiting for lenders'),
  TO_APPROVE: b('待车辆资源批准', 'Waiting for vehicle resources'),
  APPROVED: b('借用中', 'On loan'),
  OVERDUE: b('已到期', 'Overdue'),
  REJECTED: b('未批准', 'Rejected'),
  WITHDRAWN: b('已撤回', 'Withdrawn'),
  RETURNED: b('已归还', 'Returned'),
  RECALLED: b('已收回', 'Recalled'),
};
export const LOAN_STATUS_COLORS: Record<string, string> = {
  REQUESTED: 'processing',
  TO_AGREE: 'processing',
  TO_APPROVE: 'processing',
  APPROVED: 'green',
  OVERDUE: 'red',
  REJECTED: 'default',
  WITHDRAWN: 'default',
  RETURNED: 'default',
  RECALLED: 'orange',
};
export const LENDER_DECISION_LABELS: Record<string, Bilingual> = {
  PENDING: b('待同意', 'To agree'),
  AGREED: b('已同意', 'Agreed'),
  DECLINED: b('不同意', 'Declined'),
};
export const EXTENSION_STATUS_LABELS: Record<string, Bilingual> = {
  PENDING: b('延期待审批', 'Extension requested'),
  APPROVED: b('延期已批准', 'Extension approved'),
  REJECTED: b('延期未批准', 'Extension rejected'),
};

// Vehicle environments and organization lifecycle (资源环境迁移、归档与恢复)
Object.assign(ERROR_LABELS, {
  INVALID_ENV: b('未知的环境', 'Unknown environment'),
  SAME_ENVIRONMENT: b('车辆已经在该环境', 'The vehicle is already in that environment'),
  ENV_MOVE_BLOCKED: b('车辆现在不能变更环境：请先结束下列事项', 'The vehicle cannot move now: finish these first'),
  ARCHIVE_BLOCKED: b('现在不能归档：请先结束下列事项', 'Cannot archive yet: finish these first'),
  RESTORE_BLOCKED: b('现在不能恢复：所依赖的对象已归档', 'Cannot restore: what it stands on is archived'),
  NOT_ARCHIVED: b('该对象没有归档', 'It is not archived'),
  ALREADY_ARCHIVED: b('该对象已经归档', 'It is already archived'),
});
export const LIFECYCLE_KIND_LABELS: Record<string, Bilingual> = {
  ARCHIVED: b('归档', 'Archived'),
  RESTORED: b('恢复', 'Restored'),
};

// Integration calls (集成征集) and the release history (发布记录)
Object.assign(ERROR_LABELS, {
  VERSION_PLANNED: b('这是集成征集的规划版本：只能由该征集的发布列入，不能另做适用性确认', 'A planned version of an integration call: only that call’s release lists it, and it takes no applicability check'),
  PLANNED_VERSION_IN_PRODUCTION: b('规划版本还没有发布，量产车只能运行已发布的软件', 'The planned version is not released; production vehicles run released software only'),
  CALL_CLOSED: b('该集成征集已经结束', 'The integration call is closed'),
  PARENT_CALL_REQUIRED: b('域子征集要响应一个整车征集，目标版本跟随整车征集', 'A domain call answers a whole-vehicle call and follows its target'),
  NOT_A_CALL_MODULE: b('该模块不在这个征集的清单里', 'That module is not on this call’s list'),
  CALL_EXISTS: b('这个目标版本已经有一个进行中的征集', 'A call for this target is already open'),
  VERSION_RELEASED: b('这个整车集成版本已经发布过策略集；同软件的修改请走补丁', 'A policy set is already published for this version; change it with a patch'),
  NO_MODULES: b('至少要有一个模块参加', 'At least one module must take part'),
  MODULE_EXCLUDED: b('该模块本次不参加', 'That module does not take part this time'),
  FEATURE_NOT_COLLECTIBLE: b('只能提交本组已验证、可收集的 Feature', 'Submit a Verified Feature of the group that can be collected'),
  NOTHING_TO_REMIND: b('所有模块都已答复，没有要催办的', 'Every module has answered; there is no one to remind'),
  NOTHING_SUBMITTED: b('该模块还没有提交，无需退回', 'That module has submitted nothing to send back'),
  TARGET_FIXED: b('已经送测，测试证据绑定了目标版本，不能再改', 'A round was sent to testing; its evidence is bound to the target, which can no longer change'),
  CALL_CHANGED: b('有模块提交了变更或还没答复，不能按"无变更"结束', 'Some modules submitted changes or have not answered; the call cannot close as unchanged'),
  CALL_ROUND_OPEN: b('本征集的测试集成版本正在测试；要改动模块，请由集成管理员退回模块或取消这一轮', 'This call’s test integration version is being tested; to change a module, the integration admin sends it back or cancels the round'),
  CALL_INCOMPLETE: b('还没收齐：下列模块未提交、被退回或提交已失效', 'Not complete yet: these modules have not submitted, were sent back, or their submission changed'),
  CALL_ROUND_STALE: b('这个预览已不是征集当前的一轮，或征集的提交已变化；请重新生成', 'This preview is no longer the call’s current round, or the call’s submissions changed; preview again'),
  CALL_TARGET_MISSING: b('征集的测试集成版本必须列入它的目标版本', 'A call’s test integration version must list its target version'),
});
export const CALL_PHASE_LABELS: Record<string, Bilingual> = {
  COLLECTING: b('征集中', 'Collecting'),
  COMPLETE: b('已收齐', 'Complete'),
  MERGING: b('集成预览', 'Merging'),
  TESTING: b('集成测试中', 'In integration testing'),
  PASSED: b('测试通过，待发布', 'Passed, to release'),
  RELEASED: b('已发布', 'Released'),
  CANCELLED: b('已取消', 'Cancelled'),
  NO_CHANGE: b('本次无变更', 'No change'),
};
export const CALL_PHASE_COLORS: Record<string, string> = {
  COLLECTING: 'processing',
  COMPLETE: 'cyan',
  MERGING: 'blue',
  TESTING: 'gold',
  PASSED: 'green',
  RELEASED: 'success',
  CANCELLED: 'default',
  NO_CHANGE: 'default',
};
export const CALL_MODULE_STATUS_LABELS: Record<string, Bilingual> = {
  WAITING: b('待提交', 'Waiting'),
  SUBMITTED: b('已提交', 'Submitted'),
  NO_CHANGE: b('本次无变更', 'No change'),
  RETURNED: b('已退回', 'Sent back'),
  EXCLUDED: b('不参加', 'Left out'),
  REMINDED: b('已催办', 'Reminded'),
};
export const CALL_MODULE_STATUS_COLORS: Record<string, string> = {
  WAITING: 'processing',
  SUBMITTED: 'green',
  NO_CHANGE: 'cyan',
  RETURNED: 'red',
  EXCLUDED: 'default',
  REMINDED: 'orange',
};
export const ROUND_OUTCOME_LABELS: Record<string, Bilingual> = {
  OPEN: b('进行中', 'Open'),
  CANCELLED: b('已取消', 'Cancelled'),
  RELEASED: b('已发布', 'Released'),
};
export const SOFTWARE_STATUS_LABELS: Record<string, Bilingual> = {
  PLANNED: b('规划中', 'Planned'),
  RECORDED: b('已登记', 'Recorded'),
};
Object.assign(ERROR_LABELS, {
  NO_SET_FOR_VERSION: b('没有适用这个软件版本的策略集，无法导出配置模块', 'No policy set applies to this software version; there is no module to export'),
  MODULE_CURRENT: b('配置模块已经是当前生效的策略集', 'The module already carries the set in effect'),
});
