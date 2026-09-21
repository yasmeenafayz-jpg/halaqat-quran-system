import {
  requireAuth,
  requirePermission,
  json,
} from "./_auth.js";

function badRequest(message) {
  return json({ success: false, error: message }, 400);
}

function forbidden(message = "FORBIDDEN") {
  return json({ success: false, error: message }, 403);
}

function notFound(message = "NOT_FOUND") {
  return json({ success: false, error: message }, 404);
}

function serverError(message = "INTERNAL_ERROR") {
  return json({ success: false, error: message }, 500);
}

function clean(value) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text || null;
}

function positiveInteger(value) {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  const number = Number(value);

  return Number.isInteger(number) && number > 0
    ? number
    : null;
}

function integerOrNull(value) {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  const number = Number(value);

  return Number.isInteger(number) && number > 0
    ? number
    : null;
}

function positiveNumberOrNull(value) {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  const number = Number(value);

  return Number.isFinite(number) && number > 0
    ? number
    : null;
}

function nonNegativeNumber(value) {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  const number = Number(value);

  return Number.isFinite(number) && number >= 0
    ? number
    : null;
}

function normalizeDate(value) {
  const text = clean(value);

  if (!text || !/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    return null;
  }

  const date = new Date(`${text}T00:00:00Z`);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date.toISOString().slice(0, 10) === text
    ? text
    : null;
}

function getCairoDate() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Cairo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());

  const values = {};

  for (const part of parts) {
    if (part.type !== "literal") {
      values[part.type] = part.value;
    }
  }

  return `${values.year}-${values.month}-${values.day}`;
}

function normalizePlanStatus(value) {
  const allowed = [
    "draft",
    "active",
    "paused",
    "completed",
    "cancelled",
  ];

  const text = clean(value);

  return text && allowed.includes(text) ? text : null;
}

function normalizeGoalType(value) {
  const allowed = [
    "memorization",
    "review",
    "memorization_review",
    "tamkeen",
    "cumulative_recitation",
    "tajweed",
    "test",
    "attendance",
    "skill",
    "custom",
  ];

  const text = clean(value);

  return text && allowed.includes(text) ? text : null;
}

function normalizeGoalStatus(value) {
  const allowed = [
    "pending",
    "in_progress",
    "completed",
    "skipped",
    "cancelled",
  ];

  const text = clean(value);

  return text && allowed.includes(text) ? text : null;
}

async function getOwnStudentId(db, user) {
  if (positiveInteger(user?.student_id)) {
    return positiveInteger(user.student_id);
  }

  if (user?.role === "student" && user?.id) {
    const row = await db.prepare(`
      SELECT id
      FROM students
      WHERE user_id = ?
      LIMIT 1
    `).bind(Number(user.id)).first();

    return row?.id ? Number(row.id) : null;
  }

  return null;
}

async function teacherCanAccessStudent(db, user, studentId) {
  if (
    user?.role !== "teacher" ||
    !positiveInteger(user.teacher_id)
  ) {
    return false;
  }

  const row = await db.prepare(`
    SELECT 1
    FROM circle_enrollments ce
    INNER JOIN circles c
      ON c.id = ce.circle_id
    WHERE ce.student_id = ?
      AND ce.status = 'active'
      AND c.teacher_id = ?
      AND c.status = 'active'
    LIMIT 1
  `).bind(
    Number(studentId),
    Number(user.teacher_id)
  ).first();

  return Boolean(row);
}

async function guardianCanAccessStudent(db, user, studentId) {
  if (
    user?.role !== "guardian" ||
    !user?.id
  ) {
    return false;
  }

  const row = await db.prepare(`
    SELECT 1
    FROM student_guardians sg
    INNER JOIN guardians g
      ON g.id = sg.guardian_id
    WHERE g.user_id = ?
      AND sg.student_id = ?
    LIMIT 1
  `).bind(
    Number(user.id),
    Number(studentId)
  ).first();

  return Boolean(row);
}

async function canAccessStudent(db, user, studentId) {
  if (!user || !studentId) {
    return false;
  }

  if (
    user.role === "admin" ||
    user.role === "supervisor"
  ) {
    return true;
  }

  const ownStudentId = await getOwnStudentId(db, user);

  if (
    ownStudentId &&
    Number(ownStudentId) === Number(studentId)
  ) {
    return true;
  }

  if (
    await teacherCanAccessStudent(
      db,
      user,
      studentId
    )
  ) {
    return true;
  }

  if (
    await guardianCanAccessStudent(
      db,
      user,
      studentId
    )
  ) {
    return true;
  }

  return false;
}

