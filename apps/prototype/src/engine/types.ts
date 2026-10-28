// The prototype's whole platform state. Everything the workflow needs lives here and is
// persisted in the browser; there is no server.

import type { Grant } from '../domain/authz.ts';
import type { Budget, CaptureCost } from '../domain/budget.ts';
import type { ClientReportPayload, SignedReport } from '../domain/client-report.ts';
import type { SoftwareManifest } from '../domain/compatibility.ts';
import type { FileSpecContent, GroupConfig, PolicyContent, Priority } from '../domain/config.ts';
import type { DataSource } from '../domain/data-source.ts';
import type { FileType, Privacy } from '../domain/file-types.ts';
import type { ReviewControls } from '../domain/intake.ts';
import type { Domain, Env, GroupPurpose, Role, Scope, WorkspaceKind } from '../domain/vocabulary.ts';

export const STATE_SCHEMA = 23;

export interface Account {
  username: string;
  displayName: string;
  status: 'ACTIVE' | 'DISABLED';
  /** Explicit grants only; grants from org rules are derived when the account acts. */
  grants: Grant[];
  /** The team org unit the company directory places the person in; null for local accounts. */
  orgUnitId: string | null;
  /** The directory's person id. NULL: a local account the directory never touches. */
  employeeId: string | null;
  /** Explicit grants to review after the person moved to another unit. */
  grantReview: { fromUnitId: string | null; toUnitId: string | null; since: string } | null;
  createdBy: string;
  createdAt: string;
}

/**
 * Base rights for the members of an org unit (按组织授予的基础权限). Each covering rule gives the
 * member one complete grant; special rights are always granted explicitly.
 */
export interface GrantRule {
  id: string;
  orgUnitId: string;
  includeSubunits: boolean;
  role: Role;
  workspaces: string[];
  groups: string[];
  scopes: string[];
  envs: Env[];
  status: 'ACTIVE' | 'ARCHIVED';
  createdBy: string;
  createdAt: string;
}

export interface VehicleModel {
  id: string;
  name: string;
  status: 'ACTIVE' | 'RETIRED';
}

export interface Project {
  id: string;
  name: string;
  vehicleModelId: string | null;
  status: 'ESTABLISHED' | 'ARCHIVED';
}

export interface OrgUnit {
  id: string;
  kind: 'TEAM' | 'PROJECT';
  projectId: string | null;
  parentId: string | null;
  name: string;
  status: 'ACTIVE' | 'ARCHIVED';
  /** DIRECTORY: mirrored from the company directory and read-only here. */
  source: 'PLATFORM' | 'DIRECTORY';
  /** The directory's department id, for DIRECTORY units. */
  externalId: string | null;
}

export interface BusinessGroup {
  id: string;
  code: string;
  name: string;
  domain: Domain;
  purpose: GroupPurpose;
  orgUnitId: string;
  status: 'ACTIVE' | 'ARCHIVED';
}

export interface Workspace {
  id: string;
  name: string;
  kind: WorkspaceKind;
  orgUnitId: string;
  projectId: string | null;
  vehicleModelId: string;
  status: 'ACTIVE' | 'ARCHIVED';
  groupIds: string[];
  scopes: Scope[];
  sourceWorkspaceIds: string[];
}

export interface Pipeline {
  id: string;
  code: string;
  version: number;
  side: 'EDGE' | 'CLOUD';
  name: string;
  formats: string[];
  schemas: string[];
  steps: string[];
  capability: string;
  createdBy: string;
  createdAt: string;
}

export interface Template {
  id: string;
  fileType: FileType;
  version: number;
  format: string;
  schema: string;
  edgePipelineId: string;
  cloudPipelineId: string;
  requiresReview: boolean;
  defaultPrivacy: Privacy;
  defaultRetentionDays: number;
  capability: string;
  createdBy: string;
  createdAt: string;
}

export interface DataItem {
  dataKey: string;
  dataCode: string;
  ownerGroupId: string;
  source: DataSource;
  /** PENDING: registered, not yet committed. REVIEW: overlaps another source, awaiting DCL. */
  status: 'PENDING' | 'REVIEW' | 'ACTIVE' | 'ARCHIVED';
  overlapSuspects: string[];
  reviewNote: string | null;
  createdBy: string;
  createdAt: string;
}

export interface FileSpecVersion {
  id: string;
  dataKey: string;
  version: number;
  digest: string;
  content: FileSpecContent;
  createdBy: string;
  createdAt: string;
}

export interface PolicyVersion {
  id: string;
  policyId: string;
  version: number;
  digest: string;
  content: PolicyContent;
  createdBy: string;
  createdAt: string;
}

export interface ManifestVersion {
  id: string;
  groupId: string;
  version: number;
  digest: string;
  /** Owned files and pinned references, sorted by data key. */
  entries: { dataKey: string; fileSpecVersionId: string }[];
  createdAt: string;
}

export type FeatureStage = 'DRAFT' | 'SUBMITTED' | 'DCL_READY' | 'TESTING' | 'VERIFIED' | 'INTEGRATED' | 'ARCHIVED';

