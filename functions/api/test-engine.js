import {
  requireAuth,
  requirePermission,
  json,
  writeAudit,
} from "./_auth.js";

const TEST_TYPES = new Set([
  "daily_quick",
  "weekly",
  "new_memorization",
  "near_revision",
  "old_review",
  "consolidation",
  "surah",
  "juz",
  "khatma",
  "tajweed",
  "noorani_qaida",
  "tafsir",
  "fiqh",
  "hadith",
  "sirah",
]);

const SUBJECT_TYPES = new Set([
  "quran",
  "tajweed",
  "tafsir",
  "fiqh",
  "hadith",
  "sirah",
  "noorani_qaida",
]);

const SOURCES = new Set([
  "academy",
  "smart",
  "manual",
  "external_supplement",
]);

function errorResponse(error, message, status = 400) {
  return json(
    {
      success: false,
      error,
      message,
    },
    status
  );
}

function validId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function cleanString(value) {
  if (value === undefined || value === null) {
    return null;
  }

  const text = String(value).trim();
  return text || null;
}

function validNumber(value, fallback = null) {
  if (
    value === undefined ||
    value === null ||
    value === ""
  ) {
    return fallback;
  }

  const number = Number(value);

  return Number.isFinite(number)
    ? number
    : null;
}

function getStudentId(user, requestedId) {
  if (
    requestedId !== undefined &&
    requestedId !== null &&
    requestedId !== ""
  ) {
    return validId(requestedId);
  }

  if (user?.student_id) {
    return validId(user.student_id);
  }

  if (user?.studentId) {
    return validId(user.studentId);
  }

  return null;
}

async function authorize(request, env, permission) {
  const auth = await requireAuth(request, env);

  if (!auth.ok) {
    return auth;
  }

  const permissionResult =
    await requirePermission(
      request,
      env,
      permission
    );

  if (permissionResult.ok) {
    return permissionResult;
  }

  if (
    auth.user.role === "admin" ||
    auth.user.role === "supervisor"
  ) {
    return auth;
  }

  return permissionResult;
}

async function canAccessStudent(
  db,
  user,
  studentId
) {
  if (
    user.role === "admin" ||
    user.role === "supervisor"
  ) {
    return true;
  }

  if (user.role === "student") {
    return (
      Number(user.student_id) ===
      Number(studentId)
    );
  }

  if (user.role !== "teacher") {
    return false;
  }

  const teacher = await db
    .prepare(
      `SELECT id
       FROM teachers
       WHERE user_id = ?
       LIMIT 1`
    )
    .bind(user.id)
    .first();

  if (!teacher?.id) {
    return false;
  }

  const assigned = await db
    .prepare(
      `SELECT 1
       FROM enrollments e
       WHERE e.student_id = ?
       AND e.teacher_id = ?
       LIMIT 1`
    )
    .bind(studentId, teacher.id)
    .first();

  return Boolean(assigned);
}

async function getProgress(
  db,
  studentId
) {
  const result = await db
    .prepare(
      `SELECT
         id,
         student_id,
         session_id,
         level_id,
         activity_type,
         surah_number,
         surah_name,
         from_ayah,
         to_ayah,
         amount_label,
         amount_value,
         quality_score,
         teacher_note,
         recorded_at
       FROM quran_progress
       WHERE student_id = ?
       ORDER BY recorded_at DESC, id DESC
       LIMIT 500`
    )
    .bind(studentId)
    .all();

  return result.results || [];
}

function chooseProgress(
  progress,
  testType
) {
  const rules = {
    new_memorization: [
      "new_memorization",
    ],

    near_revision: [
      "review",
      "memorization_review",
    ],

    old_review: [
      "review",
      "memorization_review",
      "cumulative_recitation",
    ],

    consolidation: [
      "tamkeen",
      "memorization_review",
      "review",
    ],

    surah: [
      "new_memorization",
      "review",
      "memorization_review",
      "tamkeen",
      "cumulative_recitation",
    ],

    juz: [
      "new_memorization",
      "review",
      "memorization_review",
      "tamkeen",
      "cumulative_recitation",
    ],

    khatma: [
      "review",
      "memorization_review",
      "tamkeen",
      "cumulative_recitation",
    ],

    weekly: [
      "new_memorization",
      "review",
      "memorization_review",
      "tamkeen",
    ],

    daily_quick: [
      "new_memorization",
      "review",
      "memorization_review",
    ],
  };

  const allowed =
    rules[testType] || rules.daily_quick;

  return progress.filter((item) =>
    allowed.includes(item.activity_type)
  );
}