async function canManagePlan(db, user, studentId) {
  if (
    user?.role === "admin" ||
    user?.role === "supervisor"
  ) {
    return true;
  }

  if (user?.role !== "teacher") {
    return false;
  }

  return teacherCanAccessStudent(
    db,
    user,
    studentId
  );
}

async function canUpdateGoalProgress(db, user, studentId) {
  if (!user || !studentId) {
    return false;
  }

  if (
    user.role === "admin" ||
    user.role === "supervisor"
  ) {
    return true;
  }

  if (user.role === "teacher") {
    return teacherCanAccessStudent(
      db,
      user,
      studentId
    );
  }

  if (user.role === "student") {
    const ownStudentId =
      await getOwnStudentId(db, user);

    return Boolean(
      ownStudentId &&
      Number(ownStudentId) === Number(studentId)
    );
  }

  return false;
}

async function validateStudent(db, studentId) {
  return db.prepare(`
    SELECT
      id,
      full_name,
      status
    FROM students
    WHERE id = ?
    LIMIT 1
  `).bind(Number(studentId)).first();
}

async function validatePath(db, pathId) {
  const row = await db.prepare(`
    SELECT id
    FROM quran_paths
    WHERE id = ?
      AND status = 'active'
    LIMIT 1
  `).bind(Number(pathId)).first();

  return Boolean(row);
}

async function validateLevel(db, levelId, pathId = null) {
  let sql = `
    SELECT id
    FROM quran_levels
    WHERE id = ?
      AND status = 'active'
  `;

  const params = [Number(levelId)];

  if (pathId !== null) {
    sql += ` AND path_id = ?`;
    params.push(Number(pathId));
  }

  sql += ` LIMIT 1`;

  const row = await db.prepare(sql)
    .bind(...params)
    .first();

  return Boolean(row);
}

async function getPlan(db, planId) {
  return db.prepare(`
    SELECT
      p.*,
      qp.name AS path_name,
      ql.name AS level_name
    FROM student_learning_plans p
    LEFT JOIN quran_paths qp
      ON qp.id = p.path_id
    LEFT JOIN quran_levels ql
      ON ql.id = p.level_id
    WHERE p.id = ?
    LIMIT 1
  `).bind(Number(planId)).first();
}

async function getGoals(db, planId) {
  const result = await db.prepare(`
    SELECT *
    FROM student_learning_plan_goals
    WHERE plan_id = ?
    ORDER BY
      CASE
        WHEN status = 'in_progress' THEN 1
        WHEN status = 'pending' THEN 2
        WHEN status = 'completed' THEN 3
        ELSE 4
      END,
      CASE
        WHEN due_date IS NULL THEN 1
        ELSE 0
      END,
      due_date ASC,
      id ASC
  `).bind(Number(planId)).all();

  return result.results || [];
}

async function getPlanStats(db, planId) {
  const row = await db.prepare(`
    SELECT
      COUNT(*) AS total_goals,
      SUM(
        CASE
          WHEN status = 'completed' THEN 1
          ELSE 0
        END
      ) AS completed_goals,
      SUM(
        CASE
          WHEN status = 'in_progress' THEN 1
          ELSE 0
        END
      ) AS in_progress_goals,
      SUM(
        CASE
          WHEN status = 'pending' THEN 1
          ELSE 0
        END
      ) AS pending_goals,
      ROUND(
        COALESCE(
          AVG(
            CASE
              WHEN target_value IS NOT NULL
                   AND target_value > 0
              THEN MIN(
                100,
                MAX(
                  0,
                  (progress_value / target_value) * 100
                )
              )
              WHEN status = 'completed' THEN 100
              ELSE 0
            END
          ),
          0
        ),
        1
      ) AS progress_percent
    FROM student_learning_plan_goals
    WHERE plan_id = ?
  `).bind(Number(planId)).first();

  return {
    total_goals: Number(row?.total_goals || 0),
    completed_goals: Number(row?.completed_goals || 0),
    in_progress_goals: Number(row?.in_progress_goals || 0),
    pending_goals: Number(row?.pending_goals || 0),
    progress_percent: Number(row?.progress_percent || 0),
  };
}

