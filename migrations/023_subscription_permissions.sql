-- الأوَّابين — Subscription permissions
-- Supervisor needs read/write access to subscription management.
-- Admin is already granted full access by hasPermission().

INSERT OR IGNORE INTO role_permissions
  (role, permission, enabled)
VALUES
  ('supervisor', 'subscriptions.read', 1),
  ('supervisor', 'subscriptions.write', 1);
