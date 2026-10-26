-- ============================================================
-- 080_account_modules.sql — Módulos habilitados por negocio
--
-- Cada cuenta (negocio) puede limitar qué secciones ve su equipo.
-- `NULL` o arreglo vacío = todos los módulos habilitados, que es el
-- comportamiento actual para las cuentas ya existentes.
--
-- Idempotente.
-- ============================================================

ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS enabled_modules TEXT[];

COMMENT ON COLUMN accounts.enabled_modules IS
  'Claves de módulos habilitados (ver src/lib/modules.ts). NULL o vacío = todos.';

NOTIFY pgrst, 'reload schema';