async function getTodayGoals(db, planId) {
  const today = getCairoDate();

  const result = await db.prepare(`
    SELECT *
    FROM student_learning_plan_goals
    WHERE plan_id = ?
      AND status IN ('pending', 'in_progress')
      AND (
        due_date = ?
        OR due_date IS NULL
        OR due_date < ?
      )
    ORDER BY
      CASE
        WHEN due_date = ? THEN 0
        WHEN due_date < ? THEN 1
        ELSE 2
      END,
      due_date ASC,
      id ASC
    LIMIT 50
  `).bind(
    Number(planId),
    today,
    today,
    today,
    today
  ).all();

  return result.results || [];
}

async function getLatestActivePlan(db, studentId) {
  return db.prepare(`
    SELECT id
    FROM student_learning_plans
    WHERE student_id = ?
      AND status IN ('active', 'draft', 'paused')
    ORDER BY
      CASE status
        WHEN 'active' THEN 1
        WHEN 'draft' THEN 2
        WHEN 'paused' THEN 3
        ELSE 4
      END,
      start_date DESC,
      id DESC
    LIMIT 1
  `).bind(Number(studentId)).first();
}

async function resolveStudentId(db, user, requested) {
  if (
    requested !== undefined &&
    requested !== null &&
    requested !== ""
  ) {
    return positiveInteger(requested);
  }

  return getOwnStudentId(db, user);
}

async function resolvePlanId(db, studentId, requested) {
  if (
    requested !== undefined &&
    requested !== null &&
    requested !== ""
  ) {
    return positiveInteger(requested);
  }

  const latest = await getLatestActivePlan(
    db,
    studentId
  );

  return latest?.id
    ? Number(latest.id)
    : null;
}

async function buildResponse(db, studentId, planId) {
  const student = await validateStudent(
    db,
    studentId
  );

  if (!student) {
    return null;
  }

  if (!planId) {
    return {
      student,
      plan: null,
      goals: [],
      today: [],
      stats: {
        total_goals: 0,
        completed_goals: 0,
        in_progress_goals: 0,
        pending_goals: 0,
        progress_percent: 0,
      },
    };
  }

  const plan = await getPlan(
    db,
    planId
  );

  if (
    !plan ||
    Number(plan.student_id) !== Number(studentId)
  ) {
    return null;
  }

  const goals = await getGoals(
    db,
    planId
  );

  const today = await getTodayGoals(
    db,
    planId
  );

  const stats = await getPlanStats(
    db,
    planId
  );

  return {
    student,
    plan,
    goals,
    today,
    stats,
  };
}

