// The prototype's whole platform state. Everything the workflow needs lives here and is
// persisted in the browser; there is no server.

import type { Grant } from '../domain/authz.ts';
import type { FileSpecContent, GroupConfig, PolicyContent } from '../domain/config.ts';
import type { DataSource } from '../domain/data-source.ts';
import type { FileType, Privacy } from '../domain/file-types.ts';
import type { ReviewControls } from '../domain/intake.ts';
import type { Domain, Env, GroupPurpose, Scope, WorkspaceKind } from '../domain/vocabulary.ts';

export const STATE_SCHEMA = 1;

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
    audit: [],
  };
}
