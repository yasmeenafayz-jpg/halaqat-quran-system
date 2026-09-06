PRAGMA foreign_keys = ON;

-- ==================================================
-- 1. CENTRAL SETTINGS
-- ==================================================

CREATE TABLE IF NOT EXISTS system_settings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  setting_key TEXT NOT NULL,
  setting_value TEXT,
  value_type TEXT NOT NULL DEFAULT 'text'
    CHECK (value_type IN ('text','number','boolean','json')),
  scope_type TEXT NOT NULL DEFAULT 'global'
    CHECK (scope_type IN (
      'global','academy','branch','circle',
      'session','role','user'
    )),
  scope_id INTEGER,
  description TEXT,
  is_sensitive INTEGER NOT NULL DEFAULT 0
    CHECK (is_sensitive IN (0,1)),
  is_editable INTEGER NOT NULL DEFAULT 1
    CHECK (is_editable IN (0,1)),
  created_by INTEGER,
  updated_by INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE (setting_key, scope_type, scope_id)
);

CREATE INDEX IF NOT EXISTS idx_system_settings_scope
ON system_settings(scope_type, scope_id);

CREATE INDEX IF NOT EXISTS idx_system_settings_key
ON system_settings(setting_key);


-- ==================================================
-- 2. EXTEND EXISTING DOCUMENTS TABLE
-- ==================================================

ALTER TABLE documents ADD COLUMN title TEXT;

ALTER TABLE documents ADD COLUMN description TEXT;

ALTER TABLE documents ADD COLUMN storage_type TEXT
  NOT NULL DEFAULT 'file';

ALTER TABLE documents ADD COLUMN external_url TEXT;

ALTER TABLE documents ADD COLUMN checksum TEXT;

ALTER TABLE documents ADD COLUMN status TEXT
  NOT NULL DEFAULT 'active';

ALTER TABLE documents ADD COLUMN updated_at TEXT
  ;


-- ==================================================
-- 3. BACKFILL EXISTING DOCUMENT TITLES
-- ==================================================

UPDATE documents
SET title = file_name
WHERE title IS NULL OR trim(title) = '';


-- ==================================================
-- 4. DOCUMENT INDEXES
-- ==================================================

CREATE INDEX IF NOT EXISTS idx_documents_status
ON documents(status);

CREATE INDEX IF NOT EXISTS idx_documents_type
ON documents(document_type);

CREATE INDEX IF NOT EXISTS idx_documents_uploaded_by
ON documents(uploaded_by);

CREATE INDEX IF NOT EXISTS idx_documents_student
ON documents(student_id);

CREATE INDEX IF NOT EXISTS idx_documents_teacher
ON documents(teacher_id);

CREATE INDEX IF NOT EXISTS idx_documents_owner
ON documents(owner_user_id);


-- ==================================================
-- 5. CENTRAL DOCUMENT LINKS
-- ==================================================

CREATE TABLE IF NOT EXISTS document_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  document_id INTEGER NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id INTEGER,
  relation_type TEXT NOT NULL DEFAULT 'attachment',
  notes TEXT,
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (document_id)
    REFERENCES documents(id)
    ON DELETE CASCADE,

  FOREIGN KEY (created_by)
    REFERENCES users(id)
    ON DELETE SET NULL,

  UNIQUE (
    document_id,
    entity_type,
    entity_id,
    relation_type
  )
);

CREATE INDEX IF NOT EXISTS idx_document_links_entity
ON document_links(entity_type, entity_id);

CREATE INDEX IF NOT EXISTS idx_document_links_document
ON document_links(document_id);


-- ==================================================
-- 6. DOCUMENT PERMISSIONS
-- ==================================================

CREATE TABLE IF NOT EXISTS document_permissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  document_id INTEGER NOT NULL,
  role TEXT,
  user_id INTEGER,

  can_view INTEGER NOT NULL DEFAULT 1
    CHECK (can_view IN (0,1)),

  can_download INTEGER NOT NULL DEFAULT 1
    CHECK (can_download IN (0,1)),

  can_edit INTEGER NOT NULL DEFAULT 0
    CHECK (can_edit IN (0,1)),

  can_delete INTEGER NOT NULL DEFAULT 0
    CHECK (can_delete IN (0,1)),

  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (document_id)
    REFERENCES documents(id)
    ON DELETE CASCADE,

  FOREIGN KEY (user_id)
    REFERENCES users(id)
    ON DELETE CASCADE,

  FOREIGN KEY (created_by)
    REFERENCES users(id)
    ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_document_permissions_document
ON document_permissions(document_id);

CREATE INDEX IF NOT EXISTS idx_document_permissions_role
ON document_permissions(role);

CREATE INDEX IF NOT EXISTS idx_document_permissions_user
ON document_permissions(user_id);


-- ==================================================
-- 7. DEFAULT SYSTEM SETTINGS
-- ==================================================

INSERT OR IGNORE INTO system_settings
(setting_key, setting_value, value_type, scope_type, description)
VALUES
(
  'academy.name',
  'الأوَّابين',
  'text',
  'global',
  'اسم الأكاديمية'
),
(
  'academy.timezone',
  'Africa/Cairo',
  'text',
  'global',
  'المنطقة الزمنية'
),
(
  'academy.currency',
  'EGP',
  'text',
  'global',
  'العملة الافتراضية'
),
(
  'academy.language',
  'ar',
  'text',
  'global',
  'لغة النظام'
),
(
  'attendance.excuse_deadline_hours',
  '4',
  'number',
  'global',
  'مهلة الاعتذار قبل الجلسة'
),
(
  'documents.default_visibility',
  'private',
  'text',
  'global',
  'الرؤية الافتراضية للمستندات'
),
(
  'documents.allow_external_links',
  '1',
  'boolean',
  'global',
  'السماح بالروابط الخارجية'
),
(
  'documents.max_file_size_mb',
  '20',
  'number',
  'global',
  'الحجم الأقصى للملف'
);
