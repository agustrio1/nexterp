-- Custom SQL migration file, put your code below! ---- Penjaga permintaan persetujuan: identitas imutabel, status terminal tak bisa dibuka lagi.
CREATE OR REPLACE FUNCTION erp_approval_requests_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'pending' THEN
      RAISE EXCEPTION 'Permintaan persetujuan baru harus berstatus pending';
    END IF;
    IF NEW.completed_at IS NOT NULL THEN
      RAISE EXCEPTION 'Permintaan pending tidak boleh memiliki completed_at';
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE
  IF OLD.status <> 'pending' THEN
    RAISE EXCEPTION 'Permintaan persetujuan berstatus % sudah final dan tidak dapat diubah', OLD.status;
  END IF;

  -- Kolom identitas tidak pernah berubah setelah pengajuan dibuat.
  IF NEW.doc_type <> OLD.doc_type
     OR NEW.doc_id <> OLD.doc_id
     OR NEW.workflow_id <> OLD.workflow_id
     OR NEW.requested_by <> OLD.requested_by
     OR NEW.requested_at <> OLD.requested_at
     OR NEW.amount IS DISTINCT FROM OLD.amount THEN
    RAISE EXCEPTION 'Identitas permintaan persetujuan (docType/docId/workflow/pengaju/nominal) tidak dapat diubah';
  END IF;

  IF NEW.current_step < 1 THEN
    RAISE EXCEPTION 'current_step permintaan persetujuan tidak boleh kurang dari 1';
  END IF;

  -- Invarian status vs completed_at.
  IF NEW.status = 'pending' THEN
    IF NEW.completed_at IS NOT NULL THEN
      RAISE EXCEPTION 'Permintaan berstatus pending tidak boleh memiliki completed_at';
    END IF;
  ELSE
    IF NEW.completed_at IS NULL THEN
      RAISE EXCEPTION 'Permintaan berstatus % wajib memiliki completed_at', NEW.status;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER "approval_requests_guard"
  BEFORE INSERT OR UPDATE ON "approval_requests"
  FOR EACH ROW EXECUTE FUNCTION erp_approval_requests_guard();
--> statement-breakpoint
-- Penjaga aksi persetujuan: append-only (hanya boleh INSERT).
CREATE OR REPLACE FUNCTION erp_approval_actions_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'Catatan aksi persetujuan tidak dapat diubah (append-only)';
  END IF;
  RAISE EXCEPTION 'Catatan aksi persetujuan tidak dapat dihapus (append-only)';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER "approval_actions_guard"
  BEFORE UPDATE OR DELETE ON "approval_actions"
  FOR EACH ROW EXECUTE FUNCTION erp_approval_actions_guard();
--> statement-breakpoint
CREATE TRIGGER "approval_requests_truncate_guard"
  BEFORE TRUNCATE ON "approval_requests"
  FOR EACH STATEMENT EXECUTE FUNCTION erp_forbid_truncate();
--> statement-breakpoint
CREATE TRIGGER "approval_actions_truncate_guard"
  BEFORE TRUNCATE ON "approval_actions"
  FOR EACH STATEMENT EXECUTE FUNCTION erp_forbid_truncate();
