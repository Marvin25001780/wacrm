-- ============================================================
-- 067_multi_numero.sql — Varios números de WhatsApp por cuenta
--
-- Objetivo: que una misma cuenta ("negocio") pueda conectar N
-- líneas de WhatsApp, que cada hilo quede atado al número por el
-- que entró, y que al responder se use ESE número (no "el único
-- que había"). Diseño B, doc
-- docs/diseno-multiespacio-y-varios-numeros.md §3.
--
-- Idea central
--   - `whatsapp_config` deja de ser una fila por cuenta: pasa a ser
--     una lista de líneas, con `label` (nombre visible) e
--     `is_default` (la que se usa cuando el hilo no dice otra cosa).
--   - `conversations.whatsapp_config_id` dice por qué línea entró
--     cada hilo. Un contacto que escribe a dos números tiene DOS
--     conversaciones, y se responde por la suya.
--   - Las plantillas son por WABA (no por número): se guarda
--     `waba_id` en `message_templates` para no mezclar plantillas
--     cuando dos líneas viven en WABAs distintas.
--
-- Contenido:
--   1. Pre-vuelo (una línea por cuenta como máximo hoy).
--   2. `whatsapp_config`: quitar UNIQUE(account_id), añadir
--      `label` + `is_default` (+ índice parcial único y trigger que
--      garantiza UNA sola por defecto).
--   3. Endurecer `user_id`: nullable + FK ON DELETE SET NULL (si se
--      borra al admin que conectó la línea, no se pierde el número).
--   4. `conversations.whatsapp_config_id` + backfill + índice.
--   5. `message_templates.waba_id` + backfill + índice único por
--      (account_id, waba_id, name, language).
--   6. Comprobaciones finales.
--
-- Entorno: se aplica primero en DEV. Producción solo cuando se pida.
-- Idempotente — seguro de re-ejecutar.
-- ============================================================

-- ============================================================
-- 1. PRE-VUELO
--
-- El backfill de `is_default` asume que hoy hay como máximo una
-- línea por cuenta. Esa garantía la daba la restricción
-- `whatsapp_config_account_id_key`, que este script borra en el paso
-- 2: mientras siga en pie, duplicados son imposibles. La
-- comprobación se limita a esa situación (la primera aplicación), de
-- forma que re-ejecutar 067 más adelante —cuando una cuenta YA tiene
-- varias líneas— no aborta con un error confuso.
-- ============================================================
DO $$
DECLARE
  v_multi INTEGER;
  v_has_unique BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'whatsapp_config_account_id_key'
      AND conrelid = 'whatsapp_config'::regclass
  ) INTO v_has_unique;

  IF NOT v_has_unique THEN
    RETURN; -- ya migrado (o migrándose): no hay nada que comprobar
  END IF;

  SELECT count(*) INTO v_multi
  FROM (
    SELECT account_id
    FROM whatsapp_config
    GROUP BY account_id
    HAVING count(*) > 1
  ) dup;

  IF v_multi > 0 THEN
    RAISE EXCEPTION
      'Pre-vuelo 067: % cuenta(s) ya tienen mas de una fila en whatsapp_config; revisa antes de aplicar.',
      v_multi;
  END IF;
END $$;

-- ============================================================
-- 2. whatsapp_config — N líneas por cuenta
-- ============================================================

-- 2.1 Una cuenta puede tener varias líneas.
ALTER TABLE whatsapp_config
  DROP CONSTRAINT IF EXISTS whatsapp_config_account_id_key;

-- 2.2 Nombre visible y marca de "por defecto".
ALTER TABLE whatsapp_config
  ADD COLUMN IF NOT EXISTS label TEXT;
ALTER TABLE whatsapp_config
  ADD COLUMN IF NOT EXISTS is_default BOOLEAN NOT NULL DEFAULT false;

