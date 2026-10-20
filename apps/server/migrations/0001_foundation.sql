-- Slice 1: identity, organization, workspaces, processing catalog, config authoring.
-- Never edit an applied migration; add a new file instead.

-- ---------------------------------------------------------------------------
-- Identity
-- ---------------------------------------------------------------------------

CREATE TABLE accounts (
  username      text PRIMARY KEY CHECK (username ~ '^[a-z][a-z0-9_]{2,31}$'),
  display_name  text NOT NULL CHECK (length(display_name) BETWEEN 1 AND 100),
  status        text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'DISABLED')),
  -- Bumped whenever status or grants change; sessions carrying an older value are invalid.
  auth_version  integer NOT NULL DEFAULT 1,
  revision      integer NOT NULL DEFAULT 1,
  created_by    text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- One row is one complete authorization. Authorization never combines rows.
CREATE TABLE grants (
  id          uuid PRIMARY KEY DEFAULT uuidv7(),
  username    text NOT NULL REFERENCES accounts (username),
  position    integer NOT NULL,
  role        text NOT NULL CHECK (role IN (
                'BUSINESS_DEV', 'BUSINESS_TEST', 'INTEGRATION_TEST', 'DCL_ENGINEER',
                'CONFIG_INTEGRATOR', 'CONFIG_RELEASE', 'VEHICLE_RESOURCE',
                'WORKSPACE_ADMIN', 'PLATFORM_OPS')),
  workspaces  text[] NOT NULL CHECK (cardinality(workspaces) > 0),
  groups      text[] NOT NULL DEFAULT '{}',
  scopes      text[] NOT NULL DEFAULT '{}',
  envs        text[] NOT NULL CHECK (
                cardinality(envs) > 0
                AND envs <@ ARRAY['development', 'testing', 'production']::text[]),
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (username, position)
);

CREATE TABLE sessions (
  token_hash    bytea PRIMARY KEY,
  username      text NOT NULL REFERENCES accounts (username),
  auth_version  integer NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL
);
CREATE INDEX sessions_username_idx ON sessions (username);

-- ---------------------------------------------------------------------------
-- Organization
-- ---------------------------------------------------------------------------

CREATE TABLE vehicle_models (
  id          text PRIMARY KEY CHECK (id ~ '^[A-Z0-9][A-Z0-9_-]{1,31}$'),
  name        text NOT NULL CHECK (length(name) BETWEEN 1 AND 100),
  status      text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'RETIRED')),
  created_by  text NOT NULL REFERENCES accounts (username),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE projects (
  id                text PRIMARY KEY CHECK (id ~ '^[a-z][a-z0-9-]{1,60}$'),
  name              text NOT NULL CHECK (length(name) BETWEEN 1 AND 100),
  vehicle_model_id  text REFERENCES vehicle_models (id),
  status            text NOT NULL DEFAULT 'ESTABLISHED' CHECK (status IN ('ESTABLISHED', 'ARCHIVED')),
  created_by        text NOT NULL REFERENCES accounts (username),
  created_at        timestamptz NOT NULL DEFAULT now()
);

-- Team organization (kind TEAM) and project organizations (kind PROJECT) are separate trees
-- that share one table. A parent must have the same kind and project; the service layer enforces it.
CREATE TABLE org_units (
  id          text PRIMARY KEY CHECK (id ~ '^[a-z][a-z0-9-]{1,60}$'),
  kind        text NOT NULL CHECK (kind IN ('TEAM', 'PROJECT')),
  project_id  text REFERENCES projects (id),
  parent_id   text REFERENCES org_units (id),
  name        text NOT NULL CHECK (length(name) BETWEEN 1 AND 100),
  status      text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'ARCHIVED')),
  revision    integer NOT NULL DEFAULT 1,
  created_by  text NOT NULL REFERENCES accounts (username),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CHECK ((kind = 'TEAM') = (project_id IS NULL)),
  CHECK (parent_id IS NULL OR parent_id <> id)
);
CREATE INDEX org_units_parent_idx ON org_units (parent_id);

-- Configuration ownership group (业务分组): sole maintainer of its file list and policies.
CREATE TABLE business_groups (
  id           text PRIMARY KEY CHECK (id ~ '^[a-z][a-z0-9-]{1,60}$'),
  code         text NOT NULL UNIQUE CHECK (code ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$'),
  name         text NOT NULL CHECK (length(name) BETWEEN 1 AND 100),
  domain       text NOT NULL CHECK (domain IN (
                 'Common', 'Chassis', 'Battery', 'Powertrain', 'HMI', 'ADC', 'CDC', 'Other')),
  purpose      text NOT NULL CHECK (purpose IN ('DEV', 'TEST')),
  org_unit_id  text NOT NULL REFERENCES org_units (id),
  status       text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'ARCHIVED')),
  created_by   text NOT NULL REFERENCES accounts (username),
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE workspaces (
  id                text PRIMARY KEY CHECK (id ~ '^[a-z][a-z0-9-]{1,60}$'),
  name              text NOT NULL CHECK (length(name) BETWEEN 1 AND 100),
  kind              text NOT NULL CHECK (kind IN ('TEAM', 'PROJECT', 'INTEGRATION')),
  org_unit_id       text NOT NULL REFERENCES org_units (id),
  project_id        text REFERENCES projects (id),
  vehicle_model_id  text NOT NULL REFERENCES vehicle_models (id),
  status            text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'ARCHIVED')),
  revision          integer NOT NULL DEFAULT 1,
  created_by        text NOT NULL REFERENCES accounts (username),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CHECK ((kind = 'TEAM') = (project_id IS NULL))
);

