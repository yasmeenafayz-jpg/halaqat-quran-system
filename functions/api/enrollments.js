/**
 * الأوَّابين — Enrollment API
 *
 * POST  /api/enrollments
 * GET   /api/enrollments
 * PATCH /api/enrollments
 *
 * القواعد:
 * - التسجيل الفردي والجماعي.
 * - الفردية يمكن أن تضم 1 أو 2 أو أكثر حسب سعة الإدارة.
 * - الجماعية تمنع التسجيل عند اكتمال السعة.
 * - الإدارة تستطيع تعديل سعة الحلقة من circles API.
 * - عند كفاية قائمة الانتظار لإنشاء مجموعة جديدة:
 *   يتم إنشاء الحلقة الجديدة ثم نقل الطلاب إليها فعليًا.
 * - يتم الحفاظ على ترتيب قائمة الانتظار.
 * - عند وجود مكان شاغر يمكن ترقية أول طالب من قائمة الانتظار.
 * - عند امتلاء الحلقة تتحول حالتها إلى full.
 * - عند زيادة السعة يمكن فتح التسجيل وترقية المنتظرين.
 */

const HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
};

/* =========================================================
   Basic
========================================================= */

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: HEADERS,
  });
}

function now() {
  return new Date().toISOString();
}

function today() {
  return now().slice(0, 10);
}

async function body(request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

/* =========================================================
   Basic Queries
========================================================= */

async function getStudent(db, id) {
  return db.prepare(`
    SELECT *
    FROM students
    WHERE id = ?1
    LIMIT 1
  `).bind(id).first();
}

async function getPackage(db, id) {
  return db.prepare(`
    SELECT *
    FROM packages
    WHERE id = ?1
    LIMIT 1
  `).bind(id).first();
}

async function getCircle(db, id) {
  return db.prepare(`
    SELECT *
    FROM circles
    WHERE id = ?1
    LIMIT 1
  `).bind(id).first();
}

async function getEnrollment(db, studentId, circleId) {
  return db.prepare(`
    SELECT *
    FROM circle_enrollments
    WHERE student_id = ?1
      AND circle_id = ?2
    LIMIT 1
  `).bind(studentId, circleId).first();
}

async function enrollmentCount(db, circleId) {
  const row = await db.prepare(`
    SELECT COUNT(*) AS count
    FROM circle_enrollments
    WHERE circle_id = ?1
      AND status IN (
        'pending',
        'active',
        'paused'
      )
  `).bind(circleId).first();

  return Number(row?.count || 0);
}

async function waitlistCount(db, circleId) {
  const row = await db.prepare(`
    SELECT COUNT(*) AS count
    FROM circle_waitlist
    WHERE circle_id = ?1
      AND status = 'waiting'
  `).bind(circleId).first();

  return Number(row?.count || 0);
}

/* =================================================
