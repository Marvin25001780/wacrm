-- ============================================================
-- 068_onboarding.sql — Wizard de bienvenida (estilo Kommo)
--
-- Objetivo: que un usuario nuevo (o uno que aún no completó el
-- onboarding) responda —en minutos— la info con la que el CRM se
-- personaliza de verdad: qué quiere lograr, de dónde vienen sus
-- leads, cuántos lo usarán y cómo se llama su negocio. Y que el
-- wizard solo aparezca UNA vez.
--
-- Reparto de columnas (modelo, no solo datos):
--   - `profiles`  = la PERSONA: industria y cargo; además
--     `onboarding_completed_at` como el "ya vi el wizard" (NULL =
--     pendiente). Así cada miembro conserva sus respuestas aunque se
--     mude de negocio, y si multiplicamos espacios no hay que
--     repetir el cuestionario.
--   - `accounts`  = el NEGOCIO: fuentes de leads, metas, tamaño del
--     equipo y sitio web. Son de la empresa: se comparten con el
--     equipo y son las que alimentarán plantillas por industria y
--     métricas por perfil.
--
-- OJO: `onboarding_completed_at` NULL en TODO usuario existente
-- (incluido el admin de producción), así que el wizard les
-- aparecerá una vez: eso es lo esperado — Kommo hace lo mismo.
-- Puede saltarse con la X; el salto se guarda y no vuelve.
--
-- Entorno: se aplica primero en DEV (068 junto con el commit del
-- wizard: el código lee estas columnas en el `select` del perfil).
-- Idempotente — seguro de re-ejecutar.
-- ============================================================

-- ============================================================
-- 1. La persona
-- ============================================================
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS industry TEXT;

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS role_title TEXT;

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS onboarding_completed_at TIMESTAMPTZ;

COMMENT ON COLUMN profiles.onboarding_completed_at IS
'NULL = wizard de onboarding pendiente. Se sella (NOW()) al
completarlo O al saltarlo: un salto también cierra el wizard.';

-- ============================================================
-- 2. El negocio
-- ============================================================
ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS lead_sources TEXT[] NOT NULL DEFAULT '{}';

ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS goals TEXT[] NOT NULL DEFAULT '{}';

ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS team_size TEXT;

ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS website TEXT;

COMMENT ON COLUMN accounts.lead_sources IS
'068 — De dónde vienen los leads, según el onboarding
(whatsapp, instagram, facebook, tiktok, sms, web, llamadas, otras
...) con sus IDs cortos de canal cuando aplica.';
COMMENT ON COLUMN accounts.goals IS
'068 — Objetivos elegidos en el onboarding, máx. 2 (buena
segmentación sin ruido).';
COMMENT ON COLUMN accounts.team_size IS
'068 — Tamaño del equipo declarado en el onboarding (solo_yo,
2_3, 4_5, 6_10, 11_20, 21_50, 51_100, 101_mas).';
COMMENT ON COLUMN accounts.website IS
'068 — Sitio web o redes sociales del negocio (opcional).';

-- ============================================================
-- ROLLBACK (solo si algo sale mal; NO se ejecuta solo)
--
--   ALTER TABLE accounts
--     DROP COLUMN IF EXISTS lead_sources,
--     DROP COLUMN IF EXISTS goals,
--     DROP COLUMN IF EXISTS team_size,
--     DROP COLUMN IF EXISTS website;
--   ALTER TABLE profiles
--     DROP COLUMN IF EXISTS industry,
--     DROP COLUMN IF EXISTS role_title,
--     DROP COLUMN IF EXISTS onboarding_completed_at;
-- ============================================================
