-- =========================================================
-- الأوَّابين — Academic Materials Library
-- 036_academic_materials.sql
-- =========================================================

CREATE TABLE IF NOT EXISTS academic_materials (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  subject_type TEXT NOT NULL
    CHECK (
      subject_type IN (
        'tajweed',
        'tafsir',
        'fiqh',
        'hadith',
        'sirah',
        'noorani_qaida',
        'other'
      )
    ),
  description TEXT,
  content TEXT,
  document_id INTEGER,
  external_url TEXT,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','approved','archived')),
  test_eligible INTEGER NOT NULL DEFAULT 0
    CHECK (test_eligible IN (0,1)),
  term_id INTEGER,
  created_by INTEGER,
  approved_by INTEGER,
  approved_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE SET NULL,
  FOREIGN KEY (term_id) REFERENCES academic_terms(id) ON DELETE SET NULL,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (approved_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS academic_material_units (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  material_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','archived')),
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (material_id) REFERENCES academic_materials(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS academic_material_lessons (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  unit_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  content TEXT,
  document_id INTEGER,
  external_url TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','archived')),
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (unit_id) REFERENCES academic_material_units(id) ON DELETE CASCADE,
  FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE SET NULL,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_academic_materials_subject
ON academic_materials(subject_type, status);

CREATE INDEX IF NOT EXISTS idx_academic_materials_test
ON academic_materials(status, test_eligible);

CREATE INDEX IF NOT EXISTS idx_academic_material_units_material
ON academic_material_units(material_id, sort_order, id);

CREATE INDEX IF NOT EXISTS idx_academic_material_lessons_unit
ON academic_material_lessons(unit_id, sort_order, id);

ALTER TABLE question_bank
ADD COLUMN academic_material_lesson_id INTEGER
REFERENCES academic_material_lessons(id)
ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_question_bank_academic_lesson
ON question_bank(academic_material_lesson_id);
