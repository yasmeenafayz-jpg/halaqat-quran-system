INSERT OR IGNORE INTO role_permissions (role, permission) VALUES
('admin','session.lifecycle.write'),
('supervisor','session.lifecycle.write'),
('teacher','session.lifecycle.write'),
('admin','buddy.admin.write'),
('supervisor','buddy.admin.write'),
('teacher','buddy.admin.write'),
('student','buddy.followup.self.write'),
('student','wird.self.write');

CREATE INDEX IF NOT EXISTS idx_sessions_date_status
ON sessions(session_date,status);

CREATE INDEX IF NOT EXISTS idx_sessions_circle_date
ON sessions(circle_id,session_date,start_time);
