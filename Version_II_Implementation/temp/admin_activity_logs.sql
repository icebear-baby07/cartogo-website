-- Run in Supabase SQL Editor.
-- Log only sanitized activity metadata; never store secrets, tokens, or full records here.
CREATE TABLE IF NOT EXISTS public.admin_activity_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  actor_id uuid,
  actor_email text NOT NULL,
  action text NOT NULL,
  resource text NOT NULL,
  resource_id text,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT admin_activity_logs_actor_email_not_empty
    CHECK (length(trim(actor_email)) > 0),
  CONSTRAINT admin_activity_logs_action_not_empty
    CHECK (length(trim(action)) > 0),
  CONSTRAINT admin_activity_logs_resource_not_empty
    CHECK (length(trim(resource)) > 0),
  CONSTRAINT admin_activity_logs_details_object
    CHECK (jsonb_typeof(details) = 'object')
);

CREATE INDEX IF NOT EXISTS admin_activity_logs_occurred_at_idx
  ON public.admin_activity_logs (occurred_at DESC);

CREATE INDEX IF NOT EXISTS admin_activity_logs_actor_id_occurred_at_idx
  ON public.admin_activity_logs (actor_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS admin_activity_logs_resource_action_occurred_at_idx
  ON public.admin_activity_logs (resource, action, occurred_at DESC);

ALTER TABLE public.admin_activity_logs ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.admin_activity_logs FROM anon, authenticated;
GRANT SELECT, INSERT ON TABLE public.admin_activity_logs TO service_role;

COMMENT ON TABLE public.admin_activity_logs IS
  'Append-only admin activity log. Access is intended for trusted server-side code using the Supabase service role.';
COMMENT ON COLUMN public.admin_activity_logs.details IS
  'Sanitized, non-sensitive event metadata only. Do not store credentials, tokens, or full customer records.';
