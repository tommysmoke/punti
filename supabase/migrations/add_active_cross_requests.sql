CREATE TABLE IF NOT EXISTS active_cross_requests (
  id SERIAL PRIMARY KEY,
  requesting_store TEXT NOT NULL,
  requesting_store_id TEXT NOT NULL,
  created_by UUID REFERENCES profiles(id),
  items JSONB NOT NULL,
  remaining JSONB NOT NULL,
  confirmed JSONB DEFAULT '[]',
  ranking JSONB NOT NULL,
  current_index INT DEFAULT 0,
  timer_started TIMESTAMPTZ NOT NULL DEFAULT now(),
  status TEXT DEFAULT 'active',
  aggregate_notification_id BIGINT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS active_cross_requests_status_idx
  ON active_cross_requests(status)
  WHERE status = 'active';

ALTER TABLE active_cross_requests ENABLE ROW LEVEL SECURITY;

-- Any authenticated store user can read all active requests (needed for polling/cascade)
DROP POLICY IF EXISTS "active_cross_requests_store_read" ON active_cross_requests;
CREATE POLICY "active_cross_requests_store_read" ON active_cross_requests
FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.role = 'store'
  )
);

-- Only the requesting store can insert their own requests
DROP POLICY IF EXISTS "active_cross_requests_store_insert" ON active_cross_requests;
CREATE POLICY "active_cross_requests_store_insert" ON active_cross_requests
FOR INSERT WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.role = 'store'
  )
  AND created_by = auth.uid()
);

-- Any authenticated store user can update active requests (needed for cascade advancement)
DROP POLICY IF EXISTS "active_cross_requests_store_update" ON active_cross_requests;
CREATE POLICY "active_cross_requests_store_update" ON active_cross_requests
FOR UPDATE USING (
  EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.role = 'store'
  )
);

-- Only the creating user can delete their own requests
DROP POLICY IF EXISTS "active_cross_requests_store_delete" ON active_cross_requests;
CREATE POLICY "active_cross_requests_store_delete" ON active_cross_requests
FOR DELETE USING (
  EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.role = 'store'
  )
  AND created_by = auth.uid()
);