async function createPlan(db, user, body) {
  const studentId = positiveInteger(body.student_id);

  if (!studentId) {
    return badRequest("student_id غير صالح.");
  }

  if (
    !(await canManagePlan(
      db,
      user,
      studentId
    ))
  ) {
    return forbidden();
  }

  const student = await validateStudent(
    db,
    studentId
  );

  if (!student) {
    return notFound("الطالب غير موجود.");
  }

  const pathId =
    body.path_id === undefined ||
    body.path_id === null ||
    body.path_id === ""
      ? null
      : positiveInteger(body.path_id);

  if (
    body.path_id !== undefined &&
    body.path_id !== null &&
    body.path_id !== "" &&
    !pathId
  ) {
    return badRequest("path_id غير صالح.");
  }

  if (
    pathId &&
    !(await validatePath(db, pathId))
  ) {
    return badRequest("المسار القرآني غير صالح.");
  }

  const levelId =
    body.level_id === undefined ||
    body.level_id === null ||
    body.level_id === ""
      ? null
      : positiveInteger(body.level_id);

  if (
    body.level_id !== undefined &&
    body.level_id !== null &&
    body.level_id !== "" &&
    !levelId
  ) {
    return badRequest("level_id غير صالح.");
  }

  if (
    levelId &&
    !(await validateLevel(
      db,
      levelId,
      pathId
    ))
  ) {
    return badRequest("المستوى القرآني غير صالح.");
  }

  const title = clean(body.title);

  if (!title) {
    return badRequest("عنوان الخطة مطلوب.");
  }

  const startDate = normalizeDate(
    body.start_date
  );

  if (!startDate) {
    return badRequest("start_date غير صالح.");
  }

  const targetEndDate =
    body.target_end_date === undefined ||
    body.target_end_date === null ||
    body.target_end_date === ""
      ? null
      : normalizeDate(body.target_end_date);

  if (
    body.target_end_date !== undefined &&
    body.target_end_date !== null &&
    body.target_end_date !== "" &&
    !targetEndDate
  ) {
    return badRequest(
      "target_end_date غير صالح."
    );
  }

  if (
    targetEndDate &&
    targetEndDate < startDate
  ) {
    return badRequest(
      "تاريخ نهاية الخطة لا يمكن أن يسبق البداية."
    );
  }

  const status =
    body.status === undefined
      ? "draft"
      : normalizePlanStatus(body.status);

  if (!status) {
    return badRequest(
      "حالة الخطة غير صالحة."
    );
  }

  const result = await db.prepare(`
    INSERT INTO student_learning_plans (
      student_id,
      path_id,
      level_id,
      title,
      goal,
      start_date,
      target_end_date,
      status,
      created_by,
      updated_by
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    studentId,
    pathId,
    levelId,
    title,
    clean(body.goal),
    startDate,
    targetEndDate,
    status,
    Number(user.id),
    Number(user.id)
  ).run();

  return json({
    success: true,
    action: "create_plan",
    plan_id: result.meta?.last_row_id || null,
    student_id: studentId,
  }, 201);
}

async function updatePlan(db, user, body) {
  const planId = positiveInteger(
    body.plan_id
  );

  if (!planId) {
    return badRequest(
      "plan_id غير صالح."
    );
  }

  const plan = await getPlan(
    db,
    planId
  );

  if (!plan) {
    return notFound(
      "الخطة غير موجودة."
    );
  }

  const studentId = Number(
    plan.student_id
  );

  if (
    !(await canManagePlan(
      db,
      user,
      studentId
    ))
  ) {
    return forbidden();
  }

  const pathId =
    body.path_id === undefined
      ? plan.path_id
      : (
        body.path_id === null ||
        body.path_id === ""
          ? null
          : positiveInteger(body.path_id)
      );

  if (
    body.path_id !== undefined &&
    body.path_id !== null &&
    body.path_id !== "" &&
    !pathId
  ) {
    return badRequest(
      "path_id غير صالح."
    );
  }

  if (
    pathId &&
    !(await validatePath(db, pathId))
  ) {
    return badRequest(
      "المسار القرآني غير صالح."
    );
  }

  const levelId =
    body.level_id === undefined
      ? plan.level_id
      : (
        body.level_id === null ||
        body.level_id === ""
          ? null
          : positiveInteger(body.level_id)
      );

  if (
    body.level_id !== undefined &&
    body.level_id !== null &&
    body.level_id !== "" &&
    !levelId
  ) {
    return badRequest(
      "level_id غير صالح."
    );
  }

  if (
    levelId &&
    !(await validateLevel(
      db,
      levelId,
      pathId
    ))
  ) {
    return badRequest(
      "المستوى القرآني غير صالح."
    );
  }

  const title =
    body.title === undefined
      ? plan.title
      : clean(body.title);

  if (!title) {
    return badRequest(
      "عنوان الخطة مطلوب."
    );
  }

  const startDate =
    body.start_date === undefined
      ? plan.start_date
      : normalizeDate(body.start_date);

  if (!startDate) {
    return badRequest(
      "start_date غير صالح."
    );
  }

  const targetEndDate =
    body.target_end_date === undefined
      ? plan.target_end_date
      : (
        body.target_end_date === null ||
        body.target_end_date === ""
          ? null
          : normalizeDate(body.target_end_date)
      );

  if (
    body.target_end_date !== undefined &&
    body.target_end_date !== null &&
    body.target_end_date !== "" &&
    !targetEndDate
  ) {
    return badRequest(
      "target_end_date غير صالح."
    );
  }

  if (
    targetEndDate &&
    targetEndDate < startDate
  ) {
    return badRequest(
      "تاريخ نهاية الخطة لا يمكن أن يسبق البداية."
    );
  }

  const status =
    body.status === undefined
      ? plan.status
      : normalizePlanStatus(body.status);

  if (!status) {
    return badRequest(
      "حالة الخطة غير صالحة."
    );
  }

  const goal =
    body.goal === undefined
      ? plan.goal
      : clean(body.goal);

  await db.prepare(`
    UPDATE student_learning_plans
    SET
      path_id = ?,
      level_id = ?,
      title = ?,
      goal = ?,
      start_date = ?,
      target_end_date = ?,
      status = ?,
      updated_by = ?,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).bind(
    pathId,
    levelId,
    title,
    goal,
    startDate,
    targetEndDate,
    status,
    Number(user.id),
    planId
  ).run();

  return json({
    success: true,
    action: "update_plan",
    plan_id: planId,
    student_id: studentId,
  });
}

