-- submissions: raw payloads as received. payload_hash catches exact resends.
-- No application_reference means no transform job; its form goes to needs_review.
CREATE TABLE submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_reference text,
  payload_hash text NOT NULL,
  payload jsonb NOT NULL,
  duplicate_count integer NOT NULL DEFAULT 0,
  received_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT submissions_payload_hash_key UNIQUE (payload_hash)
);
-- Finds all versions of an application.
CREATE INDEX submissions_application_reference_idx
  ON submissions (application_reference);

-- postcodes: one row per normalised UK postcode (uppercase, no spaces), plus its
-- cached coordinates. Forms reference it by id; geocode fills the coordinates once.
CREATE TABLE postcodes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  postcode text NOT NULL UNIQUE
    CHECK (postcode ~ '^[A-Z]{1,2}[0-9][A-Z0-9]?[0-9][A-Z]{2}$'),
  latitude numeric,
  longitude numeric,
  geocoded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  -- Coordinates are set together, or not at all.
  CONSTRAINT postcodes_coords_together CHECK (
    (latitude IS NULL AND longitude IS NULL AND geocoded_at IS NULL)
    OR (latitude IS NOT NULL AND longitude IS NOT NULL AND geocoded_at IS NOT NULL)
  )
);

-- forms: one row per application. Created empty ('pending') at ingest by the first
-- submission for a reference.
CREATE TABLE forms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_reference text UNIQUE,
  submission_id uuid NOT NULL REFERENCES submissions(id),
  session_id text,
  first_name text,
  last_name text,
  email text,
  gender text
    CHECK (gender IN ('male','female','prefer-not-to-say')),
  date_of_birth date,
  phone_number text,
  mobile_number text,
  address_line_1 text,
  address_line_2 text,
  address_line_3 text,
  postcode_id uuid REFERENCES postcodes(id),
  country text,
  status text NOT NULL
    CHECK (status IN ('pending','transformed','enriched','needs_review','failed')),
  status_reason text,
  has_conflicting_versions boolean NOT NULL DEFAULT false,
  formbot_delivered_at timestamptz,
  email_sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- Delivered forms stay enriched.
  CONSTRAINT forms_delivered_is_enriched CHECK (
    formbot_delivered_at IS NULL
    OR status = 'enriched'
  ),
  -- Forms without a reference never leave review.
  CONSTRAINT forms_unreferenced_needs_review CHECK (
    application_reference IS NOT NULL
    OR status = 'needs_review'
  )
);
CREATE INDEX forms_submission_id_idx
  ON forms (submission_id);
CREATE INDEX forms_postcode_id_idx
  ON forms (postcode_id);

-- jobs: work queue. 'dead' means retries ran out.
CREATE TABLE jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id uuid NOT NULL REFERENCES submissions(id),
  form_id uuid NOT NULL REFERENCES forms(id),
  type text NOT NULL
    CHECK (type IN ('transform','geocode','send_email','deliver_formbot')),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','running','succeeded','dead')),
  attempts integer NOT NULL DEFAULT 0,
  run_at timestamptz NOT NULL DEFAULT now(),
  deadline_at timestamptz NOT NULL,
  locked_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT jobs_submission_id_type_key UNIQUE (submission_id, type)
);
-- One job of each type per form.
CREATE UNIQUE INDEX jobs_form_id_type_key
  ON jobs (form_id, type);
-- For the job claim query.
CREATE INDEX jobs_pending_idx
  ON jobs (run_at)
  WHERE status = 'pending';
CREATE INDEX jobs_running_idx
  ON jobs (locked_at)
  WHERE status = 'running';
