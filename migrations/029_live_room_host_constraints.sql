-- الأوَّابين
-- 029_live_room_host_constraints
-- Enforce one active Host per live room.
-- Co-hosts remain session-scoped.

PRAGMA foreign_keys = ON;

CREATE UNIQUE INDEX IF NOT EXISTS idx_live_room_hosts_active_host
ON live_room_hosts(room_id)
WHERE host_role = 'host'
  AND status = 'active';