async function selectQuestions(
  db,
  {
    subjectType,
    questionCount,
    progress,
    studentId,
  }
) {
  const limit =
    Math.max(
      1,
      Math.min(
        Number(questionCount) || 10,
        50
      )
    );

  const questionsResult =
    await db
      .prepare(
        `SELECT
           id,
           subject_type,
           question_type,
           difficulty,
           question_text,
           options_json,
           explanation,
           correct_answer,
           surah_number,
           ayah_start,
           ayah_end,
           level_id
         FROM question_bank
         WHERE is_active = 1
         AND subject_type = ?
         ORDER BY
           CASE difficulty
             WHEN 'medium' THEN 1
             WHEN 'easy' THEN 2
             WHEN 'hard' THEN 3
             ELSE 4
           END,
           id DESC
         LIMIT 300`
      )
      .bind(subjectType)
      .all();

  const pool =
    questionsResult.results || [];

  if (!pool.length) {
    return [];
  }

  const progressRows =
    Array.isArray(progress)
      ? progress
      : [];

  /*
   * Previous questions for this student.
   * We avoid repeating them when enough unused
   * questions are available.
   */
  let previousQuestionIds =
    new Set();

  if (Number.isInteger(Number(studentId))) {
    const previous =
      await db
        .prepare(
          `SELECT DISTINCT
             taq.question_id
           FROM test_attempt_questions taq
           INNER JOIN test_attempts ta
             ON ta.id = taq.attempt_id
           WHERE ta.student_id = ?
           ORDER BY taq.question_id`
        )
        .bind(Number(studentId))
        .all();

    previousQuestionIds =
      new Set(
        (previous.results || [])
          .map((row) =>
            Number(row.question_id)
          )
          .filter(
            (id) => Number.isInteger(id)
          )
      );
  }

  /*
   * Previous Quran errors are used as a priority signal.
   * A question matching the same surah/ayah as a previous
   * error gets higher priority.
   */
  let errorRows = [];

  if (Number.isInteger(Number(studentId))) {
    const errors =
      await db
        .prepare(
          `SELECT
             e.surah_number,
             e.ayah_number,
             e.error_category,
             e.severity
           FROM test_errors e
           INNER JOIN test_attempt_questions aq
             ON aq.id = e.attempt_question_id
           INNER JOIN test_attempts ta
             ON ta.id = aq.attempt_id
           WHERE ta.student_id = ?
           ORDER BY
             CASE e.severity
               WHEN 'critical' THEN 1
               WHEN 'high' THEN 2
               WHEN 'medium' THEN 3
               WHEN 'low' THEN 4
               ELSE 5
             END,
             e.created_at DESC
           LIMIT 200`
        )
        .bind(Number(studentId))
        .all();

    errorRows =
      errors.results || [];
  }

  const severityWeight = {
    critical: 100,
    high: 70,
    medium: 40,
    low: 20,
  };

  const errorKey = (
    surah,
    ayah
  ) =>
    Number.isInteger(Number(surah)) &&
    Number.isInteger(Number(ayah))
      ? `${Number(surah)}:${Number(ayah)}`
      : null;

  const errorScores =
    new Map();

  for (const error of errorRows) {
    const key =
      errorKey(
        error.surah_number,
        error.ayah_number
      );

    if (!key) {
      continue;
    }

    const weight =
      severityWeight[
        error.severity
      ] || 10;

    errorScores.set(
      key,
      (errorScores.get(key) || 0) +
        weight
    );
  }

  const progressBySurah =
    new Map();

  for (const item of progressRows) {
    const surah =
      Number(item.surah_number);

    if (
      !Number.isInteger(surah) ||
      surah < 1 ||
      surah > 114
    ) {
      continue;
    }

    const existing =
      progressBySurah.get(surah);

    if (
      !existing ||
      String(
        item.recorded_at || ""
      ) >
        String(
          existing.recorded_at || ""
        )
    ) {
      progressBySurah.set(
        surah,
        item
      );
    }
  }

  /*
   * Score every question.
   *
   * Priority:
   *  - previous errors
   *  - exact progress ayah overlap
   *  - same surah
   *  - recent/available progress
   *  - questions not previously used
   *  - balanced difficulty
   */
  const scored =
    pool.map((question) => {
      const surah =
        Number(question.surah_number);

      const ayahStart =
        Number(question.ayah_start);

      const ayahEnd =
        Number(question.ayah_end);

      const progressItem =
        progressBySurah.get(surah);

      let score = 0;

      if (
        progressItem &&
        Number.isInteger(surah)
      ) {
        score += 100;

        const fromAyah =
          Number(progressItem.from_ayah);

        const toAyah =
          Number(progressItem.to_ayah);

        if (
          Number.isInteger(ayahStart) &&
          Number.isInteger(ayahEnd) &&
          Number.isInteger(fromAyah) &&
          Number.isInteger(toAyah) &&
          ayahStart <= toAyah &&
          ayahEnd >= fromAyah
        ) {
          score += 120;
        }

        const quality =
          Number(
            progressItem.quality_score
          );

        if (
          Number.isFinite(quality)
        ) {
          /*
           * Lower quality means more useful
           * for reinforcement.
           */
          score += Math.max(
            0,
            40 - quality
          );
        }
      }

      if (
        Number.isInteger(surah)
      ) {
        const errorScore =
          errorScores.get(
            errorKey(
              surah,
              ayahStart
            )
          ) || 0;

        score += errorScore;

        /*
         * Also consider an error anywhere
         * inside the question's ayah range.
         */
        if (
          Number.isInteger(ayahStart) &&
          Number.isInteger(ayahEnd)
        ) {
          for (const [
            key,
            weight
          ] of errorScores) {
            const [
              errorSurah,
              errorAyah
            ] =
              key
                .split(":")
                .map(Number);

            if (
              errorSurah === surah &&
              errorAyah >= ayahStart &&
              errorAyah <= ayahEnd
            ) {
              score += weight;
            }
          }
        }
      }

      if (
        previousQuestionIds.has(
          Number(question.id)
        )
      ) {
        score -= 35;
      } else {
        score += 25;
      }

      /*
       * Prefer medium first, but do not force
       * every test to be medium.
       */
      if (
        question.difficulty === "medium"
      ) {
        score += 15;
      } else if (
        question.difficulty === "easy"
      ) {
        score += 8;
      } else if (
        question.difficulty === "hard"
      ) {
        score += 3;
      }

      return {
        question,
        score,
      };
    });

  scored.sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score;
    }

    return (
      Number(b.question.id) -
      Number(a.question.id)
    );
  });

  /*
   * First pass: prefer unused questions.
   */
  const unused =
    scored.filter(
      ({ question }) =>
        !previousQuestionIds.has(
          Number(question.id)
        )
    );

  const source =
    unused.length >= limit
      ? unused
      : scored;

  /*
   * Avoid duplicate question IDs and return
   * exactly the requested count when possible.
   */
  const selected = [];
  const selectedIds =
    new Set();

  for (const item of source) {
    const id =
      Number(item.question.id);

    if (
      !Number.isInteger(id) ||
      selectedIds.has(id)
    ) {
      continue;
    }

    selectedIds.add(id);
    selected.push(item.question);

    if (selected.length >= limit) {
      break;
    }
  }

  return selected;
}
async function createAttempt(
  request,
  env
) {
  const auth = await authorize(
    request,
    env,
    "tests.write"
  );

  if (!auth.ok) {
    return auth.response;
  }

  const body = await request.json();

  const studentId = getStudentId(
    auth.user,
    body.student_id
  );

  if (!studentId) {
    return errorResponse(
      "INVALID_STUDENT_ID",
      "يجب تحديد الطالب."
    );
  }

  if (
    !(await canAccessStudent(
      env.DB,
      auth.user,
      studentId
    ))
  ) {
    return errorResponse(
      "FORBIDDEN",
      "لا يمكنك إدارة اختبارات هذا الطالب.",
      403
    );
  }

  const testType =
    cleanString(body.test_type) ||
    "daily_quick";

  if (!TEST_TYPES.has(testType)) {
    return errorResponse(
      "INVALID_TEST_TYPE",
      "نوع الاختبار غير صالح."
    );
  }

  const subjectType =
    cleanString(body.subject_type) ||
    "quran";

  if (!SUBJECT_TYPES.has(subjectType)) {
    return errorResponse(
      "INVALID_SUBJECT_TYPE",
      "نوع المادة غير صالح."
    );
  }

  const questionCount = Math.min(
    Math.max(
      Math.floor(
        validNumber(
          body.question_count,
          10
        )
      ),
      1
    ),
    50
  );

  const progress = await getProgress(
    env.DB,
    studentId
  );

  const relevantProgress =
    subjectType === "quran"
      ? chooseProgress(
          progress,
          testType
        )
      : [];

  const questions =
    await selectQuestions(
      env.DB,
      {
        subjectType,
        questionCount,
        progress: relevantProgress,
        studentId,
      }
    );

  if (!questions.length) {
    return errorResponse(
      "NO_QUESTIONS_AVAILABLE",
      "لا توجد أسئلة مناسبة في بنك الأسئلة لهذا الاختبار."
    );
  }

  const title =
    cleanString(body.title) ||
    `اختبار ${testType}`;

  const source =
    cleanString(body.source) ||
    "smart";

  if (!SOURCES.has(source)) {
    return errorResponse(
      "INVALID_SOURCE",
      "مصدر الاختبار غير صالح."
    );
  }

  const teacherId =
    auth.user.role === "teacher"
      ? (
          await env.DB
            .prepare(
              `SELECT id
               FROM teachers
               WHERE user_id = ?
               LIMIT 1`
            )
            .bind(auth.user.id)
            .first()
        )?.id || null
      : validId(body.teacher_id);

  const attemptNumberRow =
    await env.DB
      .prepare(
        `SELECT COALESCE(
           MAX(attempt_number),
           0
         ) + 1 AS attempt_number
         FROM test_attempts
         WHERE student_id = ?
         AND test_type = ?`
      )
      .bind(
        studentId,
        testType
      )
      .first();

  const attemptNumber =
    Number(
      attemptNumberRow?.attempt_number
    ) || 1;

  const generationMetadata = JSON.stringify({
    progress_count: progress.length,
    relevant_progress_count:
      relevantProgress.length,
    question_count: questions.length,
    generated_at:
      new Date().toISOString(),
  });

  const inserted =
    await env.DB
      .prepare(
        `INSERT INTO test_attempts (
           student_id,
           teacher_id,
           session_id,
           template_id,
           test_type,
           subject_type,
           title,
           source,
           status,
           attempt_number,
           generation_reason,
           generation_metadata_json,
           max_score
         )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?)`
      )
      .bind(
        studentId,
        teacherId,
        validId(body.session_id),
        validId(body.template_id),
        testType,
        subjectType,
        title,
        source,
        attemptNumber,
        `تم توليد الاختبار بناءً على سجل الطالب الحالي ونوع الاختبار: ${testType}`,
        generationMetadata,
        questions.length
      )
      .run();

  const attemptId =
    Number(
      inserted.meta?.last_row_id
    );

  if (!attemptId) {
    throw new Error(
      "Failed to create test attempt"
    );
  }

  for (
    let index = 0;
    index < questions.length;
    index++
  ) {
    const question = questions[index];

    const matchingProgress =
      relevantProgress.find(
        (item) =>
          Number(item.surah_number) ===
          Number(question.surah_number)
      );

    await env.DB
      .prepare(
        `INSERT INTO test_attempt_questions (
           attempt_id,
           question_id,
           question_order,
           points,
           generated_reason,
           progress_reference_id
         )
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .bind(
        attemptId,
        question.id,
        index + 1,
        1,
        matchingProgress
          ? "مرتبط بموضع من سجل الورد والتقدم"
          : "اختيار من بنك الأسئلة حسب المادة",
        matchingProgress?.id || null
      )
      .run();
  }

  await writeAudit(
    env.DB,
    auth.user.id,
    "test_attempt.create",
    "test_attempts",
    attemptId,
    {
      student_id: studentId,
      test_type: testType,
      subject_type: subjectType,
      question_count: questions.length,
      source,
    }
  );

  return json({
    success: true,
    data: {
      id: attemptId,
      student_id: studentId,
      teacher_id: teacherId,
      test_type: testType,
      subject_type: subjectType,
      title,
      source,
      status: "draft",
      attempt_number: attemptNumber,
      question_count: questions.length,
      progress_count: progress.length,
      relevant_progress_count:
        relevantProgress.length,
    },
  }, 201);
}

export async function onRequestGet(context) {
  try {
    const auth = await authorize(
      context.request,
      context.env,
      "tests.read"
    );

    if (!auth.ok) {
      return auth.response;
    }

    const url = new URL(
      context.request.url
    );

    const studentId =
      getStudentId(
        auth.user,
        url.searchParams.get(
          "student_id"
        )
      );

    if (!studentId) {
      return errorResponse(
        "INVALID_STUDENT_ID",
        "يجب تحديد الطالب."
      );
    }

    if (
      !(await canAccessStudent(
        context.env.DB,
        auth.user,
        studentId
      ))
    ) {
      return errorResponse(
        "FORBIDDEN",
        "لا يمكنك الوصول إلى اختبارات هذا الطالب.",
        403
      );
    }

    const attemptId = validId(url.searchParams.get("attempt_id"));

    if (attemptId) {
      const attemptResult = await getAttemptForUser(
        context.env.DB,
        auth.user,
        attemptId
      );

      if (!attemptResult.ok) {
        return attemptResult.response;
      }

      const attempt = attemptResult.attempt;

      if (Number(attempt.student_id) !== Number(studentId)) {
        return errorResponse(
          "FORBIDDEN",
          "لا يمكنك الوصول إلى محاولة هذا الطالب.",
          403
        );
      }

      const questions = await getAttemptQuestions(
        context.env.DB,
        attemptId
      );

      return json({
        success: true,
        data: { attempt, questions },
      });
    }

    const attempts =
      await context.env.DB
        .prepare(
          `SELECT
             a.id,
             a.student_id,
             a.teacher_id,
             a.session_id,
             a.template_id,
             a.test_type,
             a.subject_type,
             a.title,
             a.source,
             a.status,
             a.attempt_number,
             a.previous_attempt_id,
             a.generation_reason,
             a.score,
             a.max_score,
             a.percentage,
             a.started_at,
             a.submitted_at,
             a.graded_at,
             a.teacher_note,
             a.created_at,
             a.updated_at
           FROM test_attempts a
           WHERE a.student_id = ?
           ORDER BY a.created_at DESC, a.id DESC
           LIMIT 100`
        )
        .bind(studentId)
        .all();

    return json({
      success: true,
      data: attempts.results || [],
    });
  } catch (error) {
    console.error(
      "test-engine GET error",
      error
    );

    return errorResponse(
      "INTERNAL_ERROR",
      "حدث خطأ داخلي.",
      500
    );
  }
}

export async function onRequestPost(context) {
  try {
    return await createAttempt(
      context.request,
      context.env
    );
  } catch (error) {
    console.error(
      "test-engine POST error",
      error
    );

    return errorResponse(
      "INTERNAL_ERROR",
      "حدث خطأ داخلي.",
      500
    );
  }
}

// === AL-AWABIN TEST ENGINE ANSWER/GRADING PATCH ===

async function getAttemptForUser(db, user, attemptId) {
  const attempt = await db
    .prepare(
      `SELECT
         a.id,
         a.student_id,
         a.teacher_id,
         a.session_id,
         a.test_type,
         a.subject_type,
         a.title,
         a.status,
         a.attempt_number,
         a.max_score,
         a.score,
         a.percentage
       FROM test_attempts a
       WHERE a.id = ?
       LIMIT 1`
    )
    .bind(attemptId)
    .first();

  if (!attempt) {
    return {
      ok: false,
      response: errorResponse(
        "ATTEMPT_NOT_FOUND",
        "محاولة الاختبار غير موجودة.",
        404
      ),
    };
  }

  const allowed = await canAccessStudent(
    db,
    user,
    attempt.student_id
  );

  if (!allowed) {
    return {
      ok: false,
      response: errorResponse(
        "FORBIDDEN",
        "لا يمكنك الوصول إلى محاولة هذا الطالب.",
        403
      ),
    };
  }

  return {
    ok: true,
    attempt,
  };
}

async function getAttemptQuestionsForGrading(db, attemptId) {
  const result = await db
    .prepare(
      `SELECT
         aq.id,
         aq.attempt_id,
         aq.question_id,
         aq.question_order,
         aq.points,
         q.question_type,
         q.question_text,
         q.options_json,
         q.explanation,
         q.correct_answer
       FROM test_attempt_questions aq
       INNER JOIN question_bank q
         ON q.id = aq.question_id
       WHERE aq.attempt_id = ?
       ORDER BY aq.question_order ASC, aq.id ASC`
    )
    .bind(attemptId)
    .all();

  return result.results || [];
}

async function getAttemptQuestions(db, attemptId) {
  const result = await db
    .prepare(
      `SELECT
         aq.id,
         aq.attempt_id,
         aq.question_id,
         aq.question_order,
         aq.points,
         q.question_type,
         q.question_text,
         q.options_json,
         q.explanation
       FROM test_attempt_questions aq
       INNER JOIN question_bank q
         ON q.id = aq.question_id
       WHERE aq.attempt_id = ?
       ORDER BY aq.question_order ASC, aq.id ASC`
    )
    .bind(attemptId)
    .all();

  return result.results || [];
}

function normalizeAnswer(value) {
  if (
    value === undefined ||
    value === null
  ) {
    return "";
  }

  return String(value).trim();
}

function autoGradeQuestion(question, answer) {
  const type = question.question_type;

  if (
    type === "oral" ||
    type === "memorization" ||
    type === "essay" ||
    type === "short_answer"
  ) {
    return {
      auto: false,
      isCorrect: null,
      score: 0,
      feedback: "يحتاج هذا السؤال إلى تصحيح المعلم.",
    };
  }

  const submitted =
    normalizeAnswer(answer.selected_option) ||
    normalizeAnswer(answer.answer_text);

  const correct =
    normalizeAnswer(question.correct_answer);

  if (!submitted) {
    return {
      auto: true,
      isCorrect: false,
      score: 0,
      feedback: "لم تتم الإجابة عن السؤال.",
    };
  }

  const isCorrect =
    submitted.toLowerCase() ===
    correct.toLowerCase();

  return {
    auto: true,
    isCorrect,
    score: isCorrect
      ? (Number(question.points) || 1)
      : 0,
    feedback: isCorrect
      ? "إجابة صحيحة."
      : "إجابة غير صحيحة.",
  };
}

async function saveAnswer(
  db,
  question,
  answer,
  userId
) {
  const graded = autoGradeQuestion(
    question,
    answer
  );

  const existing = await db
    .prepare(
      `SELECT id
       FROM test_answers
       WHERE attempt_question_id = ?
       LIMIT 1`
    )
    .bind(question.id)
    .first();

  if (existing?.id) {
    await db
      .prepare(
        `UPDATE test_answers
         SET
           answer_text = ?,
           selected_option = ?,
           is_correct = ?,
           score = ?,
           feedback = ?,
           graded_by = ?,
           answered_at = CURRENT_TIMESTAMP,
           graded_at = CASE
             WHEN ? = 1
             THEN CURRENT_TIMESTAMP
             ELSE graded_at
           END
         WHERE id = ?`
      )
      .bind(
        normalizeAnswer(answer.answer_text) || null,
        normalizeAnswer(answer.selected_option) || null,
        graded.isCorrect === null
          ? null
          : graded.isCorrect
            ? 1
            : 0,
        graded.score,
        graded.feedback,
        null,
        graded.auto ? 1 : 0,
        existing.id
      )
      .run();

    return {
      id: existing.id,
      ...graded,
    };
  }

  const inserted = await db
    .prepare(
      `INSERT INTO test_answers (
         attempt_question_id,
         answer_text,
         selected_option,
         is_correct,
         score,
         feedback,
         graded_by,
         graded_at
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      question.id,
      normalizeAnswer(answer.answer_text) || null,
      normalizeAnswer(answer.selected_option) || null,
      graded.isCorrect === null
        ? null
        : graded.isCorrect
          ? 1
          : 0,
      graded.score,
      graded.feedback,
      null,
      graded.auto
        ? new Date().toISOString()
        : null
    )
    .run();

  return {
    id: Number(
      inserted.meta?.last_row_id
    ),
    ...graded,
  };
}

async function recalculateAttempt(db, attemptId) {
  const questions = await db
    .prepare(
      `SELECT
         aq.id,
         aq.points,
         q.question_type
       FROM test_attempt_questions aq
       INNER JOIN question_bank q
         ON q.id = aq.question_id
       WHERE aq.attempt_id = ?`
    )
    .bind(attemptId)
    .all();

  const rows = questions.results || [];

  let score = 0;
  let maxScore = 0;
  let manualPending = false;

  for (const question of rows) {
    const points =
      Number(question.points) || 1;

    maxScore += points;

    const answer = await db
      .prepare(
        `SELECT
           is_correct,
           score,
           graded_at
         FROM test_answers
         WHERE attempt_question_id = ?
         LIMIT 1`
      )
      .bind(question.id)
      .first();

    const isManualQuestion =
      question.question_type === "oral" ||
      question.question_type === "memorization" ||
      question.question_type === "essay" ||
      question.question_type === "short_answer";

    if (
      isManualQuestion &&
      (
        !answer ||
        !answer.graded_at
      )
    ) {
      manualPending = true;
    }

    if (answer) {
      score += Math.max(
        0,
        Math.min(
          points,
          Number(answer.score) || 0
        )
      );
    }
  }

  const percentage =
    maxScore > 0
      ? Math.round(
          (score / maxScore) * 10000
        ) / 100
      : 0;

  const status =
    manualPending
      ? "submitted"
      : "graded";

  await db
    .prepare(
      `UPDATE test_attempts
       SET
         score = ?,
         max_score = ?,
         percentage = ?,
         status = ?,
         submitted_at = COALESCE(
           submitted_at,
           CURRENT_TIMESTAMP
         ),
         graded_at = CASE
           WHEN ? = 'graded'
           THEN CURRENT_TIMESTAMP
           ELSE graded_at
         END,
         updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`
    )
    .bind(
      score,
      maxScore,
      percentage,
      status,
      status,
      attemptId
    )
    .run();

  return {
    score,
    max_score: maxScore,
    percentage,
    status,
    manual_pending: manualPending,
  };
}

async function submitAttempt(
  request,
  env
) {
  const auth = await requireAuth(
    request,
    env
  );

  if (!auth.ok) {
    return auth.response;
  }

  const body = await request.json();

  const attemptId =
    validId(body.attempt_id);

  if (!attemptId) {
    return errorResponse(
      "INVALID_ATTEMPT_ID",
      "يجب تحديد محاولة الاختبار."
    );
  }

  const attempt =
    await getAttemptForUser(
      env.DB,
      auth.user,
      attemptId
    );

  if (!attempt.ok) {
    return attempt.response;
  }

  if (
    attempt.attempt.status ===
    "cancelled"
  ) {
    return errorResponse(
      "ATTEMPT_CANCELLED",
      "لا يمكن الإجابة عن اختبار ملغى."
    );
  }

  if (
    attempt.attempt.status ===
    "graded"
  ) {
    return errorResponse(
      "ATTEMPT_ALREADY_GRADED",
      "تم تصحيح هذا الاختبار بالفعل."
    );
  }

  if (
    attempt.attempt.status ===
    "submitted"
  ) {
    return errorResponse(
      "ATTEMPT_ALREADY_SUBMITTED",
      "تم تسليم هذا الاختبار وينتظر تصحيح المعلم.",
      409
    );
  }

  const answers =
    Array.isArray(body.answers)
      ? body.answers
      : [];

  if (!answers.length) {
    return errorResponse(
      "NO_ANSWERS",
      "لم يتم إرسال أي إجابات."
    );
  }

  const questions =
    await getAttemptQuestionsForGrading(
      env.DB,
      attemptId
    );

  const questionMap =
    new Map(
      questions.map(
        (question) => [
          Number(question.id),
          question,
        ]
      )
    );

  const saved = [];

  for (const answer of answers) {
    const questionId =
      validId(
        answer.attempt_question_id
      );

    if (!questionId) {
      continue;
    }

    const question =
      questionMap.get(questionId);

    if (!question) {
      continue;
    }

    const result =
      await saveAnswer(
        env.DB,
        question,
        answer,
        auth.user.id
      );

    saved.push({
      attempt_question_id:
        questionId,
      auto_graded: result.auto,
      is_correct: result.isCorrect,
      score: result.score,
      feedback: result.feedback,
    });
  }

  if (!saved.length) {
    return errorResponse(
      "NO_VALID_ANSWERS",
      "لم يتم إرسال أي إجابة صالحة لأسئلة هذا الاختبار."
    );
  }

  const summary =
    await recalculateAttempt(
      env.DB,
      attemptId
    );

  await writeAudit(
    env.DB,
    auth.user.id,
    "test_attempt.submit",
    "test_attempts",
    attemptId,
    {
      answers_count: saved.length,
      score: summary.score,
      max_score: summary.max_score,
      percentage: summary.percentage,
      status: summary.status,
    }
  );

  return json({
    success: true,
    data: {
      attempt_id: attemptId,
      answers: saved,
      result: summary,
    },
  });
}

export async function onRequestPatch(context) {
  try {
    const url = new URL(
      context.request.url
    );

    const action =
      url.searchParams.get("action") ||
      "submit";

    if (action === "submit") {
      return await submitAttempt(
        context.request,
        context.env
      );
    }

    return errorResponse(
      "INVALID_ACTION",
      "الإجراء المطلوب غير صالح."
    );
  } catch (error) {
    console.error(
      "test-engine PATCH error",
      error
    );

    return errorResponse(
      "INTERNAL_ERROR",
      "حدث خطأ داخلي.",
      500
    );
  }
}

// === AL-AWABIN TEACHER GRADING + RUBRIC + ERRORS ===

const RUBRIC_CRITERIA = [
  "memorization",
  "retention",
  "prompting",
  "fluency",
  "tajweed",
  "waqf_ibtida",
];

const ERROR_CATEGORIES = [
  "memorization",
  "tajweed",
  "waqf_ibtida",
  "pronunciation",
  "omission",
  "addition",
  "substitution",
  "hesitation",
  "prompting",
  "other",
];

const ERROR_SEVERITIES = [
  "low",
  "medium",
  "high",
  "critical",
];

async function requireTeacherGradingAccess(
  request,
  env
) {
  const auth = await requireAuth(
    request,
    env
  );

  if (!auth.ok) {
    return auth;
  }

  const permission =
    await requirePermission(
      request,
      env,
      "tests.write"
    );

  if (!permission.ok) {
    return permission;
  }

  const role =
    auth.user?.role;

  if (
    role !== "admin" &&
    role !== "supervisor" &&
    role !== "teacher"
  ) {
    return errorResponse(
      "TEACHER_GRADING_FORBIDDEN",
      "لا يملك هذا الحساب صلاحية تصحيح الاختبارات."
    );
  }

  return {
    ok: true,
    user: auth.user,
  };
}

function validRubricScore(
  value,
  max
) {
  const n = Number(value);

  if (
    !Number.isFinite(n) ||
    n < 0 ||
    n > max
  ) {
    return null;
  }

  return n;
}

function normalizeErrorCategory(
  value
) {
  const category =
    cleanString(value);

  return ERROR_CATEGORIES.includes(
    category
  )
    ? category
    : null;
}

function normalizeErrorSeverity(
  value
) {
  const severity =
    cleanString(value);

  const aliases = {
    minor: "low",
    moderate: "medium",
    major: "high",
  };

  const normalized =
    aliases[severity] || severity;

  return ERROR_SEVERITIES.includes(
    normalized
  )
    ? normalized
    : "medium";
}

async function getAttemptForGrader(
  db,
  attemptId
) {
  const row =
    await db
      .prepare(
        `SELECT
           ta.*,
           s.full_name AS student_name,
           t.full_name AS teacher_name
         FROM test_attempts ta
         INNER JOIN students s
           ON s.id = ta.student_id
         LEFT JOIN teachers t
           ON t.id = ta.teacher_id
         WHERE ta.id = ?
         LIMIT 1`
      )
      .bind(attemptId)
      .first();

  if (!row) {
    return {
      ok: false,
      response: errorResponse(
        "ATTEMPT_NOT_FOUND",
        "محاولة الاختبار غير موجودة.",
        404
      ),
    };
  }

  return {
    ok: true,
    attempt: row,
  };
}

async function canTeacherGradeAttempt(
  db,
  user,
  attempt
) {
  if (
    user.role === "admin" ||
    user.role === "supervisor"
  ) {
    return true;
  }

  if (
    user.role !== "teacher"
  ) {
    return false;
  }

  const teacher =
    await db
      .prepare(
        `SELECT id
         FROM teachers
         WHERE user_id = ?
         LIMIT 1`
      )
      .bind(user.id)
      .first();

  if (!teacher?.id) {
    return false;
  }

  if (
    Number(attempt.teacher_id) ===
    Number(teacher.id)
  ) {
    return true;
  }

  const assigned =
    await db
      .prepare(
        `SELECT 1
         FROM enrollments
         WHERE student_id = ?
           AND teacher_id = ?
         LIMIT 1`
      )
      .bind(
        attempt.student_id,
        teacher.id
      )
      .first();

  return !!assigned;
}

async function gradeManualAnswers(
  db,
  attemptId,
  answers,
  graderId
) {
  const questions =
    await getAttemptQuestions(
      db,
      attemptId
    );

  const questionMap =
    new Map(
      questions.map(
        (question) => [
          Number(question.id),
          question,
        ]
      )
    );

  const results = [];

  if (!Array.isArray(answers)) {
    return results;
  }

  for (const item of answers) {
    const attemptQuestionId =
      validId(
        item.attempt_question_id
      );

    if (!attemptQuestionId) {
      continue;
    }

    const question =
      questionMap.get(
        attemptQuestionId
      );

    if (!question) {
      continue;
    }

    const manualTypes = [
      "oral",
      "memorization",
      "essay",
      "short_answer",
    ];

    if (
      !manualTypes.includes(
        question.question_type
      )
    ) {
      continue;
    }

    const points =
      Number(question.points) || 1;

    const score =
      validRubricScore(
        item.score,
        points
      );

    if (score === null) {
      continue;
    }

    const feedback =
      cleanString(
        item.feedback
      ) || null;

    const existing =
      await db
        .prepare(
          `SELECT id
           FROM test_answers
           WHERE attempt_question_id = ?
           LIMIT 1`
        )
        .bind(
          attemptQuestionId
        )
        .first();

    if (existing?.id) {
      await db
        .prepare(
          `UPDATE test_answers
           SET
             answer_text = COALESCE(?, answer_text),
             selected_option = COALESCE(?, selected_option),
             is_correct = ?,
             score = ?,
             feedback = ?,
             graded_by = ?,
             graded_at = CURRENT_TIMESTAMP
           WHERE id = ?`
        )
        .bind(
          cleanString(
            item.answer_text
          ) || null,
          cleanString(
            item.selected_option
          ) || null,
          score >= points ? 1 : 0,
          score,
          feedback,
          graderId,
          existing.id
        )
        .run();
    } else {
      await db
        .prepare(
          `INSERT INTO test_answers (
             attempt_question_id,
             answer_text,
             selected_option,
             is_correct,
             score,
             feedback,
             graded_by,
             graded_at
           )
           VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`
        )
        .bind(
          attemptQuestionId,
          cleanString(
            item.answer_text
          ) || null,
          cleanString(
            item.selected_option
          ) || null,
          score >= points ? 1 : 0,
          score,
          feedback,
          graderId
        )
        .run();
    }

    results.push({
      attempt_question_id:
        attemptQuestionId,
      score,
      max_score: points,
      is_correct:
        score >= points,
      feedback,
    });
  }

  return results;
}

async function saveRubricScores(
  db,
  attemptId,
  rubric,
  graderId
) {
  if (!Array.isArray(rubric)) {
    return [];
  }

  const saved = [];

  for (const item of rubric) {
    const criterion =
      cleanString(
        item.criterion
      );

    if (
      !criterion ||
      !RUBRIC_CRITERIA.includes(
        criterion
      )
    ) {
      continue;
    }

    const maxScore =
      validRubricScore(
        item.max_score ?? 10,
        100
      );

    const score =
      validRubricScore(
        item.score,
        maxScore ?? 10
      );

    if (
      maxScore === null ||
      score === null
    ) {
      continue;
    }

    const notes =
      cleanString(
        item.notes
      ) || null;

    const existing =
      await db
        .prepare(
          `SELECT id
           FROM test_rubric_scores
           WHERE attempt_id = ?
             AND criterion = ?
           LIMIT 1`
        )
        .bind(
          attemptId,
          criterion
        )
        .first();

    const percentage =
      maxScore > 0
        ? Math.round(
            (score / maxScore) *
              10000
          ) / 100
        : 0;

    if (existing?.id) {
      await db
        .prepare(
          `UPDATE test_rubric_scores
           SET
             score = ?,
             max_score = ?,
             percentage = ?,
             notes = ?,
             graded_by = ?,
             graded_at = CURRENT_TIMESTAMP
           WHERE id = ?`
        )
        .bind(
          score,
          maxScore,
          percentage,
          notes,
          graderId,
          existing.id
        )
        .run();
    } else {
      await db
        .prepare(
          `INSERT INTO test_rubric_scores (
             attempt_id,
             criterion,
             score,
             max_score,
             percentage,
             notes,
             graded_by,
             graded_at
           )
           VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`
        )
        .bind(
          attemptId,
          criterion,
          score,
          maxScore,
          percentage,
          notes,
          graderId
        )
        .run();
    }

    saved.push({
      criterion,
      score,
      max_score: maxScore,
      percentage,
      notes,
    });
  }

  return saved;
}

async function saveTestErrors(
  db,
  attemptId,
  errors,
  graderId
) {
  if (!Array.isArray(errors)) {
    return [];
  }

  const saved = [];

  for (const item of errors) {
    const attemptQuestionId =
      validId(
        item.attempt_question_id
      );

    if (!attemptQuestionId) {
      continue;
    }

    const question =
      await db
        .prepare(
          `SELECT
             id,
             attempt_id
           FROM test_attempt_questions
           WHERE id = ?
             AND attempt_id = ?
           LIMIT 1`
        )
        .bind(
          attemptQuestionId,
          attemptId
        )
        .first();

    if (!question) {
      continue;
    }

    const category =
      normalizeErrorCategory(
        item.category
      );

    if (!category) {
      continue;
    }

    const severity =
      normalizeErrorSeverity(
        item.severity
      );

    const surahNumber =
      item.surah_number == null
        ? null
        : Number(
            item.surah_number
          );

    const ayahNumber =
      item.ayah_number == null
        ? null
        : Number(
            item.ayah_number
          );

    if (
      surahNumber !== null &&
      (!Number.isInteger(
        surahNumber
      ) ||
        surahNumber < 1 ||
        surahNumber > 114)
    ) {
      continue;
    }

    if (
      ayahNumber !== null &&
      (!Number.isInteger(
        ayahNumber
      ) ||
        ayahNumber < 1)
    ) {
      continue;
    }

    const wordReference =
      cleanString(
        item.word_reference
      ) || null;

    const letterReference =
      cleanString(
        item.letter_reference
      ) || null;

    const harakahReference =
      cleanString(
        item.harakah_reference
      ) || null;

    const expectedText =
      cleanString(
        item.expected_text
      ) || null;

    const actualText =
      cleanString(
        item.actual_text
      ) || null;

    const notes =
      cleanString(
        item.notes
      ) || null;

    const inserted =
      await db
        .prepare(
          `INSERT INTO test_errors (
             attempt_question_id,
             error_category,
             severity,
             surah_number,
             ayah_number,
             word_reference,
             letter_reference,
             harakah_reference,
             expected_text,
             actual_text,
             notes
           )
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(
          attemptQuestionId,
          category,
          severity,
          surahNumber,
          ayahNumber,
          wordReference,
          letterReference,
          harakahReference,
          expectedText,
          actualText,
          notes
        )
        .run();

    saved.push({
      id: Number(
        inserted.meta?.last_row_id
      ),
      attempt_question_id:
        attemptQuestionId,
      category,
      severity,
      surah_number:
        surahNumber,
      ayah_number:
        ayahNumber,
      word_reference:
        wordReference,
      letter_reference:
        letterReference,
      harakah_reference:
        harakahReference,
      expected_text:
        expectedText,
      actual_text:
        actualText,
      notes,
    });
  }

  return saved;
}

async function finalizeTeacherGrade(
  db,
  attemptId,
  graderId,
  teacherNote
) {
  const manualPending =
    await db
      .prepare(
        `SELECT COUNT(*) AS count
         FROM test_attempt_questions aq
         INNER JOIN question_bank q
           ON q.id = aq.question_id
         LEFT JOIN test_answers a
           ON a.attempt_question_id = aq.id
         WHERE aq.attempt_id = ?
           AND q.question_type IN (
             'oral',
             'memorization',
             'essay',
             'short_answer'
           )
           AND (
             a.id IS NULL
             OR a.graded_at IS NULL
           )`
      )
      .bind(attemptId)
      .first();

  const pendingCount =
    Number(manualPending?.count) || 0;

  if (pendingCount > 0) {
    throw new Error(
      `MANUAL_GRADING_PENDING:${pendingCount}`
    );
  }

  const result =
    await recalculateAttempt(
      db,
      attemptId
    );

  await db
    .prepare(
      `UPDATE test_attempts
       SET
         status = 'graded',
         graded_by = ?,
         graded_at = CURRENT_TIMESTAMP,
         teacher_note = ?,
         submitted_at = COALESCE(
           submitted_at,
           CURRENT_TIMESTAMP
         ),
         updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`
    )
    .bind(
      graderId,
      cleanString(
        teacherNote
      ) || null,
      attemptId
    )
    .run();

  return {
    ...result,
    status: "graded",
  };
}

async function gradeAttempt(
  request,
  env
) {
  const access =
    await requireTeacherGradingAccess(
      request,
      env
    );

  if (!access.ok) {
    return access.response;
  }

  const body =
    await request.json();

  const attemptId =
    validId(
      body.attempt_id
    );

  if (!attemptId) {
    return errorResponse(
      "INVALID_ATTEMPT_ID",
      "يجب تحديد محاولة الاختبار."
    );
  }

  const found =
    await getAttemptForGrader(
      env.DB,
      attemptId
    );

  if (!found.ok) {
    return found.response;
  }

  const allowed =
    await canTeacherGradeAttempt(
      env.DB,
      access.user,
      found.attempt
    );

  if (!allowed) {
    return errorResponse(
      "GRADE_FORBIDDEN",
      "لا يمكنك تصحيح اختبار هذا الطالب.",
      403
    );
  }

  if (
    found.attempt.status ===
    "cancelled"
  ) {
    return errorResponse(
      "ATTEMPT_CANCELLED",
      "لا يمكن تصحيح اختبار ملغى."
    );
  }

  if (
    found.attempt.status ===
    "graded"
  ) {
    return errorResponse(
      "ATTEMPT_ALREADY_GRADED",
      "تم اعتماد تصحيح هذا الاختبار بالفعل.",
      409
    );
  }

  const answerResults =
    await gradeManualAnswers(
      env.DB,
      attemptId,
      body.answers,
      access.user.id
    );

  const rubricResults =
    await saveRubricScores(
      env.DB,
      attemptId,
      body.rubric,
      access.user.id
    );

  const errorResults =
    await saveTestErrors(
      env.DB,
      attemptId,
      body.errors,
      access.user.id
    );

  let finalResult;

  try {
    finalResult =
      await finalizeTeacherGrade(
        env.DB,
        attemptId,
        access.user.id,
        body.teacher_note
      );
  } catch (error) {
    const message =
      String(error?.message || "");

    if (
      message.startsWith(
        "MANUAL_GRADING_PENDING:"
      )
    ) {
      const pendingCount =
        Number(
          message.split(":")[1]
        ) || 0;

      return errorResponse(
        "MANUAL_GRADING_PENDING",
        `لا يمكن اعتماد التصحيح قبل إكمال تصحيح ${pendingCount} سؤال يدوي.`,
        409
      );
    }

    throw error;
  }

  await writeAudit(
    env.DB,
    access.user.id,
    "test_attempt.teacher_grade",
    "test_attempts",
    attemptId,
    {
      answers_count:
        answerResults.length,
      rubric_count:
        rubricResults.length,
      errors_count:
        errorResults.length,
      score:
        finalResult.score,
      max_score:
        finalResult.max_score,
      percentage:
        finalResult.percentage,
    }
  );

  return json({
    success: true,
    data: {
      attempt_id:
        attemptId,
      answers:
        answerResults,
      rubric:
        rubricResults,
      errors:
        errorResults,
      result:
        finalResult,
    },
  });
}

export async function onRequestPut(context) {
  try {
    const url =
      new URL(
        context.request.url
      );

    const action =
      url.searchParams.get(
        "action"
      ) || "grade";

    if (
      action === "grade"
    ) {
      return await gradeAttempt(
        context.request,
        context.env
      );
    }

    return errorResponse(
      "INVALID_ACTION",
      "الإجراء المطلوب غير صالح."
    );
  } catch (error) {
    console.error(
      "test-engine PUT error",
      error
    );

    return errorResponse(
      "INTERNAL_ERROR",
      "حدث خطأ داخلي.",
      500
    );
  }
}