-- 2.3 Backfill: la línea que ya existía pasa a ser la de por defecto
-- (una sola por cuenta, aunque hubiera varias: se ordena por
-- antigüedad para que el resultado sea determinista).
UPDATE whatsapp_config w
SET is_default = true
WHERE w.id IN (
  SELECT DISTINCT ON (account_id) id
  FROM whatsapp_config
  ORDER BY account_id, created_at NULLS FIRST, id
)
AND NOT EXISTS (
  SELECT 1 FROM whatsapp_config d
  WHERE d.account_id = w.account_id AND d.is_default
);

-- 2.4 Como mucho UNA por defecto por cuenta (red de seguridad; el
-- trigger del paso 2.5 es el que evita el conflicto al vuelo).
CREATE UNIQUE INDEX IF NOT EXISTS idx_whatsapp_config_one_default
  ON whatsapp_config(account_id)
  WHERE is_default;

-- 2.5 Marcar una línea como "por defecto" desmarca la anterior en la
-- misma sentencia: sin esto, el índice parcial de 2.4 rechazaría el
-- UPDATE y el usuario vería un error opaco en Ajustes.
CREATE OR REPLACE FUNCTION whatsapp_config_single_default()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.is_default THEN
    UPDATE whatsapp_config
    SET is_default = false
    WHERE account_id = NEW.account_id
      AND id IS DISTINCT FROM NEW.id
      AND is_default;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS whatsapp_config_single_default ON whatsapp_config;
CREATE TRIGGER whatsapp_config_single_default
  BEFORE INSERT OR UPDATE OF is_default ON whatsapp_config
  FOR EACH ROW EXECUTE FUNCTION whatsapp_config_single_default();

-- ============================================================
-- 3. user_id deja de ser obligatorio
--
-- `whatsapp_config.user_id` nació como "el usuario que conectó la
-- línea" con ON DELETE CASCADE: borrar esa cuenta de usuario se
-- llevaba el número por delante. Ahora es opcional y la FK no
-- borra nada (`SET NULL`); el código que necesite un `user_id` para
-- estampar filas cae al dueño de la cuenta.
-- ============================================================
ALTER TABLE whatsapp_config ALTER COLUMN user_id DROP NOT NULL;

ALTER TABLE whatsapp_config
  DROP CONSTRAINT IF EXISTS whatsapp_config_user_id_fkey;
ALTER TABLE whatsapp_config
  ADD CONSTRAINT whatsapp_config_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;

-- ============================================================
-- 4. conversations — ¿por qué número entró este hilo?
-- ============================================================
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS whatsapp_config_id UUID
  REFERENCES whatsapp_config(id) ON DELETE SET NULL;

-- Backfill: los hilos de WhatsApp ya existentes apuntan a la línea
-- por defecto de su cuenta (hoy, la única que había).
UPDATE conversations c
SET whatsapp_config_id = (
  SELECT w.id
  FROM whatsapp_config w
  WHERE w.account_id = c.account_id
  ORDER BY w.is_default DESC, w.created_at NULLS FIRST, w.id
  LIMIT 1
)
WHERE c.whatsapp_config_id IS NULL
  AND c.channel = 'whatsapp';

CREATE INDEX IF NOT EXISTS idx_conversations_whatsapp_config
  ON conversations(whatsapp_config_id);

-- ============================================================
-- 5. message_templates — las plantillas son por WABA
-- ============================================================
ALTER TABLE message_templates
  ADD COLUMN IF NOT EXISTS waba_id TEXT;

-- Backfill desde la línea por defecto de la cuenta.
UPDATE message_templates t
SET waba_id = (
  SELECT w.waba_id
  FROM whatsapp_config w
  WHERE w.account_id = t.account_id
    AND w.waba_id IS NOT NULL
  ORDER BY w.is_default DESC, w.created_at NULLS FIRST, w.id
  LIMIT 1
)
WHERE t.waba_id IS NULL;

-- 5.1 Pre-vuelo del índice único: si ya hubiera filas duplicadas, el
-- CREATE UNIQUE INDEX fallaría con un error crudo. Mejor abortar con
-- un mensaje que diga qué filas sobran.
DO $$
DECLARE
  v_dup INTEGER;
