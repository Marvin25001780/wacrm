-- ============================================================
-- 042_segments.sql — Segmentación dinámica (contactos y leads)
--
-- Guarda segmentos reutilizables como un árbol plano de reglas
-- (`rules` jsonb). Los segmentos son *dinámicos*: se evalúan al
-- consultarlos (ver `src/lib/segments/rules.ts`), así que nunca se
-- desincronizan del origen.
--
-- `entity` limita el universo del segmento a contactos o leads.
-- `rules` es un arreglo de condiciones:
--   [{ "field": "status", "operator": "equals", "value": "qualified" }]
--
-- Idempotente — seguro de re-ejecutar.
-- ============================================================

CREATE TABLE IF NOT EXISTS segments (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id  uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  name        text NOT NULL,
  description text,
  entity      text NOT NULL CHECK (entity IN ('contacts', 'leads')),
  rules       jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_segments_account ON segments(account_id);

ALTER TABLE segments ENABLE ROW LEVEL SECURITY;

-- Cualquier miembro puede leer los segmentos de su cuenta.
DROP POLICY IF EXISTS segments_select ON segments;
CREATE POLICY segments_select ON segments FOR SELECT
  USING (is_account_member(account_id, 'viewer'));

-- Agent+ puede crear / editar / borrar.
DROP POLICY IF EXISTS segments_insert ON segments;
CREATE POLICY segments_insert ON segments FOR INSERT
  WITH CHECK (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS segments_update ON segments;
CREATE POLICY segments_update ON segments FOR UPDATE
  USING (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS segments_delete ON segments;
CREATE POLICY segments_delete ON segments FOR DELETE
  USING (is_account_member(account_id, 'agent'));

DROP TRIGGER IF EXISTS update_segments_updated_at ON segments;
CREATE TRIGGER update_segments_updated_at
  BEFORE UPDATE ON segments
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Incluir los segmentos en la bitácora de auditoría (migración 041).
DROP TRIGGER IF EXISTS audit_segments ON segments;
CREATE TRIGGER audit_segments
  AFTER INSERT OR UPDATE OR DELETE ON segments
  FOR EACH ROW EXECUTE FUNCTION public.audit_row();
