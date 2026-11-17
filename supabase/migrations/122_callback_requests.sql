-- ============================================================
-- 122_callback_requests.sql — devolución de llamadas perdidas
--
-- Cuando una entrante no se contesta (timeout de cola, rechazo del
-- agente o cuelgue del cliente antes de contestar), la llamada se
-- cierra como perdida y aquí queda una solicitud de devolución.
-- El agente la reclama, marca desde el softphone y la cierra.
--
-- También admite altas manuales ("el cliente pidió que lo llamen").
--
-- Estados:   pending → in_progress → done
--                                     ↘ cancelled
-- Una llamada de origen genera como máximo una solicitud (índice
-- único en `source_call_id`; las manuales llevan NULL).
--
-- Requiere 112 (call_sessions) y la tabla `contacts`. Idempotente.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.callback_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  -- Número a devolver, en E.164 (se normaliza en la app).
  phone TEXT NOT NULL,
  -- Llamada perdida que la originó (NULL si es manual).
  source_call_id UUID REFERENCES call_sessions(id) ON DELETE SET NULL,
  reason TEXT NOT NULL DEFAULT 'missed'
    CHECK (reason IN ('missed', 'timeout', 'declined', 'manual')),
  note TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'in_progress', 'done', 'cancelled')),
  assigned_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  claimed_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  completed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  -- Llamada saliente con la que se atendió (si se marcó desde el CRM).
  call_session_id UUID REFERENCES call_sessions(id) ON DELETE SET NULL,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT callback_requests_phone_len
    CHECK (char_length(phone) BETWEEN 7 AND 32),
  CONSTRAINT callback_requests_note_len
    CHECK (note IS NULL OR char_length(note) <= 500)
);

-- Una sola devolución por llamada perdida. Los NULL (manuales) no
-- colisionan entre sí.
CREATE UNIQUE INDEX IF NOT EXISTS idx_callback_requests_source_call
  ON public.callback_requests(source_call_id);

CREATE INDEX IF NOT EXISTS idx_callback_requests_queue
  ON public.callback_requests(account_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_callback_requests_assignee
  ON public.callback_requests(account_id, assigned_user_id, status);

ALTER TABLE public.callback_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS callback_requests_select ON public.callback_requests;
DROP POLICY IF EXISTS callback_requests_insert ON public.callback_requests;
DROP POLICY IF EXISTS callback_requests_update ON public.callback_requests;
DROP POLICY IF EXISTS callback_requests_delete ON public.callback_requests;

CREATE POLICY callback_requests_select ON public.callback_requests
  FOR SELECT USING (is_account_member(account_id));

CREATE POLICY callback_requests_insert ON public.callback_requests
  FOR INSERT WITH CHECK (is_account_member(account_id, 'agent'));

-- Cualquier agente puede reclamar una pendiente; una vez asignada,
-- solo su dueño (o admin+) puede moverla. El `WITH CHECK` repite la
-- regla para que tampoco pueda reasignarse a un tercero.
CREATE POLICY callback_requests_update ON public.callback_requests
  FOR UPDATE
  USING (
    is_account_member(account_id, 'agent')
    AND (
      assigned_user_id IS NULL
      OR assigned_user_id = auth.uid()
      OR is_account_member(account_id, 'admin')
    )
  )
  WITH CHECK (
    is_account_member(account_id, 'agent')
    AND (
      assigned_user_id IS NULL
      OR assigned_user_id = auth.uid()
      OR is_account_member(account_id, 'admin')
    )
  );

CREATE POLICY callback_requests_delete ON public.callback_requests
  FOR DELETE USING (is_account_member(account_id, 'admin'));

DROP TRIGGER IF EXISTS callback_requests_updated_at ON public.callback_requests;
CREATE TRIGGER callback_requests_updated_at
  BEFORE UPDATE ON public.callback_requests
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.callback_requests TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ============================================================
-- Rollback
--
--   DROP TABLE IF EXISTS public.callback_requests;
--   NOTIFY pgrst, 'reload schema';
-- ============================================================
