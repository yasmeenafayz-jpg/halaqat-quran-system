PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS session_materials (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL,

  title TEXT NOT NULL,

  material_type TEXT NOT NULL DEFAULT 'lesson'
    CHECK (
      material_type IN (
        'lesson',
        'tafsir',
        'fiqh',
        'hadith',
        'sirah',
        'noorani',
        'quran',
        'document',
        'link',
        'note',
        'other'
      )
    ),

  content TEXT,
  external_url TEXT,
  document_id INTEGER,
  quran_ayah_id INTEGER,

  sort_order INTEGER NOT NULL DEFAULT 0,

  status TEXT NOT NULL DEFAULT 'active'
    CHECK (
      status IN ('active', 'archived')
    ),

  created_by INTEGER,
  updated_by INTEGER,

  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (session_id)
    REFERENCES sessions(id)
    ON DELETE CASCADE,

  FOREIGN KEY (document_id)
    REFERENCES documents(id)
    ON DELETE SET NULL,

  FOREIGN KEY (created_by)
    REFERENCES users(id)
    ON DELETE SET NULL,

  FOREIGN KEY (updated_by)
    REFERENCES users(id)
    ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_session_materials_session
ON session_materials(session_id);

CREATE INDEX IF NOT EXISTS idx_session_materials_status
ON session_materials(session_id, status);

CREATE INDEX IF NOT EXISTS idx_session_materials_document
ON session_materials(document_id);

CREATE INDEX IF NOT EXISTS idx_session_materials_ayah
ON session_materials(quran_ayah_id);

CREATE INDEX IF NOT EXISTS idx_session_materials_sort
ON session_materials(session_id, sort_order, id);
