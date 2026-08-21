PRAGMA foreign_keys = ON;

-- =========================================================
-- 010_professional_foundation_constraints.sql
-- مشروع الأوَّابين
-- قيود وتحقق إضافي للخصائص الاحترافية
-- =========================================================

-- =========================================================
-- 1) حماية question_bank.level_id
--
-- SQLite لا يسمح بإضافة FOREIGN KEY إلى جدول موجود
-- باستخدام ALTER TABLE بالطريقة المباشرة.
-- لذلك نستخدم Trigger للتحقق من أن المستوى موجود.
-- =========================================================

CREATE TRIGGER IF NOT EXISTS trg_question_bank_level_insert
BEFORE INSERT ON question_bank
WHEN NEW.level_id IS NOT NULL
 AND NOT EXISTS (
   SELECT 1
   FROM quran_levels
   WHERE id = NEW.level_id
 )
BEGIN
  SELECT RAISE(
    ABORT,
    'Invalid quran level: level_id does not exist'
  );
END;


CREATE TRIGGER IF NOT EXISTS trg_question_bank_level_update
BEFORE UPDATE OF level_id ON question_bank
WHEN NEW.level_id IS NOT NULL
 AND NOT EXISTS (
   SELECT 1
   FROM quran_levels
   WHERE id = NEW.level_id
 )
BEGIN
  SELECT RAISE(
    ABORT,
    'Invalid quran level: level_id does not exist'
  );
END;


-- =========================================================
-- 2) حماية نطاق الآيات في بنك الأسئلة
-- =========================================================

CREATE TRIGGER IF NOT EXISTS trg_question_bank_ayah_range_insert
BEFORE INSERT ON question_bank
WHEN (
  NEW.ayah_start IS NOT NULL
  AND NEW.ayah_end IS NOT NULL
  AND NEW.ayah_start > NEW.ayah_end
)
BEGIN
  SELECT RAISE(
    ABORT,
    'Invalid ayah range: ayah_start cannot exceed ayah_end'
  );
END;


CREATE TRIGGER IF NOT EXISTS trg_question_bank_ayah_range_update
BEFORE UPDATE OF ayah_start, ayah_end ON question_bank
WHEN (
  NEW.ayah_start IS NOT NULL
  AND NEW.ayah_end IS NOT NULL
  AND NEW.ayah_start > NEW.ayah_end
)
BEGIN
  SELECT RAISE(
    ABORT,
    'Invalid ayah range: ayah_start cannot exceed ayah_end'
  );
END;


-- =========================================================
-- 3) حماية بيانات الفترات الدراسية
-- =========================================================

CREATE TRIGGER IF NOT EXISTS trg_academic_terms_dates_insert
BEFORE INSERT ON academic_terms
WHEN NEW.end_date < NEW.start_date
BEGIN
  SELECT RAISE(
    ABORT,
    'Invalid academic term dates'
  );
END;


CREATE TRIGGER IF NOT EXISTS trg_academic_terms_dates_update
BEFORE UPDATE OF start_date, end_date ON academic_terms
WHEN NEW.end_date < NEW.start_date
BEGIN
  SELECT RAISE(
    ABORT,
    'Invalid academic term dates'
  );
END;


-- =========================================================
-- 4) حماية طلبات إجازات المعلمات
-- =========================================================

CREATE TRIGGER IF NOT EXISTS trg_teacher_leave_dates_insert
BEFORE INSERT ON teacher_leave_requests
WHEN NEW.end_date < NEW.start_date
BEGIN
  SELECT RAISE(
    ABORT,
    'Invalid teacher leave dates'
  );
END;


CREATE TRIGGER IF NOT EXISTS trg_teacher_leave_dates_update
BEFORE UPDATE OF start_date, end_date ON teacher_leave_requests
WHEN NEW.end_date < NEW.start_date
BEGIN
  SELECT RAISE(
    ABORT,
    'Invalid teacher leave dates'
  );
END;


-- =========================================================
-- 5) فهارس إضافية لمركز الإجراءات
-- =========================================================

CREATE INDEX IF NOT EXISTS idx_action_items_due
ON action_items(due_at, status);

CREATE INDEX IF NOT EXISTS idx_action_items_priority
ON action_items(priority, status);


-- =========================================================
-- 6) فهارس إضافية للواجبات
-- =========================================================

CREATE INDEX IF NOT EXISTS idx_assignments_session
ON assignments(session_id);

CREATE INDEX IF NOT EXISTS idx_assignments_circle
ON assignments(circle_id);


-- =========================================================
-- 7) فهارس إضافية للموافقات
-- =========================================================

CREATE INDEX IF NOT EXISTS idx_approval_requested_by
ON approval_requests(requested_by, status);

CREATE INDEX IF NOT EXISTS idx_approval_reviewed_by
ON approval_requests(reviewed_by, status);


-- =========================================================
-- 8) فهارس إضافية لسجل تغييرات الكيانات
-- =========================================================

CREATE INDEX IF NOT EXISTS idx_entity_change_action
ON entity_change_log(action, created_at);

-- =========================================================
-- نهاية Migration 010
-- =========================================================