CREATE TABLE workspace_groups (
  workspace_id  text NOT NULL REFERENCES workspaces (id),
  group_id      text NOT NULL REFERENCES business_groups (id),
  PRIMARY KEY (workspace_id, group_id)
);

CREATE TABLE workspace_scopes (
  workspace_id  text NOT NULL REFERENCES workspaces (id),
  scope         text NOT NULL CHECK (scope IN (
                  'Vehicle', 'Common', 'Chassis', 'Battery', 'Powertrain', 'HMI', 'ADC', 'CDC', 'Other')),
  PRIMARY KEY (workspace_id, scope)
);

-- Explicitly declared sources a PROJECT / INTEGRATION workspace may collect changes from.
CREATE TABLE workspace_sources (
  workspace_id         text NOT NULL REFERENCES workspaces (id),
  source_workspace_id  text NOT NULL REFERENCES workspaces (id),
  PRIMARY KEY (workspace_id, source_workspace_id),
  CHECK (workspace_id <> source_workspace_id)
);

-- ---------------------------------------------------------------------------
-- Processing catalog (DCL engineering)
-- ---------------------------------------------------------------------------

-- Immutable processing versions. A code belongs to exactly one side.
CREATE TABLE processing_pipelines (
  id          text PRIMARY KEY,
  code        text NOT NULL CHECK (code ~ '^[a-z][a-z0-9-]{1,60}$'),
  version     integer NOT NULL CHECK (version > 0),
  side        text NOT NULL CHECK (side IN ('EDGE', 'CLOUD')),
  name        text NOT NULL CHECK (length(name) BETWEEN 1 AND 100),
  formats     text[] NOT NULL CHECK (cardinality(formats) > 0),
  schemas     text[] NOT NULL CHECK (cardinality(schemas) > 0),
  steps       text[] NOT NULL CHECK (cardinality(steps) > 0),
  capability  text NOT NULL,
  created_by  text NOT NULL REFERENCES accounts (username),
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (code, version),
  CHECK (id = code || '@' || version)
);

-- Default Edge/Cloud binding per file type. The highest version is the current default.
CREATE TABLE processing_templates (
  id                      text PRIMARY KEY,
  file_type               text NOT NULL CHECK (file_type IN (
                            'text_log', 'bin_log', 'can_log', 'camera_image', 'camera_video',
                            'pointcloud', 'gnss', 'unknown')),
  version                 integer NOT NULL CHECK (version > 0),
  format                  text NOT NULL,
  schema                  text NOT NULL,
  edge_pipeline_id        text NOT NULL REFERENCES processing_pipelines (id),
  cloud_pipeline_id       text NOT NULL REFERENCES processing_pipelines (id),
  requires_review         boolean NOT NULL,
  default_privacy         text NOT NULL CHECK (default_privacy IN ('P1', 'P2', 'P3')),
  default_retention_days  integer NOT NULL CHECK (default_retention_days > 0),
  capability              text NOT NULL,
  created_by              text NOT NULL REFERENCES accounts (username),
  created_at              timestamptz NOT NULL DEFAULT now(),
  UNIQUE (file_type, version),
  CHECK (id = 'template-' || file_type || '@' || version)
);

-- ---------------------------------------------------------------------------
-- Config authoring: data identity, immutable versions, features, commits
-- ---------------------------------------------------------------------------