async function createGoal(db, user, body) {
  const planId = positiveInteger(
    body.plan_id
  );

  if (!planId) {
    return badRequest(
      "plan_id غير صالح."
    );
  }

  const plan = await getPlan(
    db,
    planId
  );

  if (!plan) {
    return notFound(
      "الخطة غير موجودة."
    );
  }

  const studentId = Number(
    plan.student_id
  );

  if (
    !(await canManagePlan(
      db,
      user,
      studentId
    ))
  ) {
    return forbidden();
  }

  const type = normalizeGoalType(
    body.goal_type
  );

  if (!type) {
    return badRequest(
      "goal_type غير صالح."
    );
  }

  const title = clean(body.title);

  if (!title) {
    return badRequest(
      "عنوان الهدف مطلوب."
    );
  }

  const dueDate =
    body.due_date === undefined ||
    body.due_date === null ||
    body.due_date === ""
      ? null
      : normalizeDate(body.due_date);

  if (
    body.due_date !== undefined &&
    body.due_date !== null &&
    body.due_date !== "" &&
    !dueDate
  ) {
    return badRequest(
      "due_date غير صالح."
    );
  }

  const surahNumber = integerOrNull(
    body.surah_number
  );

  const fromAyah = integerOrNull(
    body.from_ayah
  );

  const toAyah = integerOrNull(
    body.to_ayah
  );

  if (
    fromAyah &&
    toAyah &&
    toAyah < fromAyah
  ) {
    return badRequest(
      "to_ayah يجب أن يكون أكبر من أو مساويًا لـ from_ayah."
    );
  }

  const targetValue =
    positiveNumberOrNull(
      body.target_value
    );

  const status =
    body.status === undefined
      ? "pending"
      : normalizeGoalStatus(body.status);

  if (!status) {
    return badRequest(
      "حالة الهدف غير صالحة."
    );
  }

  const result = await db.prepare(`
    INSERT INTO student_learning_plan_goals (
      plan_id,
      goal_type,
      title,
      description,
      surah_number,
      surah_name,
      from_ayah,
      to_ayah,
      target_value,
      target_unit,
      due_date,
      progress_value,
      status,
      notes,
      created_by,
      updated_by
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    planId,
    type,
    title,
    clean(body.description),
    surahNumber,
    clean(body.surah_name),
    fromAyah,
    toAyah,
    targetValue,
    clean(body.target_unit),
    dueDate,
    0,
    status,
    clean(body.notes),
    Number(user.id),
    Number(user.id)
  ).run();

  return json({
    success: true,
    action: "create_goal",
    goal_id: result.meta?.last_row_id || null,
    plan_id: planId,
  }, 201);
}

async function getGoal(db, goalId) {
  return db.prepare(`
    SELECT
      g.*,
      p.student_id,
      p.title AS plan_title
    FROM student_learning_plan_goals g
    INNER JOIN student_learning_plans p
      ON p.id = g.plan_id
    WHERE g.id = ?
    LIMIT 1
  `).bind(Number(goalId)).first();
}

async function updateGoal(db, user, body) {
  const goalId = positiveInteger(
    body.goal_id
  );

  if (!goalId) {
    return badRequest(
      "goal_id غير صالح."
    );
  }

  const goal = await getGoal(
    db,
    goalId
  );

  if (!goal) {
    return notFound(
      "الهدف غير موجود."
    );
  }

  const studentId = Number(
    goal.student_id
  );

  if (
    !(await canManagePlan(
      db,
      user,
      studentId
    ))
  ) {
    return forbidden();
  }

  const type =
    body.goal_type === undefined
      ? goal.goal_type
      : normalizeGoalType(body.goal_type);

  if (!type) {
    return badRequest(
      "goal_type غير صالح."
    );
  }

  const title =
    body.title === undefined
      ? goal.title
      : clean(body.title);

  if (!title) {
    return badRequest(
      "عنوان الهدف مطلوب."
    );
  }

  const dueDate =
    body.due_date === undefined
      ? goal.due_date
      : (
        body.due_date === null ||
        body.due_date === ""
          ? null
          : normalizeDate(body.due_date)
      );

  if (
    body.due_date !== undefined &&
    body.due_date !== null &&
    body.due_date !== "" &&
    !dueDate
  ) {
    return badRequest(
      "due_date غير صالح."
    );
  }

  const surahNumber =
    body.surah_number === undefined
      ? goal.surah_number
      : integerOrNull(body.surah_number);

  const fromAyah =
    body.from_ayah === undefined
      ? goal.from_ayah
      : integerOrNull(body.from_ayah);

  const toAyah =
    body.to_ayah === undefined
      ? goal.to_ayah
      : integerOrNull(body.to_ayah);

  if (
    fromAyah &&
    toAyah &&
    toAyah < fromAyah
  ) {
    return badRequest(
      "to_ayah يجب أن يكون أكبر من أو مساويًا لـ from_ayah."
    );
  }

  const targetValue =
    body.target_value === undefined
      ? goal.target_value
      : positiveNumberOrNull(
          body.target_value
        );

  const targetUnit =
    body.target_unit === undefined
      ? goal.target_unit
      : clean(body.target_unit);

  const description =
    body.description === undefined
      ? goal.description
      : clean(body.description);

  const notes =
    body.notes === undefined
      ? goal.notes
      : clean(body.notes);

  const status =
    body.status === undefined
      ? goal.status
      : normalizeGoalStatus(body.status);

  if (!status) {
    return badRequest(
      "حالة الهدف غير صالحة."
    );
  }

  let progressValue =
    body.progress_value === undefined
      ? Number(goal.progress_value || 0)
      : nonNegativeNumber(body.progress_value);

  if (progressValue === null) {
    return badRequest(
      "progress_value غير صالح."
    );
  }

  if (
    targetValue !== null &&
    progressValue > targetValue
  ) {
    return badRequest(
      "قيمة التقدم لا يمكن أن تتجاوز الهدف."
    );
  }

  if (
    status === "completed" &&
    targetValue !== null
  ) {
    progressValue = targetValue;
  }

  await db.prepare(`
    UPDATE student_learning_plan_goals
    SET
      goal_type = ?,
      title = ?,
      description = ?,
      surah_number = ?,
      surah_name = ?,
      from_ayah = ?,
      to_ayah = ?,
      target_value = ?,
      target_unit = ?,
      due_date = ?,
      progress_value = ?,
      status = ?,
      notes = ?,
      updated_by = ?,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).bind(
    type,
    title,
    description,
    surahNumber,
    clean(
      body.surah_name === undefined
        ? goal.surah_name
        : body.surah_name
    ),
    fromAyah,
    toAyah,
    targetValue,
    targetUnit,
    dueDate,
    progressValue,
    status,
    notes,
    Number(user.id),
    goalId
  ).run();

  return json({
    success: true,
    action: "update_goal",
    goal_id: goalId,
    plan_id: Number(goal.plan_id),
  });
}


