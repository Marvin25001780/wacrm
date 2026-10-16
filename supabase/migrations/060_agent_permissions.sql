-- ============================================================
-- Migration 060: restrict structural record edits to admin/owner
--
-- Agents can create operational records (contacts, leads, deals,
-- notes, activities) but should not edit or delete existing ones.
-- Admins and owners retain full CRUD.
--
-- Operational tables that agents still need to mutate
-- (conversations, messages, deal stage moves) are left at agent
-- level for UPDATE; only their DELETE is tightened here where
-- applicable.
-- ============================================================

-- ---- contacts ------------------------------------------------
DROP POLICY IF EXISTS contacts_update ON contacts;
DROP POLICY IF EXISTS contacts_delete ON contacts;
CREATE POLICY contacts_update ON contacts FOR UPDATE USING (is_account_member(account_id, 'admin'));
CREATE POLICY contacts_delete ON contacts FOR DELETE USING (is_account_member(account_id, 'admin'));

-- ---- contact_notes -------------------------------------------
DROP POLICY IF EXISTS contact_notes_update ON contact_notes;
DROP POLICY IF EXISTS contact_notes_delete ON contact_notes;
CREATE POLICY contact_notes_update ON contact_notes FOR UPDATE USING (is_account_member(account_id, 'admin'));
CREATE POLICY contact_notes_delete ON contact_notes FOR DELETE USING (is_account_member(account_id, 'admin'));

-- ---- contact_tags --------------------------------------------
-- The old FOR ALL policy allowed agent update/delete. Split into
-- granular policies so INSERT stays agent while UPDATE/DELETE
-- require admin.
DROP POLICY IF EXISTS contact_tags_modify ON contact_tags;
DROP POLICY IF EXISTS contact_tags_select ON contact_tags;
DROP POLICY IF EXISTS contact_tags_insert ON contact_tags;
DROP POLICY IF EXISTS contact_tags_update ON contact_tags;
DROP POLICY IF EXISTS contact_tags_delete ON contact_tags;
CREATE POLICY contact_tags_select ON contact_tags FOR SELECT USING (
  EXISTS (SELECT 1 FROM contacts c WHERE c.id = contact_tags.contact_id AND is_account_member(c.account_id))
);
CREATE POLICY contact_tags_insert ON contact_tags FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM contacts c WHERE c.id = contact_tags.contact_id AND is_account_member(c.account_id, 'agent'))
);
CREATE POLICY contact_tags_update ON contact_tags FOR UPDATE USING (
  EXISTS (SELECT 1 FROM contacts c WHERE c.id = contact_tags.contact_id AND is_account_member(c.account_id, 'admin'))
);
CREATE POLICY contact_tags_delete ON contact_tags FOR DELETE USING (
  EXISTS (SELECT 1 FROM contacts c WHERE c.id = contact_tags.contact_id AND is_account_member(c.account_id, 'admin'))
);

-- ---- contact_custom_values -----------------------------------
DROP POLICY IF EXISTS contact_custom_values_modify ON contact_custom_values;
DROP POLICY IF EXISTS contact_custom_values_select ON contact_custom_values;
DROP POLICY IF EXISTS contact_custom_values_insert ON contact_custom_values;
DROP POLICY IF EXISTS contact_custom_values_update ON contact_custom_values;
DROP POLICY IF EXISTS contact_custom_values_delete ON contact_custom_values;
CREATE POLICY contact_custom_values_select ON contact_custom_values FOR SELECT USING (
  EXISTS (SELECT 1 FROM contacts c WHERE c.id = contact_custom_values.contact_id AND is_account_member(c.account_id))
);
CREATE POLICY contact_custom_values_insert ON contact_custom_values FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM contacts c WHERE c.id = contact_custom_values.contact_id AND is_account_member(c.account_id, 'agent'))
);
CREATE POLICY contact_custom_values_update ON contact_custom_values FOR UPDATE USING (
  EXISTS (SELECT 1 FROM contacts c WHERE c.id = contact_custom_values.contact_id AND is_account_member(c.account_id, 'admin'))
);
CREATE POLICY contact_custom_values_delete ON contact_custom_values FOR DELETE USING (
  EXISTS (SELECT 1 FROM contacts c WHERE c.id = contact_custom_values.contact_id AND is_account_member(c.account_id, 'admin'))
);

-- ---- leads ---------------------------------------------------
-- UPDATE stays at agent so agents can convert leads (operational
-- state change). DELETE is structural and admin-only.
DROP POLICY IF EXISTS leads_delete ON leads;
CREATE POLICY leads_delete ON leads FOR DELETE USING (is_account_member(account_id, 'admin'));

-- ---- notes ---------------------------------------------------
DROP POLICY IF EXISTS notes_update ON notes;
DROP POLICY IF EXISTS notes_delete ON notes;
CREATE POLICY notes_update ON notes FOR UPDATE USING (is_account_member(account_id, 'admin'));
CREATE POLICY notes_delete ON notes FOR DELETE USING (is_account_member(account_id, 'admin'));

-- ---- activities ----------------------------------------------
DROP POLICY IF EXISTS activities_update ON activities;
DROP POLICY IF EXISTS activities_delete ON activities;
CREATE POLICY activities_update ON activities FOR UPDATE USING (is_account_member(account_id, 'admin'));
CREATE POLICY activities_delete ON activities FOR DELETE USING (is_account_member(account_id, 'admin'));

-- ---- attachments ---------------------------------------------
DROP POLICY IF EXISTS attachments_update ON attachments;
DROP POLICY IF EXISTS attachments_delete ON attachments;
CREATE POLICY attachments_update ON attachments FOR UPDATE USING (is_account_member(account_id, 'admin'));
CREATE POLICY attachments_delete ON attachments FOR DELETE USING (is_account_member(account_id, 'admin'));

-- ---- deals ---------------------------------------------------
-- Agents need UPDATE to move deals between stages (operational),
-- but DELETE is structural and should be admin-only.
DROP POLICY IF EXISTS deals_delete ON deals;
CREATE POLICY deals_delete ON deals FOR DELETE USING (is_account_member(account_id, 'admin'));
