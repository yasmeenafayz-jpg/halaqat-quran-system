const HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: HEADERS,
  });
}

async function getCount(db, sql) {
  const row = await db.prepare(sql).first();
  return Number(row?.count || 0);
}

async function getSum(db, sql) {
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
    const students = await getCount(
      db,
      `SELECT COUNT(*) AS count
       FROM students
       WHERE status = 'active'`
    );

    const teachers = await getCount(
      db,
      `SELECT COUNT(*) AS count
       FROM teachers
       WHERE status = 'active'`
    );

    const circles = await getCount(
      db,
      `SELECT COUNT(*) AS count
       FROM circles
       WHERE status = 'active'`
    );

    const today = await getCount(
      db,
      `SELECT COUNT(*) AS count
       FROM sessions
       WHERE session_date = date('now')
       AND status != 'cancelled'`
    );

    const pendingEnrollments = await getCount(
      db,
      `SELECT COUNT(*) AS count
       FROM enrollment_requests
       WHERE status IN ('pending','introductory')`
    );

    const waitlisted = await getCount(
      db,
      `SELECT COUNT(*) AS count
       FROM circle_waitlist
       WHERE status = 'waiting'`
    );

    const activeSubscriptions = await getCount(
      db,
      `SELECT COUNT(*) AS count
       FROM subscriptions
       WHERE status = 'active'`
    );

    const trialSubscriptions = await getCount(
      db,
      `SELECT COUNT(*) AS count
       FROM subscriptions
       WHERE status = 'trial'`
    );

    const absentToday = await getCount(
      db,
      `SELECT COUNT(*) AS count
       FROM attendance a
       INNER JOIN sessions s
       ON s.id = a.session_id
       WHERE s.session_date = date('now')
       AND a.status = 'absent'`
    );

    const pendingFines = await getCount(
      db,
      `SELECT COUNT(*) AS count
       FROM fines
       WHERE status = 'pending'`
    );

    const fullCircles = await getCount(
      db,
      `SELECT COUNT(*) AS count
       FROM circles
       WHERE status = 'full'`
    );

    const expiredSubscriptions = await getCount(
      db,
      `SELECT COUNT(*) AS count
       FROM subscriptions
       WHERE status = 'expired'`
    );

    const excusedToday = await getCount(
      db,
      `SELECT COUNT(*) AS count
       FROM attendance a
       INNER JOIN sessions s
       ON s.id = a.session_id
       WHERE s.session_date = date('now')
       AND a.status = 'excused'`
    );

    const lateToday = await getCount(
      db,
      `SELECT COUNT(*) AS count
       FROM attendance a
       INNER JOIN sessions s
       ON s.id = a.session_id
       WHERE s.session_date = date('now')
       AND a.status = 'late'`
    );

    const paymentsToday = await getSum(
      db,
      `SELECT COALESCE(SUM(amount),0) AS total
       FROM payments
       WHERE paid_at >= date('now')
       AND paid_at < date('now','+1 day')
       AND status = 'completed'`
    );

    const paymentsThisMonth = await getSum(
      db,
      `SELECT COALESCE(SUM(amount),0) AS total
       FROM payments
       WHERE paid_at >= date('now','start of month')
       AND paid_at < date('now','+1 day')
       AND status = 'completed'`
    );

    const pendingFinesAmount = await getSum(
      db,
      `SELECT COALESCE(SUM(amount),0) AS total
       FROM fines
       WHERE status = 'pending'`
    );

    return json({
      ok: true,
      database: true,

      counts: {
        students,
        teachers,
        circles,
        today,
        pending_enrollments: pendingEnrollments,
        waitlisted,
        active_subscriptions: activeSubscriptions,
        trial_subscriptions: trialSubscriptions,
        absent_today: absentToday,
        pending_fines: pendingFines,
        full_circles: fullCircles,
        expired_subscriptions: expiredSubscriptions,
        excused_today: excusedToday,
        late_today: lateToday,
      },

      financial: {
        payments_today: paymentsToday,
        payments_this_month: paymentsThisMonth,
        pending_fines_amount: pendingFinesAmount,
      },

      today: new Date()
        .toISOString()
        .slice(0, 10),
    });
  } catch (error) {
    console.error(
      "Dashboard query error:",
      error
    );

    return json(
      {
        ok: false,
        database: true,
        error: "DASHBOARD_QUERY_FAILED",
        message:
          error instanceof Error
            ? error.message
            : String(error),
      },
      500
    );
  }
}