async function updateGoalProgress(db, user, body) {
  const goalId = positiveInteger(
    body.goal_id
  );

  if (!goalId) {
    return badRequest(
      "goal_id غير صالح."
    );
  }

  const goal = await getGoal(
    db,
    goalId
  );

  if (!goal) {
    return notFound(
      "الهدف غير موجود."
    );
  }

  const studentId = Number(
    goal.student_id
  );

  if (
    !(await canUpdateGoalProgress(
      db,
      user,
      studentId
    ))
  ) {
    return forbidden();
  }

  const progressValue =
    nonNegativeNumber(
      body.progress_value
    );

  if (progressValue === null) {
    return badRequest(
      "progress_value غير صالح."
    );
  }

  const targetValue =
    goal.target_value === null ||
    goal.target_value === undefined
      ? null
      : Number(goal.target_value);

  if (
    targetValue !== null &&
    progressValue > targetValue
  ) {
    return badRequest(
      "قيمة التقدم لا يمكن أن تتجاوز الهدف."
    );
  }

  let status =
    body.status === undefined
      ? goal.status
      : normalizeGoalStatus(body.status);

  if (!status) {
    return badRequest(
      "حالة الهدف غير صالحة."
    );
  }

  if (
    targetValue !== null &&
    progressValue >= targetValue
  ) {
    status = "completed";
  } else if (
    progressValue > 0 &&
    status === "pending"
  ) {
    status = "in_progress";
  }

  await db.prepare(`
    UPDATE student_learning_plan_goals
    SET
      progress_value = ?,
      status = ?,
      updated_by = ?,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).bind(
    progressValue,
    status,
    Number(user.id),
    goalId
  ).run();

  return json({
    success: true,
    action: "update_goal_progress",
    goal_id: goalId,
    progress_value: progressValue,
    status,
  });
}

async function completeGoal(db, user, body) {
  const goalId = positiveInteger(
    body.goal_id
  );

  if (!goalId) {
    return badRequest(
      "goal_id غير صالح."
    );
  }

  const goal = await getGoal(
    db,
    goalId
  );

  if (!goal) {
    return notFound(
      "الهدف غير موجود."
    );
  }

  const studentId = Number(
    goal.student_id
  );

  if (
    !(await canUpdateGoalProgress(
      db,
      user,
      studentId
    ))
  ) {
    return forbidden();
  }

  const progressValue =
    goal.target_value === null ||
    goal.target_value === undefined
      ? Number(goal.progress_value || 0)
      : Number(goal.target_value);

  await db.prepare(`
    UPDATE student_learning_plan_goals
    SET
      progress_value = ?,
      status = 'completed',
      updated_by = ?,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).bind(
    progressValue,
    Number(user.id),
    goalId
  ).run();

  return json({
    success: true,
    action: "complete_goal",
    goal_id: goalId,
    status: "completed",
  });
}

