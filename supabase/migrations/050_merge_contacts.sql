-- ============================================================
-- 050_merge_contacts.sql — Vincular una conversación (y su lead) a
-- un contacto/lead que YA estaba guardado, desde la Bandeja.
--
-- Contexto: cuando entra un mensaje de un canal del que no conocemos
-- ningún dato del cliente (p. ej. un DM de Instagram), se crea un
-- contacto y un lead nuevos. Más tarde el agente puede caer en cuenta
-- de que esa persona ya estaba registrada y quiere vincular el hilo
-- al contacto existente.
--
-- Este RPC fusiona el contacto "perdedor" (el recién creado) en el
-- "superviviente" (el que el agente elige) re-apuntando TODAS las
-- referencias antes de borrar el perdedor, para no perder
-- conversaciones/mensajes, negocios, notas, etiquetas, actividades,
-- adjuntos, cobros, flujos, notificaciones ni espacios. Misma
-- filosofía que `merge_duplicate_contacts()` (migración 022), pero
-- para un par concreto elegido a mano y con las tablas añadidas
-- después (leads, activities, attachments, notes, receivables,
-- notifications, spaces).
--
-- Seguridad: SECURITY DEFINER (para poder re-apuntar en todas las
-- tablas sin chocar con RLS) + validación explícita de que el usuario
-- es miembro de la cuenta y de que ambos contactos son de la misma
-- cuenta. Un cliente autenticado no puede fusionar contactos ajenos.
--
-- Idempotente (CREATE OR REPLACE). Seguro de re-ejecutar.
-- ============================================================