-- Stable data identity. data_key is platform generated and never derived from paths or names.
CREATE TABLE data_items (
  data_key          text PRIMARY KEY,
  data_code         text NOT NULL UNIQUE,
  owner_group_id    text NOT NULL REFERENCES business_groups (id),
  source_unit       text NOT NULL,
  source_directory  text NOT NULL,
  source_pattern    text NOT NULL,
  -- PENDING: registered, not yet committed. REVIEW: overlaps another source, awaiting DCL.
  status            text NOT NULL CHECK (status IN ('PENDING', 'REVIEW', 'ACTIVE', 'ARCHIVED')),
  overlap_suspects  text[] NOT NULL DEFAULT '{}',
  review_note       text,
  created_by        text NOT NULL REFERENCES accounts (username),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX data_items_source_uq
  ON data_items (source_unit, source_directory, source_pattern)
  WHERE status <> 'ARCHIVED';

CREATE TABLE file_spec_versions (
  id          uuid PRIMARY KEY DEFAULT uuidv7(),
  data_key    text NOT NULL REFERENCES data_items (data_key),
  version     integer NOT NULL CHECK (version > 0),
  digest      text NOT NULL,
  content     jsonb NOT NULL,
  created_by  text NOT NULL REFERENCES accounts (username),
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (data_key, version),
  UNIQUE (data_key, digest)
);

-- Logical policy identity; each policy id is owned by exactly one group.
CREATE TABLE policies (
  policy_id       text PRIMARY KEY,
  owner_group_id  text NOT NULL REFERENCES business_groups (id),
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE policy_versions (
  id          uuid PRIMARY KEY DEFAULT uuidv7(),
  policy_id   text NOT NULL REFERENCES policies (policy_id),
  version     integer NOT NULL CHECK (version > 0),
  digest      text NOT NULL,
  content     jsonb NOT NULL,
  created_by  text NOT NULL REFERENCES accounts (username),
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (policy_id, version),
  UNIQUE (policy_id, digest)
);

-- A group's file list version (文件列表).
CREATE TABLE manifest_versions (
  id          uuid PRIMARY KEY DEFAULT uuidv7(),
  group_id    text NOT NULL REFERENCES business_groups (id),
  version     integer NOT NULL CHECK (version > 0),
  digest      text NOT NULL,
  created_by  text NOT NULL REFERENCES accounts (username),
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (group_id, version),
  UNIQUE (group_id, digest)
);

CREATE TABLE manifest_entries (
  manifest_version_id   uuid NOT NULL REFERENCES manifest_versions (id),
  data_key              text NOT NULL REFERENCES data_items (data_key),
  file_spec_version_id  uuid NOT NULL REFERENCES file_spec_versions (id),
  PRIMARY KEY (manifest_version_id, data_key)
);

CREATE TABLE features (
  id                text PRIMARY KEY,
  workspace_id      text NOT NULL REFERENCES workspaces (id),
  group_id          text NOT NULL REFERENCES business_groups (id),
  vehicle_model_id  text NOT NULL REFERENCES vehicle_models (id),
  -- Inherited from the workspace; NULL while no project organization exists.
  project_id        text REFERENCES projects (id),
  name              text NOT NULL CHECK (name ~ '^[a-z][a-z0-9_-]{2,45}$'),
  description       text NOT NULL DEFAULT '',
  kind              text NOT NULL DEFAULT 'BUSINESS' CHECK (kind IN ('BUSINESS')),
  stage             text NOT NULL CHECK (stage IN ('DRAFT', 'SUBMITTED', 'DCL_READY')),
  -- NULL means the vehicle model's platform-managed, empty initial development configuration.
  base_release_id   text,
  head_commit_id    text,
  sequence          integer NOT NULL DEFAULT 0,
  draft             jsonb NOT NULL,
  revision          integer NOT NULL DEFAULT 1,
  created_by        text NOT NULL REFERENCES accounts (username),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (group_id, name)
);
CREATE INDEX features_workspace_idx ON features (workspace_id);

CREATE TABLE commits (
  id                   text PRIMARY KEY,
  feature_id           text NOT NULL REFERENCES features (id),
  group_id             text NOT NULL REFERENCES business_groups (id),
  parent_commit_id     text REFERENCES commits (id),
  sequence             integer NOT NULL CHECK (sequence > 0),
  base_release_id      text,
  manifest_version_id  uuid NOT NULL REFERENCES manifest_versions (id),
  digest               text NOT NULL,
  message              text NOT NULL DEFAULT '',
  author               text NOT NULL REFERENCES accounts (username),
  created_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (feature_id, sequence)
);

CREATE TABLE commit_policies (
  commit_id          text NOT NULL REFERENCES commits (id),
  policy_id          text NOT NULL REFERENCES policies (policy_id),
  policy_version_id  uuid NOT NULL REFERENCES policy_versions (id),
  PRIMARY KEY (commit_id, policy_id)
);

ALTER TABLE features
  ADD CONSTRAINT features_head_commit_fk FOREIGN KEY (head_commit_id) REFERENCES commits (id);

-- ---------------------------------------------------------------------------
-- Cross-cutting
-- ---------------------------------------------------------------------------

CREATE TABLE audit_events (
  id            bigserial PRIMARY KEY,
  occurred_at   timestamptz NOT NULL DEFAULT now(),
  username      text,
  role          text,
  grant_id      uuid,
  action        text NOT NULL,
  outcome       text NOT NULL CHECK (outcome IN ('ALLOWED', 'DENIED')),
  reason        text,
  target_type   text,
  target_id     text,
  workspace_id  text,
  request_id    text,
  details       jsonb
);
CREATE INDEX audit_events_occurred_idx ON audit_events (occurred_at DESC);
CREATE INDEX audit_events_target_idx ON audit_events (target_type, target_id);

-- Stored in the same transaction as the mutation, so a replay returns the committed result.
CREATE TABLE idempotency_keys (
  username     text NOT NULL,
  key          text NOT NULL,
  fingerprint  text NOT NULL,
  status_code  integer,
  response     jsonb,
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (username, key)
);
CREATE INDEX idempotency_keys_created_idx ON idempotency_keys (created_at);
