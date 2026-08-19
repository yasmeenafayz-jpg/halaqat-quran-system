/**
 * الأوَّابين — Dashboard API
 *
 * GET /api/dashboard
 */

const HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: HEADERS,
  });
}

async function count(db, sql) {
  const row = await db.prepare(sql).first();
  return Number(row?.count || 0);
}

async function sum(db, sql) {
  const row = await db.prepare(sql).first();
  return Number(row?.total || 0);
}

export async function onRequestGet(context) {
  const db = context.env?.DB;

  if (!db) {
    return json({
      ok: true,
      database: false,

      counts: {
        students: 0,
        teachers: 0,
        circles: 0,
        today: 0,
        pending_enrollments: 0,
        waitlisted: 0,
        active_subscriptions: 0,
        trial_subscriptions: 0,
        absent_today: 0,
        pending_fines: 0,
        full_circles: 0,
        expired_subscriptions: 0,
        excused_today: 0,
        late_today: 0,
      },

      financial: {
        payments_today: 0,
        payments_this_month: 0,
        pending_fines_amount: 0,
      },
    });
  }

  try {
    const results = await Promise.all([

      /* الطلاب النشطون */
      count(
        db,
        `
          SELECT COUNT(*) AS count
          FROM students
          WHERE status = 'active'
        `
      ),

      /* المعلمون النشطون */
      count(
        db,
        `
          SELECT COUNT(*) AS count
          FROM teachers
          WHERE status = 'active'
        `
      ),

      /* الحلقات النشطة */
      count(
        db,
        `
          SELECT COUNT(*) AS count
          FROM circles
          WHERE status = 'active'
        `
      ),

      /* جلسات اليوم */
      count(
        db,
        `
          SELECT COUNT(*) AS count
          FROM sessions
          WHERE session_date = date('now')
            AND status != 'cancelled'
        `
      ),

      /* طلبات التسجيل المعلقة */
      count(
        db,
        `
          SELECT COUNT(*) AS count
          FROM enrollment_requests
          WHERE status IN (
            'pending',
            'introductory'
          )
        `
      ),

      /* قائمة الانتظار */
      count(
        db,
        `
          SELECT COUNT(*) AS count
          FROM circle_waitlist
          WHERE status = 'waiting'
        `
      ),

      /* الاشتراكات النشطة */
      count(
        db,
        `
          SELECT COUNT(*) AS count
          FROM subscriptions
          WHERE status = 'active'
        `
      ),

      /* التجارب */
      count(
        db,
        `
          SELECT COUNT(*) AS count
          FROM subscriptions
          WHERE status = 'trial'
        `
      ),

      /* الغياب اليوم */
      count(
        db,
        `
          SELECT COUNT(*) AS count
          FROM attendance a
          INNER JOIN sessions s
            ON s.id = a.session_id
          WHERE s.session_date = date('now')
            AND a.status = 'absent'
        `
      ),

      /* الغرامات المعلقة */
      count(
        db,
        `
          SELECT COUNT(*) AS count
          FROM fines
          WHERE status = 'pending'
        `
      ),

      /* مدفوعات اليوم */
      sum(
        db,
        `
          SELECT COALESCE(
            SUM(amount),
            0
          ) AS total
          FROM payments
          WHERE paid_at >= date('now')
            AND paid_at < date(
              'now',
              '+1 day'
            )
            AND status = 'completed'
        `
      ),

      /* مدفوعات الشهر */
      sum(
        db,
        `
          SELECT COALESCE(
            SUM(amount),
           