CREATE OR REPLACE FUNCTION public.merge_contacts(
  p_survivor uuid,
  p_loser uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account        uuid;
  v_surv_lead      uuid;
  v_loser_lead     uuid;
  v_loser_name     text;
  v_loser_email    text;
  v_loser_document text;
  v_loser_company  text;
  v_loser_phone    text;
BEGIN
  -- Nada que hacer si falta algún id o son el mismo contacto.
  IF p_survivor IS NULL OR p_loser IS NULL OR p_survivor = p_loser THEN
    RETURN;
  END IF;

  SELECT account_id INTO v_account FROM contacts WHERE id = p_survivor;
  IF v_account IS NULL THEN
    RAISE EXCEPTION 'El contacto de destino no existe';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM contacts WHERE id = p_loser AND account_id = v_account
  ) THEN
    RAISE EXCEPTION 'Los contactos no pertenecen a la misma cuenta';
  END IF;

  -- Autorización: miembro de la cuenta con rol de agente o superior.
  IF NOT is_account_member(v_account, 'agent'::account_role_enum) THEN
    RAISE EXCEPTION 'No autorizado';
  END IF;

  -- 1) Referencias directas al contacto (sin índices únicos). ---------
  UPDATE conversations                 SET contact_id = p_survivor WHERE contact_id = p_loser;
  UPDATE contact_notes                 SET contact_id = p_survivor WHERE contact_id = p_loser;
  UPDATE deals                         SET contact_id = p_survivor WHERE contact_id = p_loser;
  UPDATE broadcast_recipients          SET contact_id = p_survivor WHERE contact_id = p_loser;
  UPDATE automation_logs               SET contact_id = p_survivor WHERE contact_id = p_loser;
  UPDATE automation_pending_executions SET contact_id = p_survivor WHERE contact_id = p_loser;
  UPDATE activities                    SET contact_id = p_survivor WHERE contact_id = p_loser;
  UPDATE attachments                   SET contact_id = p_survivor WHERE contact_id = p_loser;
  UPDATE notes                         SET contact_id = p_survivor WHERE contact_id = p_loser;
  UPDATE notifications                 SET contact_id = p_survivor WHERE contact_id = p_loser;
  UPDATE receivables                   SET contact_id = p_survivor WHERE contact_id = p_loser;
  UPDATE leads                         SET converted_contact_id = p_survivor WHERE converted_contact_id = p_loser;
  UPDATE space_records
    SET entity_id = p_survivor
    WHERE entity_type = 'contact' AND entity_id = p_loser;

  -- 2) contact_tags: UNIQUE(contact_id, tag_id) — mover solo las que el
  --    superviviente no tenga ya; el resto se descarta.
  UPDATE contact_tags ct
    SET contact_id = p_survivor
    WHERE ct.contact_id = p_loser
      AND NOT EXISTS (
        SELECT 1 FROM contact_tags s
        WHERE s.contact_id = p_survivor AND s.tag_id = ct.tag_id
      );
  DELETE FROM contact_tags WHERE contact_id = p_loser;

  -- 3) contact_custom_values: UNIQUE(contact_id, custom_field_id) — el
  --    valor del superviviente gana en conflicto.
  UPDATE contact_custom_values cv
    SET contact_id = p_survivor
    WHERE cv.contact_id = p_loser
      AND NOT EXISTS (
        SELECT 1 FROM contact_custom_values s
        WHERE s.contact_id = p_survivor AND s.custom_field_id = cv.custom_field_id
      );
  DELETE FROM contact_custom_values WHERE contact_id = p_loser;

  -- 4) flow_runs: índice parcial UNIQUE por (cuenta, contacto) para los
  --    runs activos. Re-apuntar solo los NO activos; el run activo del
  --    perdedor queda NULL por su FK (ON DELETE SET NULL) al borrarlo.
  UPDATE flow_runs
    SET contact_id = p_survivor
    WHERE contact_id = p_loser AND status <> 'active';

  -- 5) Leads: "un lead por (cuenta, contacto)". ---------------------
  SELECT id INTO v_surv_lead
    FROM leads WHERE account_id = v_account AND contact_id = p_survivor LIMIT 1;
  SELECT id INTO v_loser_lead
    FROM leads WHERE account_id = v_account AND contact_id = p_loser LIMIT 1;

  IF v_loser_lead IS NOT NULL THEN
    IF v_surv_lead IS NULL THEN
      -- El superviviente no tenía lead: adoptar el del perdedor.
      UPDATE leads
        SET contact_id = p_survivor, updated_at = now()
        WHERE id = v_loser_lead;
    ELSE
      -- Ya hay lead: re-apuntar sus hijos y borrar el duplicado.
      UPDATE activities     SET lead_id = v_surv_lead WHERE lead_id = v_loser_lead;
      UPDATE notes          SET lead_id = v_surv_lead WHERE lead_id = v_loser_lead;
      UPDATE attachments    SET lead_id = v_surv_lead WHERE lead_id = v_loser_lead;
      UPDATE space_records
        SET entity_id = v_surv_lead
        WHERE entity_type = 'lead' AND entity_id = v_loser_lead;
      DELETE FROM leads WHERE id = v_loser_lead;
    END IF;
  END IF;

  -- 6) Guardar los datos del perdedor y borrarlo. -------------------
  SELECT name, email, document, company, phone
    INTO v_loser_name, v_loser_email, v_loser_document, v_loser_company, v_loser_phone
    FROM contacts WHERE id = p_loser;

  DELETE FROM contacts WHERE id = p_loser;

  -- 7) Rellenar huecos del superviviente (después del delete, para no
  --    chocar con el índice único de teléfono). Solo se copia lo que al
  --    superviviente le falte.
  UPDATE contacts
    SET name       = COALESCE(NULLIF(name, ''),      NULLIF(v_loser_name, '')),
        email      = COALESCE(NULLIF(email, ''),     NULLIF(v_loser_email, '')),
        document   = COALESCE(NULLIF(document, ''),  NULLIF(v_loser_document, '')),
        company    = COALESCE(NULLIF(company, ''),   NULLIF(v_loser_company, '')),
        phone      = CASE
                       WHEN COALESCE(phone, '') = '' THEN COALESCE(v_loser_phone, '')
                       ELSE phone
                     END,
        updated_at = now()
    WHERE id = p_survivor;
END;
$$;

ALTER FUNCTION public.merge_contacts(uuid, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.merge_contacts(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.merge_contacts(uuid, uuid) TO authenticated, service_role;
