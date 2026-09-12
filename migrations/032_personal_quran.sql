PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS quran_student_annotations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL,
  ayah_id INTEGER NOT NULL,
  annotation_type TEXT NOT NULL
    CHECK (
      annotation_type IN (
        'note',
        'highlight',
        'stop',
        'start',
        'memorization',
        'review',
        'tamkeen',
        'error',
        'review_word',
        'favorite',
        'teacher_note'
      )
    ),
  annotation_data TEXT NOT NULL DEFAULT '{}',
  created_by INTEGER,
  updated_by INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_quran_student_annotations_student
ON quran_student_annotations(student_id);

CREATE INDEX IF NOT EXISTS idx_quran_student_annotations_ayah
ON quran_student_annotations(ayah_id);

CREATE INDEX IF NOT EXISTS idx_quran_student_annotations_student_ayah
ON quran_student_annotations(student_id, ayah_id);

CREATE TABLE IF NOT EXISTS quran_teacher_resources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ayah_id INTEGER,
  resource_type TEXT NOT NULL
    CHECK (
      resource_type IN (
        'tafsir',
        'hadith',
        'mutashabihat',
        'asbab_al_nuzul',
        'tajweed',
        'tahajji',
        'noor_al_bayan',
        'gharib',
        'teacher_note'
      )
    ),
  title TEXT,
  content TEXT NOT NULL DEFAULT '',
  resource_data TEXT NOT NULL DEFAULT '{}',
  created_by INTEGER,
  updated_by INTEGER,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','archived')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_quran_teacher_resources_ayah
ON quran_teacher_resources(ayah_id);

CREATE INDEX IF NOT EXISTS idx_quran_teacher_resources_type
ON quran_teacher_resources(resource_type);

CREATE INDEX IF NOT EXISTS idx_quran_teacher_resources_ayah_type
ON quran_teacher_resources(ayah_id, resource_type);
