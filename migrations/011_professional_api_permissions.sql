-- =========================================================
-- الأوَّابين — Professional API Permissions
-- Migration 011
-- =========================================================

INSERT OR IGNORE INTO role_permissions
(role, permission)
VALUES

-- الإدارة
('admin', 'billing-cycles.read'),
('admin', 'billing-cycles.write'),
('admin', 'payments.read'),
('admin', 'payments.write'),
('admin', 'payment-exemptions.read'),
('admin', 'payment-exemptions.write'),
('admin', 'individual-scheduling.read'),
('admin', 'individual-scheduling.write'),

-- المشرفة
('supervisor', 'billing-cycles.read'),
('supervisor', 'billing-cycles.write'),
('supervisor', 'payments.read'),
('supervisor', 'payments.write'),
('supervisor', 'payment-exemptions.read'),
('supervisor', 'payment-exemptions.write'),
('supervisor', 'individual-scheduling.read'),
('supervisor', 'individual-scheduling.write'),

-- المعلمة
('teacher', 'individual-scheduling.read'),
('teacher', 'individual-scheduling.write'),
('teacher', 'payments.read'),

-- الطالب
('student', 'payments.read'),
('student', 'individual-scheduling.read');