async function handleGet(request, env) {
  const permission = await requireAuth(
    request,
    env
  );

  if (!permission.ok) {
    return permission.response;
  }

  const user = permission.user;

  try {
    const url = new URL(request.url);

    const requestedStudent =
      url.searchParams.get("student_id");

    const requestedPlan =
      url.searchParams.get("plan_id");

    const studentId =
      await resolveStudentId(
        env.DB,
        user,
        requestedStudent
      );

    if (!studentId) {
      return badRequest(
        "student_id مطلوب."
      );
    }

    if (
      !(await canAccessStudent(
        env.DB,
        user,
        studentId
      ))
    ) {
      return forbidden();
    }

    const planId =
      await resolvePlanId(
        env.DB,
        studentId,
        requestedPlan
      );

    if (
      requestedPlan &&
      !planId
    ) {
      return badRequest(
        "plan_id غير صالح."
      );
    }

    const response =
      await buildResponse(
        env.DB,
        studentId,
        planId
      );

    if (!response) {
      return notFound();
    }

    return json({
      success: true,
      ...response,
    });
  } catch (error) {
    console.error(
      "learning-plan GET error:",
      error
    );

    return serverError();
  }
}

async function handlePost(request, env) {
  const auth = await requireAuth(
    request,
    env
  );

  if (!auth.ok) {
    return auth.response;
  }

  const user = auth.user;

  try {
    const body = await request.json();

    if (
      !body ||
      typeof body !== "object" ||
      Array.isArray(body)
    ) {
      return badRequest(
        "بيانات الطلب غير صالحة."
      );
    }

    const action = clean(body.action);

    const managementActions = new Set([
      "create_plan",
      "update_plan",
      "create_goal",
      "update_goal",
    ]);

    if (managementActions.has(action)) {
      const permission = await requirePermission(
        request,
        env,
        "quran.write"
      );

      if (!permission.ok) {
        return permission.response;
      }
    }

    switch (action) {
      case "create_plan":
        return await createPlan(
          env.DB,
          user,
          body
        );

      case "update_plan":
        return await updatePlan(
          env.DB,
          user,
          body
        );

      case "create_goal":
        return await createGoal(
          env.DB,
          user,
          body
        );

      case "update_goal":
        return await updateGoal(
          env.DB,
          user,
          body
        );

      case "update_goal_progress":
        return await updateGoalProgress(
          env.DB,
          user,
          body
        );

      case "complete_goal":
        return await completeGoal(
          env.DB,
          user,
          body
        );

      default:
        return badRequest(
          "action غير صالح."
        );
    }
  } catch (error) {
    console.error(
      "learning-plan POST error:",
      error
    );

    return serverError();
  }
}

export async function onRequestGet(
  context
) {
  return handleGet(
    context.request,
    context.env
  );
}

export async function onRequestPost(
  context
) {
  return handlePost(
    context.request,
    context.env
  );
}
