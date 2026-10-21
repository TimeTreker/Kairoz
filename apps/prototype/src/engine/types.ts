// The prototype's whole platform state. Everything the workflow needs lives here and is
// persisted in the browser; there is no server.

import type { Grant } from '../domain/authz.ts';
import type { FileSpecContent, GroupConfig, PolicyContent } from '../domain/config.ts';
import type { DataSource } from '../domain/data-source.ts';
import type { FileType, Privacy } from '../domain/file-types.ts';
import type { ReviewControls } from '../domain/intake.ts';
import type { Domain, Env, GroupPurpose, Scope, WorkspaceKind } from '../domain/vocabulary.ts';

export const STATE_SCHEMA = 2;

export interface Account {
  username: string;
  displayName: string;
  status: 'ACTIVE' | 'DISABLED';
  grants: Grant[];
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
  featureId: string;
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
 * A formal DCL release (正式发布): for one vehicle model, the committed configuration of every
 * business group, versioned independently of vehicle software.
 */
export interface Release {
  id: string;
  vehicleModelId: string;
  dclVersion: string;
  /** Whole-vehicle software versions this release is approved for. */
  vehicleIntegrationVersions: string[];
  /** group id -> commit id included for that group */
  groups: Record<string, string>;
  candidateId: string | null;
  /** Publication order within the vehicle model. */
  sequence: number;
  publishedBy: string;
  publishedAt: string;
}

// ---------------------------------------------------------------------------
// Vehicles and validation
// ---------------------------------------------------------------------------

/** A whole-vehicle software version of a model, recorded from a trusted external source. */
export interface SoftwareVersion {
  vehicleModelId: string;
  version: string;
  source: string;
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
  imageId: string | null;
  /** The workspace that created a simulation instance. */
  homeWorkspaceId: string | null;
  /** Confirmed only by an APPLIED receipt. */
  appliedConfigId: string | null;
  agent: AgentState;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * What a vehicle is asked to run: one committed configuration per business group, on top of a
 * base. A Feature dispatch overlays one group's commit on the vehicle model's base.
 */
export interface ResolvedConfig {
  id: string;
  vehicleModelId: string;
  kind: 'FEATURE' | 'CANDIDATE' | 'RELEASE';
  sourceId: string;
  baseReleaseId: string | null;
  /** group id -> commit id */
  groups: Record<string, string>;
  digest: string;
  label: string;
  createdAt: string;
}

export type VehicleGroupPurpose = 'DEV' | 'TEST' | 'PRODUCTION';

/** Persistent configuration routing group, owned by one workspace (and, below production, one business group). */
export interface VehicleGroup {
  id: string;
  workspaceId: string;
  groupId: string | null;
  name: string;
  purpose: VehicleGroupPurpose;
  env: Env;
  status: 'ACTIVE' | 'ARCHIVED';
  targetConfigId: string | null;
  bindingRevision: number;
  createdBy: string;
  createdAt: string;
}

export interface VehicleGroupEvent {
  id: string;
  vehicleGroupId: string;
  kind: 'CREATED' | 'MEMBER_ADDED' | 'MEMBER_REMOVED' | 'BOUND' | 'ARCHIVED';
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
  status: 'PENDING' | 'APPLIED' | 'FAILED' | 'CANCELLED';
  previousConfigId: string | null;
  error: string | null;
  updatedAt: string;
  /** Finished earlier attempts, kept as evidence. */
  history: TargetAttempt[];
}

/** One dispatch of a fixed configuration to a frozen list of vehicles. */
export interface Deployment {
  id: string;
  kind: 'FEATURE' | 'CANDIDATE' | 'OTA';
  workspaceId: string;
  groupId: string | null;
  subjectId: string;
  commitId: string | null;
  resolvedConfigId: string;
  env: Env;
  status: 'PENDING' | 'COMPLETED' | 'CANCELLED' | 'PAUSED';
  vehicleGroupIds: string[];
  targets: DeploymentTarget[];
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

/** A vehicle a subject (Feature commit, candidate) must be verified on. */
export interface TestTarget {
  subjectKind: 'FEATURE' | 'CANDIDATE';
  subjectId: string;
  /** Feature commit, or candidate resolved config. */
  versionId: string;
  resourceId: string;
  deploymentId: string;
}

export interface TestRun {
  id: string;
  seq: number;
  subjectKind: 'FEATURE' | 'CANDIDATE';
  subjectId: string;
  versionId: string;
  resourceId: string;
  resourceType: 'PHYSICAL' | 'SIMULATION';
  env: Env;
  resolvedConfigId: string;
  result: 'PASS' | 'FAIL';
  summary: string;
  evidenceUri: string | null;
  tester: string;
  createdAt: string;
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
    audit: [],
  };
}