export interface Feature {
  id: string;
  workspaceId: string;
  groupId: string;
  vehicleModelId: string;
  projectId: string | null;
  name: string;
  description: string;
  /** BUSINESS: the group's own files and policies; TECHNICAL: a DCL technical change of processing bindings (技术变更). */
  kind: 'BUSINESS' | 'TECHNICAL';
  stage: FeatureStage;
  /** NULL: the vehicle model's platform-managed, empty initial development configuration. */
  baseReleaseId: string | null;
  headCommitId: string | null;
  /** The head commit that business testing verified, if any. */
  verifiedCommitId: string | null;
  sequence: number;
  draft: GroupConfig;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface Commit {
  id: string;
  /** Global order of commits. */
  seq: number;
  /** The Feature it was submitted from; null for a merge commit created by integration. */
  featureId: string | null;
  /** For merge commits: the candidate they belong to. */
  mergeLabel?: string;
  groupId: string;
  parentCommitId: string | null;
  sequence: number;
  baseReleaseId: string | null;
  manifestVersionId: string;
  /** policy id -> policy version id */
  policies: Record<string, string>;
  digest: string;
  message: string;
  author: string;
  createdAt: string;
}

export interface SensitiveReview {
  id: string;
  seq: number;
  groupId: string;
  workspaceId: string;
  dataKey: string;
  featureId: string;
  commitId: string;
  fileSignature: string;
  policySignature: string;
  decision: 'APPROVED' | 'REJECTED';
  reason: string;
  controls: ReviewControls | null;
  reviewer: string;
  createdAt: string;
}

export type FeedbackKind = 'RETURNED' | 'REVIEW_REJECTED' | 'BINDING_CHANGED' | 'REFERENCE_REVOKED' | 'MAINLINE_DECLINED';

export interface Feedback {
  id: string;
  featureId: string;
  commitId: string | null;
  kind: FeedbackKind;
  dataKey: string | null;
  reason: string;
  author: string;
  createdAt: string;
}

export type ReferenceStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'REVOKED';

export interface ReferenceRequest {
  id: string;
  dataKey: string;
  readerGroupId: string;
  status: ReferenceStatus;
  requestReason: string;
  decisionReason: string | null;
  requestedBy: string;
  decidedBy: string | null;
  createdAt: string;
  decidedAt: string | null;
}

/**
 * A DCL policy set version (DCL 策略集版本, a formal release): for one vehicle model, the committed
 * configuration of every business group, versioned independently of vehicle software.
 */
export interface Release {
  id: string;
  vehicleModelId: string;
  dclVersion: string;
  /**
   * The software versions listed when it was published. Later applicability records add or
   * withdraw versions without changing the set or its version.
   */
  vehicleIntegrationVersions: string[];
  /** group id -> commit id included for that group */
  groups: Record<string, string>;
  candidateId: string | null;
  /** The complete vehicle configuration vehicles resolve to. */
  resolvedConfigId: string;
  /** Publication order within the vehicle model. */
  sequence: number;
  notes: string;
  /** An emergency stop: the source set without one policy. */
  emergency: { stopId: string; sourceReleaseId: string; policyId: string } | null;
  /**
   * The older set this one patches for the software versions it serves (a same-software
   * configuration patch); null on the mainline. Patches never move the mainline.
   */
  patchOf: string | null;
  publishedBy: string;
  publishedAt: string;
}

/** Append-only applicability (适用关系): a set version starts or stops applying to a software version. */
export interface ApplicabilityRecord {
  id: string;
  seq: number;
  releaseId: string;
  vehicleModelId: string;
  version: string;
  action: 'ADD' | 'WITHDRAW';
  /** The check whose evidence the record rests on (ADD); null for a working name's link to its PLM version. */
  checkId: string | null;
  reason: string;
  /** null: the platform (a PLM version inherits its working name's sets). */
  by: string | null;
  at: string;
}

/**
 * An applicability check (适用性确认单): whether an unchanged set works on a software version.
 * Compatibility is computed from the set and the software manifest, never stored.
 */
export interface ApplicabilityCheck {
  id: string;
  vehicleModelId: string;
  version: string;
  releaseId: string;
  /** The integration workspace whose testing vehicles verify it. */
  testWorkspaceId: string;
  status: 'OPEN' | 'TESTING' | 'VERIFIED' | 'CONFIRMED' | 'SUPERSEDED' | 'CANCELLED';
  /** Opened by recording a software version no set applies to. */
  auto: boolean;
  /** null: opened by the platform when PLM published the version. */
  openedBy: string | null;
  openedAt: string;
  verifiedBy: string | null;
  verifiedAt: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
  note: string | null;
}

/** An emergency stop of one policy (紧急停用): requested by one person, decided by another. */
export interface EmergencyStop {
  id: string;
  releaseId: string;
  policyId: string;
  groupId: string;
  reason: string;
  status: 'REQUESTED' | 'APPROVED' | 'REJECTED';
  requestedBy: string;
  requestedAt: string;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  newReleaseId: string | null;
}

// ---------------------------------------------------------------------------
// Vehicles and validation
// ---------------------------------------------------------------------------

/**
 * A whole-vehicle software version of a model. A recorded version is one PLM (the company's record of
 * published versions) has published; a planned version is an integration call's working name (工作名)
 * until PLM publishes the software under its own number and the platform links the two.
 */
export interface SoftwareVersion {
  vehicleModelId: string;
  version: string;
  /** Where the record came from: PLM for synced versions; older saves keep their own text. */
  source: string;
  /** The signals and data sources the software provides (mock); null when not known. */
  manifest: SoftwareManifest | null;
  /**
   * PLANNED: an integration call's working name (工作名, 规划版本). Development and testing vehicles
   * may run its pre-release builds; production vehicles never do, and only that call's release may
   * list it. It stays planned after the release and is linked once PLM publishes the software.
   * RECORDED: a version PLM published.
   */
  status: 'PLANNED' | 'RECORDED';
  /** The integration call that planned (and, once released, produced) it; null when recorded from outside. */
  callId: string | null;
  /** The DCL configuration module bundled into this version's vehicle OTA package; null when none. */
  dclModule: DclModule | null;
  /** Every module exported for it, oldest first (the last one is `dclModule`). */
  moduleLog: DclModule[];
  /** Who planned it for an integration call, and when; null when it was recorded from outside. */
  plannedBy: string | null;
  plannedAt: string | null;
  /** Who recorded it (or planned it, while planned), and when; null when PLM sync recorded it. */
  recordedBy: string | null;
  createdAt: string;
  /**
   * A working name: the DCL part delivered to PLM for it (DCL merged the exported configuration into
   * the DCL software). A PLM version: the DCL part its BOM carries, as PLM published it.
   */
  dclPart: DclPart | null;
  /** A PLM version linked from an integration call's working name: that name (itself when PLM kept it). */
  workingName: string | null;
  /** A working name PLM has published: the PLM version it is linked to. */
  linkedTo: string | null;
}

/**
 * The DCL part (DCL 件) of a whole-vehicle version's BOM: the DCL software with a published policy
 * set merged in, delivered to PLM as one part before PLM publishes. Its version names both; the
 * digest says which set it carries, so the platform recognises the set without being told.
 */
export interface DclPart {
  clientVersion: string;
  setVersion: string;
  digest: string;
  /** Who delivered it to PLM, and when; null when PLM published a part the platform never delivered. */
  deliveredBy: string | null;
  deliveredAt: string | null;
}

/** The part version PLM shows: `<DCL client version>+<policy set version>`. */
export const partVersion = (p: Pick<DclPart, 'clientVersion' | 'setVersion'>) => `${p.clientVersion}+${p.setVersion}`;

/**
 * A DCL configuration module (DCL 配置模块): a published policy set exported into a whole-vehicle
 * integration version's OTA package, so a production vehicle flashed with that software runs the
 * set at once, without waiting for a cloud push (weak or no signal included). Later changes still
 * reach it by configuration OTA once it is connected.
 */
export interface DclModule {
  releaseId: string;
  resolvedConfigId: string;
  digest: string;
  exportedBy: string;
  exportedAt: string;
}

/** Immutable simulator runtime image. A NULL integration version is a development image. */
export interface SimulationImage {
  id: string;
  vehicleModelId: string;
  integrationVersion: string | null;
  build: string;
  digest: string;
  simulator: string;
  /**
   * A derived image (派生镜像): its base with modules rebuilt from source by one simulation's
   * build. It keeps the base's software version as its source version, is not in the catalog
   * and only runs on development simulations. NULL for catalog images.
   */
  derived: DerivedImage | null;
  createdBy: string;
  createdAt: string;
}

export interface DerivedImage {
  fromImageId: string;
  buildId: string;
  resourceId: string;
  /** module id -> what it was built from; accumulates over derived bases. */
  modules: Record<string, { repository: string; commit: string; buildId: string }>;
}

/** A module build (构建模块) by the mock CI: source in, a derived image out; nothing is executed. */
export interface SoftwareBuild {
  id: string;
  seq: number;
  resourceId: string;
  module: string;
  recipe: string;
  repository: string;
  requestedRef: string;
  /** The image the build starts from: the simulation's image when it was requested. */
  baseImageId: string;
  status: 'REQUESTED' | 'BUILT' | 'BUILD_FAILED' | 'CANCELLED';
  /** A 40-hex ref as given (not checked), or mock-commit:<build> for a branch or tag. */
  resolvedCommit: string | null;
  imageId: string | null;
  log: string | null;
  requestedBy: string;
  requestedAt: string;
  builtAt: string | null;
}

/**
 * A change of the image a simulation runs: a catalog switch, a built image deployed, or a
 * rollback. Only the simulation provider's answer changes what the instance runs.
 */
export interface ImageChange {
  id: string;
  seq: number;
  resourceId: string;
  kind: 'SWITCH' | 'DEPLOY' | 'ROLLBACK';
  fromImageId: string | null;
  toImageId: string;
  buildId: string | null;
  /** ROLLBACK only: the change it undoes. */
  rollbackOf: string | null;
  status: 'PENDING' | 'APPLIED' | 'FAILED' | 'CANCELLED';
  error: string | null;
  requestedBy: string;
  requestedAt: string;
  answeredAt: string | null;
}

/** The simulated on-vehicle agent (prototype only): how it answers configuration requests. */
export interface AgentState {
  online: boolean;
  /** Acknowledge pending configurations automatically when the simulator runs. */
  autoAck: boolean;
  /** The fault the vehicle plays when it applies a configuration, until set back to NONE. */
  fault: DeviceFault;
}

/**
 * Faults a simulated vehicle plays (车端故障, v0.13 mock): the package fails its checksum or its
 * platform signature, the apply is interrupted (the previous configuration is restored), or the
 * vehicle applies it and the receipt is lost on the way.
 */
export type DeviceFault = 'NONE' | 'CHECKSUM' | 'SIGNATURE' | 'APPLY_INTERRUPTED' | 'DROP_RECEIPT';

/** A receipt for a configuration the vehicle applied that has not reached the platform yet. */
export interface UnsentReceipt {
  deploymentId: string;
  attempt: number;
  /** Why it is still on the vehicle: RECEIPT_LOST, or the platform's refusal code. */
  lastError: string;
}

export interface ControllerState {
  name: string;
  version: string;
  status: 'PASS' | 'FAIL';
}

/** A device public key registered by vehicle resources; only registered devices may report. */
export interface DeviceKey {
  keyId: string;
  publicKey: string;
  registeredBy: string;
  registeredAt: string;
}

export interface Resource {
  id: string;
  type: 'PHYSICAL' | 'SIMULATION';
  vehicleModelId: string;
  env: Env;
  /** Ownership pool: the whole-vehicle scope or a domain. */
  pool: Scope;
  vin: string | null;
  uvid: string | null;
  licensePlate: string | null;
  displayName: string;
  status: 'AVAILABLE' | 'MAINTENANCE' | 'RETIRED';
  /** Actual whole-vehicle software, from the vehicle's own signed report. NULL means not known; never inferred. */
  integrationVersion: string | null;
  integrationSource: string | null;
  /**
   * What TSP holds for a physical vehicle (its T-Box, hardware configuration and the version it should
   * run), as last synced; null for a simulation or a vehicle registered before TSP was connected.
   */
  tsp: { tboxId: string; hardware: HardwareItem[]; expectedVersion: string | null; syncedAt: string } | null;
  /**
   * CONSISTENT: every domain controller runs the whole-vehicle version. PARTIAL_FAILURE: some
   * controller updates failed, so no whole-vehicle version is claimed and production is blocked.
   */
  softwareStatus: 'UNKNOWN' | 'CONSISTENT' | 'PARTIAL_FAILURE';
  /** The controllers of the vehicle's last report when an update left some failed (physical vehicles). */
  controllers: ControllerState[];
  /** Simulation instances run or stop; physical vehicles are null. */
  instance: 'RUNNING' | 'STOPPED' | null;
  /** Held by the workspace for a task until released. */
  reservation: { by: string; purpose: string; at: string } | null;
  imageId: string | null;
  /** The workspace that created a simulation instance. */
  homeWorkspaceId: string | null;
  /**
   * A personal simulation instance (个人仿真): the one account that configures, self-tests and
   * releases it, for drafts of one business group. It never joins workspace vehicles, vehicle
   * groups or team tests.
   */
  personal: { owner: string; groupId: string } | null;
  /** Confirmed only by an APPLIED receipt. */
  appliedConfigId: string | null;
  agent: AgentState;
  deviceKey: DeviceKey | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * What a vehicle is asked to run: one committed configuration per business group, on top of a
 * base. A Feature dispatch overlays one group's commit on the set in effect for the vehicle.
 */
export interface ResolvedConfig {
  id: string;
  vehicleModelId: string;
  kind: 'FEATURE' | 'CANDIDATE' | 'RELEASE' | 'PERSONAL';
  sourceId: string;
  baseReleaseId: string | null;
  /** group id -> commit id */
  groups: Record<string, string>;
  /** Base policies of other business groups a development group switched off (FEATURE and PERSONAL). */
  disabledPolicies: string[];
  /** PERSONAL only: the Feature draft run in place of its business group's commit. */
  draft: PersonalDraft | null;
  digest: string;
  label: string;
  createdAt: string;
}

/** An uncommitted Feature draft as a personal simulation runs it; never a version of anything. */
export interface PersonalDraft {
  groupId: string;
  featureId: string;
  snapshot: GroupConfig;
  digest: string;
}

export type VehicleGroupPurpose = 'DEV' | 'TEST' | 'PRODUCTION';

/**
 * What was last published to a vehicle group. A Feature publication is resolved per vehicle: the
 * set in effect for its software (or the group's explicit base) plus the commit.
 */
export type GroupPublication =
  | { kind: 'FEATURE'; featureId: string; commitId: string; disabledPolicies: string[] }
  | { kind: 'CANDIDATE'; candidateId: string; configId: string }
  | { kind: 'RELEASE'; releaseId: string; configId: string };

/** Persistent configuration routing group, owned by one workspace (and, below production, one business group). */
export interface VehicleGroup {
  id: string;
  workspaceId: string;
  groupId: string | null;
  name: string;
  purpose: VehicleGroupPurpose;
  env: Env;
  status: 'ACTIVE' | 'ARCHIVED';
  publication: GroupPublication | null;
  /** An explicit base set (显式基线) instead of the set in effect for each vehicle's software. */
  baseReleaseId: string | null;
  bindingRevision: number;
  /** Dispatches to this group need an approved team test request (团队测试审批). */
  requiresApproval: boolean;
  createdBy: string;
  createdAt: string;
}

/** A request to test a fixed commit on team vehicle groups, decided by the workspace admin. */
export interface TestRequest {
  id: string;
  workspaceId: string;
  featureId: string;
  commitId: string;
  vehicleGroupIds: string[];
  /** The vehicles the approval covers; a different list needs a new request. */
  members: string[];
  /** Policies of other business groups the test switches off. */
  disabledPolicies: string[];
  goal: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'EXECUTED' | 'WITHDRAWN';
  requestedBy: string;
  requestedAt: string;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  /** The dispatches it was carried out as (one per distinct vehicle configuration). */
  deploymentIds: string[];
}

export interface VehicleGroupEvent {
  id: string;
  vehicleGroupId: string;
  /** LENT_OUT / BORROWED_IN / LOAN_RETURNED / LOAN_RECALLED: membership changes made by a loan. */
  kind:
    | 'CREATED'
    | 'MEMBER_ADDED'
    | 'MEMBER_REMOVED'
    | 'LENT_OUT'
    | 'BORROWED_IN'
    | 'LOAN_RETURNED'
    | 'LOAN_RECALLED'
    | 'BOUND'
    | 'BASE_SET'
    | 'ARCHIVED'
    | 'APPROVAL_REQUIRED'
    | 'APPROVAL_NOT_REQUIRED';
  resourceId: string | null;
  reason: string | null;
  actor: string;
  createdAt: string;
}

export interface TargetAttempt {
  attempt: number;
  status: 'APPLIED' | 'FAILED' | 'CANCELLED';
  error: string | null;
  at: string;
}

export interface DeploymentTarget {
  resourceId: string;
  vehicleGroupId: string | null;
  attempt: number;
  /** QUEUED: part of a staged rollout, not sent to the vehicle yet. */
  status: 'QUEUED' | 'PENDING' | 'APPLIED' | 'FAILED' | 'CANCELLED';
  previousConfigId: string | null;
  error: string | null;
  updatedAt: string;
  /**
   * When the cloud pushed the pending configuration to the vehicle (推送): the vehicle was on and
   * connected. A dispatch (下发) only sets what the vehicle should run; null until it is pushed.
   */
  pushedAt: string | null;
  /** Finished earlier attempts, kept as evidence. */
  history: TargetAttempt[];
  /** OTA only: the vehicle's whole-vehicle software when the rollout was sent to it. */
  software?: string | null;
}

/** One step of an OTA rollout (下发记录), kept for the release history. */
export interface RolloutEvent {
  /** DROPPED: a vehicle left the rollout because its software changed (`reason` = the new version). */
  kind: 'STARTED' | 'EXPANDED' | 'PAUSED' | 'AUTO_PAUSED' | 'RESUMED' | 'COMPLETED' | 'CANCELLED' | 'ROLLED_BACK' | 'DROPPED';
  /** null: the platform itself (a failed or the last receipt). */
  by: string | null;
  at: string;
  reason: string | null;
  /** The vehicles the step concerned: sent, retried or failed. */
  resourceIds: string[];
}

/**
 * One dispatch of a fixed configuration to a frozen list of vehicles. APPLICABILITY: an unchanged
 * set tested on vehicles running a software version it does not list yet.
 */
export interface Deployment {
  id: string;
  kind: 'FEATURE' | 'CANDIDATE' | 'APPLICABILITY' | 'OTA' | 'PERSONAL';
  workspaceId: string;
  groupId: string | null;
  subjectId: string;
  commitId: string | null;
  resolvedConfigId: string;
  env: Env;
  status: 'PENDING' | 'COMPLETED' | 'CANCELLED' | 'PAUSED' | 'ROLLED_BACK';
  vehicleGroupIds: string[];
  targets: DeploymentTarget[];
  /** OTA only: the rollout this one rolls back, and why things paused. */
  rollbackOf?: string | null;
  pauseReason?: string | null;
  /** OTA only: every step of the rollout, oldest first. */
  log?: RolloutEvent[];
  /**
   * DISPATCH: someone dispatched it. GROUP_FOLLOW: a vehicle that joined a vehicle group (or had its
   * software updated on request) was pushed what was already dispatched to the group.
   */
  trigger: 'DISPATCH' | 'GROUP_FOLLOW';
  dispatchedBy: string;
  createdAt: string;
  updatedAt: string;
}

/** A simulated device receipt (the real system verifies device signatures). */
export interface Receipt {
  id: string;
  deploymentId: string;
  resourceId: string;
  attempt: number;
  result: 'APPLIED' | 'FAILED';
  error: string | null;
  receivedAt: string;
}

/**
 * A policy of a personal configuration fired on a personal simulation (试触发). It is the owner's
 * trial only: no upload, no processing, never part of data query, training or the catalog.
 */
export interface PersonalCapture {
  id: string;
  seq: number;
  resourceId: string;
  owner: string;
  configId: string;
  featureId: string;
  policyId: string;
  policyName: string;
  trigger: string;
  files: { dataKey: string; name: string; format: string; sizeBytes: number }[];
  occurredAt: string;
}

/**
 * The owner's own verdict on a draft run on a personal simulation (个人自测). It never counts as
 * a team test, never changes a Feature's stage and gates nothing.
 */
export interface PersonalTest {
  id: string;
  seq: number;
  resourceId: string;
  owner: string;
  workspaceId: string;
  featureId: string;
  configId: string;
  /** The digest of the draft snapshot that ran. */
  draftDigest: string;
  imageId: string | null;
  integrationVersion: string | null;
  baseReleaseId: string | null;
  disabledPolicies: string[];
  /** Trial captures on this configuration before the verdict. */
  captureIds: string[];
  result: 'PASS' | 'FAIL';
  note: string;
  createdAt: string;
}

/** A vehicle a subject (Feature commit, candidate, applicability check) must be verified on. */
export interface TestTarget {
  subjectKind: 'FEATURE' | 'CANDIDATE' | 'APPLICABILITY';
  subjectId: string;
  /** Feature commit; the candidate or check id itself. */
  versionId: string;
  resourceId: string;
  deploymentId: string;
}

export interface TestRun {
  id: string;
  seq: number;
  subjectKind: 'FEATURE' | 'CANDIDATE' | 'APPLICABILITY';
  subjectId: string;
  versionId: string;
  resourceId: string;
  resourceType: 'PHYSICAL' | 'SIMULATION';
  env: Env;
  /** The whole-vehicle software the vehicle ran when tested. */
  integrationVersion: string | null;
  /** The simulation image it ran on (null for physical vehicles); a later image needs a new test. */
  imageId: string | null;
  resolvedConfigId: string;
  result: 'PASS' | 'FAIL';
  summary: string;
  evidenceUri: string | null;
  tester: string;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Integration
// ---------------------------------------------------------------------------

export interface MergeConflict {
  groupId: string;
  section: 'files' | 'policies' | 'references';
  key: string;
  /** The field in conflict; '*' when the whole item conflicts (added differently, removed vs changed). */
  field: string;
  base: unknown;
  ours: unknown;
  theirs: unknown;
  featureIds: string[];
  subsystemReleaseIds: string[];
  /** Who must fix it: the owning business group, or DCL for processing fields. */
  owner: 'BUSINESS' | 'DCL';
}

/** A subsystem release used as a merge input, pinned to its changed group commits. */
export interface SubsystemRef {
  subsystemReleaseId: string;
  groups: Record<string, string>;
}

/** A three-way merge preview of Verified Features (and subsystem releases) onto a target set. */
export interface MergePlan {
  id: string;
  workspaceId: string;
  vehicleModelId: string;
  /** Vehicle for a whole-vehicle merge, or the one domain a subsystem merge covers. */
  scope: Scope;
  targetReleaseId: string | null;
  /** A patch of an older set: the software versions the target was in effect for at the preview. Null on the mainline. */
  patch: MergePatch | null;
  sources: { featureId: string; commitId: string }[];
  subsystems: SubsystemRef[];
  /** The integration call whose submissions it merges (one round of it); null for a free merge. */
  callId: string | null;
  status: 'READY' | 'CONFLICT' | 'BLOCKED' | 'FROZEN' | 'SUPERSEDED';
  /** Merged configuration of every group a source changed. */
  merged: Record<string, GroupConfig>;
  conflicts: MergeConflict[];
  issues: string[];
  digest: string;
  createdBy: string;
  createdAt: string;
}

export interface MergePatch {
  versions: string[];
}

/** DCL confirms the exact final processing set of a merge preview (bound to its digest). */
export interface ProcessingConfirmation {
  id: string;
  mergePlanId: string;
  digest: string;
  note: string;
  confirmedBy: string;
  createdAt: string;
}

export type CandidateStatus = 'CANDIDATE' | 'TESTING' | 'VERIFIED' | 'RELEASED' | 'CANCELLED';

/** A frozen, complete configuration set (集成候选); its tests start from zero. */
export interface Candidate {
  id: string;
  label: string;
  workspaceId: string;
  /** The integration workspace whose testing vehicles verify it. */
  testWorkspaceId: string;
  vehicleModelId: string;
  mergePlanId: string;
  targetReleaseId: string | null;
  /** Copied from the merge plan: a patch of an older set, or null on the mainline. */
  patch: MergePatch | null;
  /** group id -> commit id: the complete set. */
  groups: Record<string, string>;
  scope: Scope;
  sources: { featureId: string; commitId: string }[];
  subsystems: SubsystemRef[];
  /** The integration call it is a test integration version of (测试集成版本); null otherwise. */
  callId: string | null;
  resolvedConfigId: string;
  status: CandidateStatus;
  createdBy: string;
  createdAt: string;
  verifiedBy: string | null;
  verifiedAt: string | null;
}

// ---------------------------------------------------------------------------
// Integration calls (集成征集)
// ---------------------------------------------------------------------------

export type CallModuleStatus = 'WAITING' | 'SUBMITTED' | 'NO_CHANGE' | 'RETURNED' | 'EXCLUDED';

/** One step of a module in a call: a submission, a return, an exclusion or a reminder. */
export interface CallModuleEvent {
  kind: 'SUBMITTED' | 'NO_CHANGE' | 'RETURNED' | 'EXCLUDED' | 'REMINDED';
  by: string;
  at: string;
  note: string | null;
  featureId: string | null;
  commitId: string | null;
  subsystemReleaseId: string | null;
}

/**
 * A module of an integration call (征集模块): a leaf business group, submitted by its developers,
 * or an upper node, a domain integration workspace that integrates several groups first, submitted
 * by that workspace's admin or configuration integration.
 */
export interface CallModule {
  /** The group id, or `domain:<Domain>`. */
  key: string;
  kind: 'GROUP' | 'DOMAIN';
  groupId: string | null;
  domain: Domain | null;
  /** Where the module submits from: the group's team workspace, or the domain integration workspace. */
  workspaceId: string;
  status: CallModuleStatus;
  /** A Verified Feature commit (a group), or a subsystem release (a domain); null for no change. */
  featureId: string | null;
  commitId: string | null;
  subsystemReleaseId: string | null;
  by: string | null;
  at: string | null;
  note: string | null;
  remindedAt: string | null;
  history: CallModuleEvent[];
}

/** One round of a call: a merge preview of its submissions and, once frozen, its test integration version. */
export interface CallRound {
  planId: string;
  candidateId: string | null;
  /** RELEASED: published; CANCELLED: returned, previewed again or the call closed. Passing is the candidate's. */
  outcome: 'OPEN' | 'CANCELLED' | 'RELEASED';
  reason: string | null;
  by: string;
  at: string;
  closedBy: string | null;
  closedAt: string | null;
}

/**
 * An integration call (集成征集) for a target whole-vehicle integration version: every module submits
 * its DCL policy version, integration checks the list is complete, freezes a test integration
 * version and integration testing tests it, round after round; configuration release publishes
 * the passing round as a policy set listed for the target version. A domain call (子征集) collects
 * the groups of one domain for the same target and hands its subsystem release to the parent call.
 */
export interface IntegrationCall {
  id: string;
  vehicleModelId: string;
  /** The merge workspace that runs it. */
  workspaceId: string;
  scope: Scope;
  parentCallId: string | null;
  /** The target whole-vehicle integration version; fixed once a round was frozen. */
  targetVersion: string;
  title: string;
  /** The recorded version the planned target's manifest was copied from. */
  baseVersion: string | null;
  dueDate: string | null;
  modules: CallModule[];
  rounds: CallRound[];
  status: 'OPEN' | 'RELEASED' | 'CANCELLED' | 'NO_CHANGE';
  releaseId: string | null;
  subsystemReleaseId: string | null;
  /** Why it was cancelled or closed without change. */
  note: string | null;
  createdBy: string;
  createdAt: string;
  closedBy: string | null;
  closedAt: string | null;
}

// ---------------------------------------------------------------------------
// Collection events (采集事件) and data use
// ---------------------------------------------------------------------------

/**
 * HELD waits on the vehicle for upload budget; DROPPED was not kept (budget or an emergency hold);
 * SUPPRESSED was a trigger past the flood limit. The last two never carry data to the platform.
 */
export type EventStatus = 'HELD' | 'UPLOADING' | 'PROCESSING' | 'DONE' | 'FAILED' | 'DROPPED' | 'SUPPRESSED';

/**
 * Why the vehicle's budget guard acted on a capture: over the hourly CPU or storage budget, the
 * buffer full, evicted for a HIGH capture, a trigger flood, an emergency hold, or a HIGH capture
 * collected over budget.
 */
export type BudgetNote = 'CPU' | 'IO' | 'MEMORY' | 'NETWORK' | 'EVICTED' | 'FLOOD' | 'EMERGENCY_HOLD' | 'OVER_BUDGET_HIGH' | 'DEFERRED';

/**
 * Where a capture came from: the policy's trigger on the vehicle, an after-sales request (售后,
 * core business, first), or the periodic grader (Grader), which waits for after-sales.
 */
export type CaptureSource = 'TRIGGER' | 'AFTERSALES' | 'GRADER';

/** An after-sales request (售后回捞) for one vehicle to capture one policy's files now. */
export interface CaptureRequest {
  id: string;
  seq: number;
  resourceId: string;
  policyId: string;
  /** The business group owning the policy: only its people see, ask and cancel. */
  groupId: string;
  /** The workspace the request was made in; its data query shows the capture. */
  workspaceId: string;
  reason: string;
  requestedBy: string;
  requestedAt: string;
  status: 'PENDING' | 'CAPTURED' | 'CANCELLED';
  /** Who withdrew it; null when the platform cancelled it because the vehicle could not take it. */
  cancelledBy: string | null;
  /** Why the platform cancelled it. */
  note: string | null;
  eventId: string | null;
  answeredAt: string | null;
}

/** A vehicle's collection pause: asked (PAUSING), confirmed by the vehicle (PAUSED), being lifted (RESUMING), or lifted (ACTIVE). */
export interface CollectionHold {
  resourceId: string;
  state: 'PAUSING' | 'PAUSED' | 'RESUMING' | 'ACTIVE';
  history: { action: 'PAUSE' | 'RESUME'; reason: string; by: string; at: string; confirmedAt: string | null }[];
}
export type Quality = 'A' | 'B' | 'C' | 'UNKNOWN';
export type TrainingUse = 'ALLOWED' | 'DENIED' | 'UNCONFIRMED';

/** One captured file, pinned to the definition and processing versions in force at capture. */
export interface EventFile {
  dataKey: string;
  fileSpecVersionId: string;
  name: string;
  fileType: string;
  format: string;
  schema: string;
  edgePipelineId: string;
  cloudPipelineId: string;
  retentionDays: number;
  sizeBytes: number;
  edgeStatus: 'PENDING' | 'UPLOADED';
  cloudStatus: 'PENDING' | 'DONE' | 'PARSER_FAILED';
  /** Upload chunks with their checksums; a resent chunk is idempotent, a wrong checksum refused. */
  chunks: { index: number; sha256: string; received: boolean }[];
  /** Where the processed artifact lives; the same event and file always give the same artifact. */
  artifactUri: string | null;
}

/** A trigger that fired on a vehicle, with the configuration snapshot it ran under. */
export interface CollectionEvent {
  id: string;
  seq: number;
  /** MOCK_SAMPLE: seeded demo data; MOCK_EXECUTION: produced by the vehicle simulator. */
  origin: 'MOCK_SAMPLE' | 'MOCK_EXECUTION';
  resourceId: string;
  vin: string | null;
  uvid: string | null;
  licensePlate: string | null;
  vehicleModelId: string;
  env: Env;
  integrationVersion: string | null;
  /** The workspace whose dispatch put the configuration on the vehicle. */
  workspaceId: string;
  /** The business group owning the policy. */
  groupId: string;
  resolvedConfigId: string;
  configLabel: string;
  releaseId: string | null;
  commitId: string;
  policyId: string;
  policyVersionId: string;
  policyName: string;
  trigger: string;
  preSeconds: number;
  postSeconds: number;
  occurredAt: string;
  files: EventFile[];
  status: EventStatus;
  failure: string | null;
  /** The policy's priority when it fired (HIGH for after-sales): HIGH captures are collected even over budget. */
  priority: Priority;
  source: CaptureSource;
  /** The after-sales request it answers, if any. */
  requestId: string | null;
  /** What the capture costs the vehicle; null for events recorded before budgets existed. */
  cost: CaptureCost | null;
  /** When the vehicle stored the capture, and when its upload started; null if it never did. */
  writtenAt: string | null;
  uploadAt: string | null;
  budgetNote: BudgetNote | null;
  /** Simulator switch: cloud parsing of this event fails (until reprocessed). */
  failParse: boolean;
  processingAttempts: number;
  /** Business callbacks: delivered once per event however often they are sent. */
  callbacks: { deliveryId: string; at: string }[];
  callbackSends: number;
  quality: Quality;
  trainingUse: TrainingUse;
}

export interface AuditEvent {
  id: string;
  seq: number;
  at: string;
  username: string | null;
  role: string | null;
  grantId: string | null;
  action: string;
  outcome: 'ALLOWED' | 'DENIED';
  reason: string | null;
  targetType: string | null;
  targetId: string | null;
  workspaceId: string | null;
}

/**
 * A domain's published subsystem set (子系统发布): an input to whole-vehicle integration. It is not
 * a DCL version, lists no vehicle software and never goes to vehicles in production.
 */
export interface SubsystemRelease {
  id: string;
  /** e.g. ADC-S1, numbered per vehicle model and domain. */
  label: string;
  domain: Domain;
  vehicleModelId: string;
  workspaceId: string;
  candidateId: string;
  resolvedConfigId: string;
  /** The whole-vehicle release its changes were made against. */
  baseReleaseId: string | null;
  /** Changed groups only: group id -> commit id. */
  groups: Record<string, string>;
  /** Every Feature it contains, including those of earlier releases in its chain. */
  features: { featureId: string; commitId: string }[];
  supersedesId: string | null;
  sequence: number;
  status: 'ACTIVE' | 'INTEGRATING' | 'INTEGRATED' | 'SUPERSEDED';
  notes: string;
  publishedBy: string;
  publishedAt: string;
}

export interface StoredReport {
  bootCounter: number;
  bootId: string;
  sequence: number;
  digest: string;
  payload: ClientReportPayload;
  receivedAt: string;
  /** ACCEPTED became the latest when received; STALE arrived after a newer one. */
  result: 'ACCEPTED' | 'STALE';
}

/** What the platform keeps for one vehicle's client reports. */
export interface ClientReportLog {
  latest: StoredReport | null;
  /** Newest first, capped. */
  history: StoredReport[];
  /** boot counter -> boot id, to refuse a second boot under one counter. */
  boots: Record<string, string>;
}

/** The simulated vehicle's own storage (prototype only). The platform never reads it. */
export interface DeviceState {
  keyId: string;
  secret: string;
  publicKey: string;
  bootCounter: number;
  bootId: string;
  sequence: number;
  clientVersion: string;
  /**
   * The whole-vehicle software the simulated physical vehicle actually runs (from the factory: the
   * version TSP holds for it); null when the vehicle does not know it.
   */
  software: string | null;
  /** Each controller's software after the last simulated software OTA (from the version's PLM BOM); empty before one. */
  controllers: ControllerState[];
  /** Reports waiting for a connection; removed only once accepted. */
  outbox: { signed: SignedReport; lastError: string | null }[];
  /** The last report the platform accepted, kept to resend. */
  lastSent: SignedReport | null;
  lastContentDigest: string | null;
  lastSentAt: string | null;
  /**
   * The configuration the vehicle actually runs when the platform has not recorded it (its receipt
   * was lost); null while it runs what the platform recorded.
   */
  config: string | null;
  /** Receipts for configurations the vehicle applied that the platform has not received; resent once connected. */
  unsent: UnsentReceipt[];
}

/**
 * A change of a physical vehicle's whole-vehicle software (整车软件版本变化): from its own signed
 * report, a vehicle resources confirmation or controller reports. UNRECORDED: the vehicle reported
 * a version the platform does not know yet; the record stays until vehicle resources record it.
 */
export interface SoftwareChange {
  id: string;
  seq: number;
  resourceId: string;
  fromVersion: string | null;
  toVersion: string;
  source: 'CLIENT_REPORT' | 'CONFIRMED' | 'CONTROLLERS';
  status: 'APPLIED' | 'UNRECORDED' | 'RESOLVED';
  at: string;
  /** Who of the vehicle's team has seen it (确认); the check itself is recomputed when viewed. */
  acknowledgedBy: string | null;
  acknowledgedAt: string | null;
  /** The software update request (整车软件更新) this change carried out, if any. */
  requestId: string | null;
  /** The bundled DCL configuration module the vehicle started running with the software, if any. */
  configId?: string | null;
  /** Who recorded it (vehicle resources confirming a trusted source); null when the vehicle reported it. */
  by?: string | null;
}

/**
 * A vehicle moved between development, testing and production (资源环境迁移) by vehicle resources.
 * Its software and applied configuration stay as they were.
 */
export interface EnvironmentChange {
  id: string;
  seq: number;
  resourceId: string;
  from: Env;
  to: Env;
  reason: string;
  by: string;
  at: string;
}

/** Archiving or restoring a workspace, business group or organization unit (归档与恢复). History stays. */
export interface LifecycleEvent {
  id: string;
  seq: number;
  /** RENAMED and MOVED keep an org unit's name or path before and after; SOURCES_CHANGED a workspace's integration sources. */
  kind: 'ARCHIVED' | 'RESTORED' | 'RENAMED' | 'MOVED' | 'SOURCES_CHANGED';
  object: 'WORKSPACE' | 'GROUP' | 'ORG_UNIT';
  objectId: string;
  reason: string;
  by: string;
  at: string;
  before?: string;
  after?: string;
}

/**
 * A vehicle waiting to follow its vehicle group (跟随车辆组): it joined the group, or its software
 * was updated on request. On its next accepted report the cloud pushes what was dispatched to the
 * group, if that fits the vehicle's software; otherwise the team chooses what to do.
 */
export interface GroupFollow {
  vehicleGroupId: string;
  reason: 'JOINED' | 'SOFTWARE_UPDATED';
  since: string;
}

/**
 * A request to the vehicle OTA system (整车 OTA, outside the platform) to put a physical vehicle on
 * another recorded whole-vehicle software version. The platform learns the result from the
 * vehicle's own report after it restarts.
 */
export interface VehicleSoftwareRequest {
  id: string;
  seq: number;
  resourceId: string;
  /** The workspace it was requested in. */
  workspaceId: string;
  fromVersion: string | null;
  toVersion: string;
  reason: string;
  status: 'PENDING' | 'APPLIED' | 'FAILED' | 'CANCELLED';
  error: string | null;
  requestedBy: string;
  requestedAt: string;
  answeredAt: string | null;
}

export interface LoanLender {
  workspaceId: string;
  decision: 'PENDING' | 'AGREED' | 'DECLINED';
  by: string | null;
  at: string | null;
  note: string | null;
}

export interface LoanExtension {
  /** The new last day (YYYY-MM-DD). */
  dueDate: string;
  reason: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  requestedBy: string;
  requestedAt: string;
  decidedBy: string | null;
  decidedAt: string | null;
}

/**
 * A loan (借用): a workspace uses a vehicle it cannot simply add, for a limited time, in one of its
 * vehicle groups. Ownership, pool and environment stay. Workspaces using the car agree first, then
 * vehicle resources approve.
 */
export interface Loan {
  id: string;
  seq: number;
  resourceId: string;
  /** The borrowing workspace and the vehicle group the car joins there. */
  workspaceId: string;
  vehicleGroupId: string;
  purpose: string;
  /** Last day of the loan (YYYY-MM-DD); overdue from the next day. */
  dueDate: string;
  status: 'REQUESTED' | 'APPROVED' | 'REJECTED' | 'WITHDRAWN' | 'RETURNED' | 'RECALLED';
  /** Other workspaces using the car when it was requested. */
  lenders: LoanLender[];
  requestedBy: string;
  requestedAt: string;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  extensions: LoanExtension[];
  /** The lender's vehicle group the car left when the loan was approved. */
  leftGroupId: string | null;
  softwareAtStart: string | null;
  softwareAtEnd: string | null;
  endedBy: string | null;
  endedAt: string | null;
  endNote: string | null;
}

/** A department of the simulated company directory (公司目录). */
export interface DirectoryDepartment {
  extId: string;
  name: string;
  parentExtId: string | null;
  status: 'ACTIVE' | 'REMOVED';
}

export interface DirectoryPerson {
  employeeId: string;
  username: string;
  displayName: string;
  deptExtId: string;
  status: 'ACTIVE' | 'LEFT';
}

/** One item of a vehicle's hardware configuration, as TSP holds it (e.g. 激光雷达: 有). */
export interface HardwareItem {
  item: string;
  value: string;
}

/**
 * The simulated TSP (prototype only): the company's record of each car — its identity (VIN, UVID,
 * T-Box), model, plate, hardware configuration and the whole-vehicle version it should run (what
 * the vehicle OTA program last put it on). The platform reads it when vehicle resources register a
 * car, and syncs it; the car's own report says what it actually runs.
 */
export interface TspCatalog {
  revision: number;
  vehicles: TspVehicle[];
}

export interface TspVehicle {
  vin: string;
  uvid: string;
  tboxId: string;
  vehicleModelId: string;
  licensePlate: string | null;
  hardware: HardwareItem[];
  /** The version the car should run; null when TSP does not know (e.g. a development car on daily builds). */
  expectedVersion: string | null;
}

/**
 * The simulated PLM (prototype only): the company's record of published whole-vehicle integration
 * versions, each mapping every module's version, the DCL part included, to one version number.
 * The platform reads it only by syncing.
 */
export interface PlmCatalog {
  revision: number;
  versions: PlmVersion[];
}

export interface PlmVersion {
  vehicleModelId: string;
  version: string;
  /** The version's BOM: each module (domain controller software) and its version. */
  modules: { name: string; version: string }[];
  /** The DCL part in the version's BOM; null when the version carries none. */
  dclPart: Pick<DclPart, 'clientVersion' | 'setVersion' | 'digest'> | null;
  publishedAt: string;
}

/** The company directory (prototype only, like HR or LDAP). The platform reads it only by syncing. */
export interface CompanyDirectory {
  revision: number;
  departments: DirectoryDepartment[];
  people: DirectoryPerson[];
}

export interface DirectorySyncEntry {
  seq: number;
  at: string;
  revision: number;
  kind:
    | 'UNIT_CREATED'
    | 'UNIT_RENAMED'
    | 'UNIT_MOVED'
    | 'UNIT_ARCHIVED'
    | 'ACCOUNT_CREATED'
    | 'ACCOUNT_LINKED'
    | 'ACCOUNT_MOVED'
    | 'ACCOUNT_DISABLED'
    | 'ACCOUNT_REACTIVATED'
    | 'ACCOUNT_SKIPPED'
    | 'PERSONAL_SIMS_RELEASED';
  subject: string;
  detail: string;
}

export interface DirectorySync {
  /** The directory revision last applied. */
  revision: number;
  syncedAt: string | null;
  /** Newest first, capped. */
  log: DirectorySyncEntry[];
}

export interface State {
  schema: number;
  /** Monotonic counter for ordering (decisions, test runs, audit). */
  seq: number;
  installation: 'CLEAN' | 'DEMO';
  accounts: Record<string, Account>;
  vehicleModels: Record<string, VehicleModel>;
  projects: Record<string, Project>;
  orgUnits: Record<string, OrgUnit>;
  groups: Record<string, BusinessGroup>;
  workspaces: Record<string, Workspace>;
  pipelines: Record<string, Pipeline>;
  templates: Record<string, Template>;
  dataItems: Record<string, DataItem>;
  fileSpecVersions: Record<string, FileSpecVersion>;
  /** policy id -> owning group */
  policyOwners: Record<string, string>;
  policyVersions: Record<string, PolicyVersion>;
  manifestVersions: Record<string, ManifestVersion>;
  features: Record<string, Feature>;
  commits: Record<string, Commit>;
  sensitiveReviews: SensitiveReview[];
  feedback: Feedback[];
  referenceRequests: Record<string, ReferenceRequest>;
  releases: Record<string, Release>;
  applicability: ApplicabilityRecord[];
  applicabilityChecks: Record<string, ApplicabilityCheck>;
  emergencyStops: Record<string, EmergencyStop>;
  softwareVersions: Record<string, SoftwareVersion>;
  images: Record<string, SimulationImage>;
  resources: Record<string, Resource>;
  /** workspace id -> resource ids the workspace may use */
  workspaceResources: Record<string, string[]>;
  vehicleGroups: Record<string, VehicleGroup>;
  /** resource id -> vehicle group id (one routing group per vehicle, platform-wide) */
  groupMembers: Record<string, string>;
  vehicleGroupEvents: VehicleGroupEvent[];
  resolvedConfigs: Record<string, ResolvedConfig>;
  deployments: Record<string, Deployment>;
  receipts: Receipt[];
  testTargets: TestTarget[];
  testRuns: TestRun[];
  mergePlans: Record<string, MergePlan>;
  processingConfirmations: ProcessingConfirmation[];
  candidates: Record<string, Candidate>;
  events: Record<string, CollectionEvent>;
  testRequests: Record<string, TestRequest>;
  subsystemReleases: Record<string, SubsystemRelease>;
  /** resource id -> its client reports */
  clientReports: Record<string, ClientReportLog>;
  /** resource id -> simulated device storage (the simulator's, not the platform's) */
  devices: Record<string, DeviceState>;
  grantRules: Record<string, GrantRule>;
  /** The simulated company directory (the simulator's, not the platform's); null when none is connected. */
  directory: CompanyDirectory | null;
  directorySync: DirectorySync;
  /** The simulated PLM (the simulator's, not the platform's). */
  plm: PlmCatalog;
  /** The PLM revision last applied, and when. */
  plmSync: { revision: number; syncedAt: string | null };
  /** The simulated TSP (the simulator's, not the platform's). */
  tsp: TspCatalog;
  /** The TSP revision last applied, and when. */
  tspSync: { revision: number; syncedAt: string | null };
  personalCaptures: Record<string, PersonalCapture>;
  personalTests: Record<string, PersonalTest>;
  softwareBuilds: Record<string, SoftwareBuild>;
  imageChanges: Record<string, ImageChange>;
  softwareChanges: Record<string, SoftwareChange>;
  /** username -> workspace id -> ids of notifications the account marked read (通知已读). */
  notificationReads: Record<string, Record<string, string[]>>;
  /** resource id -> the vehicle group it waits to follow */
  groupFollows: Record<string, GroupFollow>;
  vehicleSoftwareRequests: Record<string, VehicleSoftwareRequest>;
  loans: Record<string, Loan>;
  /** Simulated time (模拟时间): how far the platform clock runs ahead of real time. */
  clockOffsetMs: number;
  environmentChanges: EnvironmentChange[];
  lifecycleEvents: LifecycleEvent[];
  /** Collection budgets (采集预算): one per vehicle model, set by DCL engineering, and per-vehicle overrides. */
  collectionBudgets: { models: Record<string, Budget>; vehicles: Record<string, Budget> };
  /** Collection pauses (紧急停采) by vehicle, with their history. */
  collectionHolds: Record<string, CollectionHold>;
  /** How many simulations a workspace may run at once (team and personal together); none means no limit. */
  simulationQuotas: Record<string, number>;
  captureRequests: Record<string, CaptureRequest>;
  integrationCalls: Record<string, IntegrationCall>;
  audit: AuditEvent[];
}

export function emptyState(): State {
  return {
    schema: STATE_SCHEMA,
    seq: 0,
    installation: 'CLEAN',
    accounts: {},
    vehicleModels: {},
    projects: {},
    orgUnits: {},
    groups: {},
    workspaces: {},
    pipelines: {},
    templates: {},
    dataItems: {},
    fileSpecVersions: {},
    policyOwners: {},
    policyVersions: {},
    manifestVersions: {},
    features: {},
    commits: {},
    sensitiveReviews: [],
    feedback: [],
    referenceRequests: {},
    releases: {},
    applicability: [],
    applicabilityChecks: {},
    emergencyStops: {},
    softwareVersions: {},
    images: {},
    resources: {},
    workspaceResources: {},
    vehicleGroups: {},
    groupMembers: {},
    vehicleGroupEvents: [],
    resolvedConfigs: {},
    deployments: {},
    receipts: [],
    testTargets: [],
    testRuns: [],
    mergePlans: {},
    processingConfirmations: [],
    candidates: {},
    events: {},
    testRequests: {},
    subsystemReleases: {},
    clientReports: {},
    devices: {},
    grantRules: {},
    directory: null,
    directorySync: { revision: 0, syncedAt: null, log: [] },
    plm: { revision: 0, versions: [] },
    plmSync: { revision: 0, syncedAt: null },
    tsp: { revision: 0, vehicles: [] },
    tspSync: { revision: 0, syncedAt: null },
    personalCaptures: {},
    personalTests: {},
    softwareBuilds: {},
    imageChanges: {},
    softwareChanges: {},
    notificationReads: {},
    groupFollows: {},
    vehicleSoftwareRequests: {},
    loans: {},
    clockOffsetMs: 0,
    environmentChanges: [],
    lifecycleEvents: [],
    collectionBudgets: { models: {}, vehicles: {} },
    collectionHolds: {},
    simulationQuotas: {},
    captureRequests: {},
    integrationCalls: {},
    audit: [],
  };
}