BEGIN
  SELECT count(*) INTO v_dup
  FROM (
    SELECT account_id, coalesce(waba_id, ''), name, coalesce(language, '')
    FROM message_templates
    GROUP BY 1, 2, 3, 4
    HAVING count(*) > 1
  ) d;

  IF v_dup > 0 THEN
    RAISE EXCEPTION
      'Pre-vuelo 067: % combinacion(es) duplicadas de (account_id, waba_id, name, language) en message_templates. Borra las que sobren antes de aplicar.',
      v_dup;
  END IF;
END $$;

-- 5.2 El único que manda pasa a ser (cuenta, WABA, nombre, idioma).
-- Columnas simples (no expresiones) para que el `upsert` de PostgREST
-- pueda usarlo como `onConflict`; `NULLS NOT DISTINCT` (PG15+) hace que
-- dos filas sin WABA o sin idioma también choquen, igual que el
-- pre-vuelo de 5.1.
DROP INDEX IF EXISTS message_templates_user_name_language_key;
CREATE UNIQUE INDEX IF NOT EXISTS message_templates_account_waba_name_lang_key
  ON message_templates(account_id, waba_id, name, language)
  NULLS NOT DISTINCT;

-- ============================================================
-- 6. COMPROBACIONES FINALES
-- ============================================================
DO $$
DECLARE
  v_no_default INTEGER;
  v_multi_default INTEGER;
BEGIN
  -- Toda cuenta con líneas debe tener exactamente una por defecto.
  SELECT count(*) INTO v_no_default
  FROM (
    SELECT account_id FROM whatsapp_config GROUP BY account_id
  ) a
  WHERE NOT EXISTS (
    SELECT 1 FROM whatsapp_config w
    WHERE w.account_id = a.account_id AND w.is_default
  );

  IF v_no_default > 0 THEN
    RAISE EXCEPTION
      '067: % cuenta(s) con lineas de WhatsApp y sin ninguna por defecto',
      v_no_default;
  END IF;

  SELECT count(*) INTO v_multi_default
  FROM (
    SELECT account_id FROM whatsapp_config WHERE is_default GROUP BY account_id
    HAVING count(*) > 1
  ) d;

  IF v_multi_default > 0 THEN
    RAISE EXCEPTION
      '067: % cuenta(s) con mas de una linea por defecto',
      v_multi_default;
  END IF;
END $$;

-- ============================================================
-- ROLLBACK (solo si algo sale mal; NO se ejecuta solo)
--
--   DROP TRIGGER IF EXISTS whatsapp_config_single_default ON whatsapp_config;
--   DROP FUNCTION IF EXISTS whatsapp_config_single_default();
--   DROP INDEX IF EXISTS idx_whatsapp_config_one_default;
--   ALTER TABLE whatsapp_config DROP COLUMN IF EXISTS is_default;
--   ALTER TABLE whatsapp_config DROP COLUMN IF EXISTS label;
--
--   -- Volver a una sola línea por cuenta exige borrar antes las
--   -- líneas extra: si ya hay más de una, la restricción fallará (es
--   -- la señal de que el rollback completo ya no es inocuo).
--   ALTER TABLE whatsapp_config
--     ADD CONSTRAINT whatsapp_config_account_id_key UNIQUE (account_id);
--
--   ALTER TABLE conversations DROP COLUMN IF EXISTS whatsapp_config_id;
--   ALTER TABLE message_templates DROP COLUMN IF EXISTS waba_id;
--   CREATE UNIQUE INDEX IF NOT EXISTS message_templates_user_name_language_key
--     ON message_templates(user_id, name, language);
--
--   -- user_id: revertir a NOT NULL solo si ninguna fila quedó con NULL.
--   ALTER TABLE whatsapp_config
--     DROP CONSTRAINT IF EXISTS whatsapp_config_user_id_fkey;
--   ALTER TABLE whatsapp_config
--     ADD CONSTRAINT whatsapp_config_user_id_fkey
--     FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
--   ALTER TABLE whatsapp_config ALTER COLUMN user_id SET NOT NULL;
-- ============================================================
