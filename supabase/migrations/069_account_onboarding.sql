-- ============================================================
-- 069_account_onboarding.sql — Sello del wizard por NEGOCIO
--
-- El wizard corto (fuentes de leads, metas, tamaño del equipo) se
-- muestra cuando el negocio activo no tiene todavía sus respuestas.
-- Este sello evita repetirlo cada vez: completarlo o saltarlo cierra
-- el paso para ese negocio, sin tocar el sello del usuario (que es el
-- del wizard largo).
--
-- Depende de 068 (columnas de 068 no se tocan aquí; solo añade una).
--
-- Entorno: primero en DEV, junto con el commit del wizard corto.
-- Idempotente — seguro de re-ejecutar.
-- ============================================================

ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS onboarding_completed_at TIMESTAMPTZ;

COMMENT ON COLUMN accounts.onboarding_completed_at IS
'069 — NULL = wizard CORTO del negocio pendiente (fuentes de leads,
metas, tamaño del equipo). Se sella al completarlo o saltarlo. El
sello del wizard largo vive en profiles.onboarding_completed_at
(068): son decisiones distintas, de personas y de empresas.';

-- ============================================================
-- ROLLBACK (NO se ejecuta solo)
--
--   ALTER TABLE accounts DROP COLUMN IF EXISTS onboarding_completed_at;
-- ============================================================
