// The prototype's whole platform state. Everything the workflow needs lives here and is
// persisted in the browser; there is no server.

import type { Grant } from '../domain/authz.ts';
import type { ClientReportPayload, SignedReport } from '../domain/client-report.ts';
import type { SoftwareManifest } from '../domain/compatibility.ts';
import type { FileSpecContent, GroupConfig, PolicyContent } from '../domain/config.ts';
import type { DataSource } from '../domain/data-source.ts';
import type { FileType, Privacy } from '../domain/file-types.ts';
import type { ReviewControls } from '../domain/intake.ts';
import type { Domain, Env, GroupPurpose, Role, Scope, WorkspaceKind } from '../domain/vocabulary.ts';

export const STATE_SCHEMA = 8;

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
  kind: 'BUSINESS';
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

export type FeedbackKind = 'RETURNED' | 'REVIEW_REJECTED' | 'BINDING_CHANGED' | 'REFERENCE_REVOKED';

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
  /** The check whose evidence the record rests on (ADD). */
  checkId: string | null;
  reason: string;
  by: string;
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
  openedBy: string;
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

/** A whole-vehicle software version of a model, recorded from a trusted external source. */
export interface SoftwareVersion {
  vehicleModelId: string;
  version: string;
  source: string;
  /** The signals and data sources the software provides (mock); null when not known. */
  manifest: SoftwareManifest | null;
  recordedBy: string;
  createdAt: string;
}

/** Immutable simulator runtime image. A NULL integration version is a development image. */
export interface SimulationImage {
  id: string;
  vehicleModelId: string;
  integrationVersion: string | null;
  build: string;
  digest: string;
  simulator: string;
  createdBy: string;
  createdAt: string;
}

/** The simulated on-vehicle agent (prototype only): how it answers configuration requests. */
export interface AgentState {
  online: boolean;
  /** Acknowledge pending configurations automatically when the simulator runs. */
  autoAck: boolean;
  /** The next configuration fails to apply. */
  failNext: boolean;
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
  /** Actual whole-vehicle software. NULL means not yet known; never inferred. */
  integrationVersion: string | null;
  integrationSource: string | null;
  /**
   * CONSISTENT: every domain controller runs the whole-vehicle version. PARTIAL_FAILURE: some
   * controller updates failed, so no whole-vehicle version is claimed and production is blocked.
   */
  softwareStatus: 'UNKNOWN' | 'CONSISTENT' | 'PARTIAL_FAILURE';
  /** Last trusted per-controller report (physical vehicles). */
  controllers: ControllerState[];
  /** Simulation instances run or stop; physical vehicles are null. */
  instance: 'RUNNING' | 'STOPPED' | null;
  /** Held by the workspace for a task until released. */
  reservation: { by: string; purpose: string; at: string } | null;
  imageId: string | null;
  /** The workspace that created a simulation instance. */
  homeWorkspaceId: string | null;
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
  kind: 'FEATURE' | 'CANDIDATE' | 'RELEASE';
  sourceId: string;
  baseReleaseId: string | null;
  /** group id -> commit id */
  groups: Record<string, string>;
  /** Base policies of other business groups a development group switched off (FEATURE only). */
  disabledPolicies: string[];
  digest: string;
  label: string;
  createdAt: string;
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
  kind: 'CREATED' | 'MEMBER_ADDED' | 'MEMBER_REMOVED' | 'BOUND' | 'BASE_SET' | 'ARCHIVED' | 'APPROVAL_REQUIRED' | 'APPROVAL_NOT_REQUIRED';
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
  /** Finished earlier attempts, kept as evidence. */
  history: TargetAttempt[];
}

/**
 * One dispatch of a fixed configuration to a frozen list of vehicles. APPLICABILITY: an unchanged
 * set tested on vehicles running a software version it does not list yet.
 */
export interface Deployment {
  id: string;
  kind: 'FEATURE' | 'CANDIDATE' | 'APPLICABILITY' | 'OTA';
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
  sources: { featureId: string; commitId: string }[];
  subsystems: SubsystemRef[];
  status: 'READY' | 'CONFLICT' | 'BLOCKED' | 'FROZEN' | 'SUPERSEDED';
  /** Merged configuration of every group a source changed. */
  merged: Record<string, GroupConfig>;
  conflicts: MergeConflict[];
  issues: string[];
  digest: string;
  createdBy: string;
  createdAt: string;
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
  /** group id -> commit id: the complete set. */
  groups: Record<string, string>;
  scope: Scope;
  sources: { featureId: string; commitId: string }[];
  subsystems: SubsystemRef[];
  resolvedConfigId: string;
  status: CandidateStatus;
  createdBy: string;
  createdAt: string;
  verifiedBy: string | null;
  verifiedAt: string | null;
}

// ---------------------------------------------------------------------------
// Collection events (采集事件) and data use
// ---------------------------------------------------------------------------

export type EventStatus = 'UPLOADING' | 'PROCESSING' | 'DONE' | 'FAILED';
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
  /** Reports waiting for a connection; removed only once accepted. */
  outbox: { signed: SignedReport; lastError: string | null }[];
  /** The last report the platform accepted, kept to resend. */
  lastSent: SignedReport | null;
  lastContentDigest: string | null;
  lastSentAt: string | null;
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
    | 'ACCOUNT_SKIPPED';
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
    audit: [],
  };
}
