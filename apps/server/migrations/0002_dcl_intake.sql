-- Slice 2: DCL intake (sensitive review, feedback) and cross-group read-only references.

-- Drafts gain a `references` section: data_key -> pinned file_spec_versions.id of another group.
UPDATE features SET draft = draft || '{"references": {}}'::jsonb WHERE NOT draft ? 'references';

-- A DCL decision on one committed file in the context of the policies that capture it. Approval
-- is bound to content signatures within one group and workspace, not to a Feature: the latest
-- decision (highest seq) for the same key applies to every Feature there with that content,
-- so a rejection revokes earlier approvals.
CREATE TABLE sensitive_reviews (
  id                uuid PRIMARY KEY DEFAULT uuidv7(),
  -- Decision order. Assigned under the group's intake lock, so it matches commit order.
  seq               bigserial NOT NULL UNIQUE,
  group_id          text NOT NULL REFERENCES business_groups (id),
  workspace_id      text NOT NULL REFERENCES workspaces (id),
  data_key          text NOT NULL REFERENCES data_items (data_key),
  feature_id        text NOT NULL REFERENCES features (id),
  commit_id         text NOT NULL REFERENCES commits (id),
  file_signature    text NOT NULL,
  policy_signature  text NOT NULL,
  decision          text NOT NULL CHECK (decision IN ('APPROVED', 'REJECTED')),
  reason            text NOT NULL CHECK (length(reason) > 0),
  controls          jsonb,
  reviewer          text NOT NULL REFERENCES accounts (username),
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sensitive_reviews_key_idx
  ON sensitive_reviews (group_id, workspace_id, data_key, file_signature, policy_signature, seq DESC);

-- Messages to the Feature's authors: from DCL engineering, or a revoked reference.
CREATE TABLE feature_feedback (
  id          uuid PRIMARY KEY DEFAULT uuidv7(),
  feature_id  text NOT NULL REFERENCES features (id),
  commit_id   text REFERENCES commits (id),
  kind        text NOT NULL CHECK (kind IN ('RETURNED', 'REVIEW_REJECTED', 'BINDING_CHANGED', 'REFERENCE_REVOKED')),
  data_key    text,
  reason      text NOT NULL CHECK (length(reason) > 0),
  author      text NOT NULL REFERENCES accounts (username),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX feature_feedback_feature_idx ON feature_feedback (feature_id, created_at DESC);

-- Read-only reference authorization for another group's data item. Ownership never moves.
CREATE TABLE reference_requests (
  id               uuid PRIMARY KEY DEFAULT uuidv7(),
  data_key         text NOT NULL REFERENCES data_items (data_key),
  reader_group_id  text NOT NULL REFERENCES business_groups (id),
  status           text NOT NULL CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED', 'REVOKED')),
  request_reason   text NOT NULL CHECK (length(request_reason) > 0),
  decision_reason  text,
  requested_by     text NOT NULL REFERENCES accounts (username),
  decided_by       text REFERENCES accounts (username),
  created_at       timestamptz NOT NULL DEFAULT now(),
  decided_at       timestamptz
);
-- At most one open request or active grant per data item and reader group.
CREATE UNIQUE INDEX reference_requests_open_uq
  ON reference_requests (data_key, reader_group_id) WHERE status IN ('PENDING', 'APPROVED');
