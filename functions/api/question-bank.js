// =========================================================
// الأوَّابين — Question Bank API
// functions/api/question-bank.js
// =========================================================

import {
  requirePermission,
  json,
  writeAudit,
} from "./_auth.js";

const SUBJECT_TYPES = new Set([
  "quran",
  "tajweed",
  "tafsir",
  "fiqh",
  "hadith",
  "sirah",
  "noorani_qaida",
  "other",
]);

const QUESTION_TYPES = new Set([
  "multiple_choice",
  "true_false",
  "short_answer",
  "essay",
  "oral",
  "memorization",
]);

const DIFFICULTIES = new Set([
  "easy",
  "medium",
  "hard",
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

function nullableId(value) {
  if (
    value === undefined ||
    value === null ||
    value === ""
  ) {
    return null;
  }

  return validId(value);
}

function cleanString(value) {
  if (
    value === undefined ||
    value === null
  ) {
    return null;
  }

  const valueString = String(value).trim();

  return valueString || null;
}

function validateEnum(value, allowed, field) {
  if (!allowed.has(value)) {
    return errorResponse(
      "INVALID_" + field.toUpperCase(),
      `قيمة ${field} غير صالحة.`
    );
  }

  return null;
}

function normalizeOptions(value) {
  if (
    value === undefined ||
    value === null ||
    value === ""
  ) {
    return null;
  }

  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return null;
    }
  }

  if (!Array.isArray(value)) {
    return null;
  }

  const options = value
    .map((item) => String(item ?? "").trim())
    .filter(Boolean);

  return options.length ? options : null;
}

function normalizeActive(value, fallback = 1) {
  if (
    value === undefined ||
    value === null ||
    value === ""
  ) {
    return fallback ? 1 : 0;
  }

  if (
    value === true ||
    value === 1 ||
    value === "1" ||
    value === "true"
  ) {
    return 1;
  }

  if (
    value === false ||
    value === 0 ||
    value === "0" ||
    value === "false"
  ) {
    return 0;
  }

  return null;
}

async function validateQuestion(db, body, existing = null) {
  const subjectType =
    body.subject_type === undefined
      ? existing?.subject_type
      : cleanString(body.subject_type);

  const questionType =
    body.question_type === undefined
      ? existing?.question_type
      : cleanString(body.question_type);

  const difficulty =
    body.difficulty === undefined
      ? existing?.difficulty
      : cleanString(body.difficulty);

  const questionText =
    body.question_text === undefined
      ? existing?.question_text
      : cleanString(body.question_text);

  if (!subjectType || !SUBJECT_TYPES.has(subjectType)) {
    return {
      error: errorResponse(
        "INVALID_SUBJECT_TYPE",
        "نوع المادة غير صالح."
      ),
    };
  }

  if (!questionType || !QUESTION_TYPES.has(questionType)) {
    return {
      error: errorResponse(
        "INVALID_QUESTION_TYPE",
        "نوع السؤال غير صالح."
      ),
    };
  }

  if (!difficulty || !DIFFICULTIES.has(difficulty)) {
    return {
      error: errorResponse(
        "INVALID_DIFFICULTY",
        "درجة الصعوبة غير صالحة."
      ),
    };
  }

  if (!questionText) {
    return {
      error: errorResponse(
        "INVALID_QUESTION_TEXT",
        "نص السؤال مطلوب."
      ),
    };
  }

  const rawOptions =
    body.options_json === undefined
      ? existing?.options_json
      : body.options_json;

  let options = null;

  if (rawOptions !== null && rawOptions !== undefined && rawOptions !== "") {
    options = normalizeOptions(rawOptions);

    if (!options) {
      return {
        error: errorResponse(
          "INVALID_OPTIONS",
          "خيارات السؤال يجب أن تكون قائمة JSON صالحة."
        ),
      };
    }
  }

  if (questionType === "multiple_choice") {
    if (!options || options.length < 2) {
      return {
        error: errorResponse(
          "MULTIPLE_CHOICE_OPTIONS_REQUIRED",
          "أسئلة الاختيار من متعدد تحتاج خيارين على الأقل."
        ),
      };
    }
  }

  if (questionType === "true_false") {
    options = ["true", "false"];
  }

  const correctAnswer =
    body.correct_answer === undefined
      ? existing?.correct_answer
      : cleanString(body.correct_answer);

  if (
    questionType === "multiple_choice" &&
    correctAnswer &&
    options &&
    !options.includes(correctAnswer)
  ) {
    return {
      error: errorResponse(
        "INVALID_CORRECT_ANSWER",
        "الإجابة الصحيحة يجب أن تكون ضمن خيارات السؤال."
      ),
    };
  }

  if (
    questionType === "true_false" &&
    correctAnswer &&
    !["true", "false"].includes(correctAnswer)
  ) {
    return {
      error: errorResponse(
        "INVALID_CORRECT_ANSWER",
        "الإجابة الصحيحة في سؤال صح أو خطأ يجب أن تكون true أو false."
      ),
    };
  }

  const surahNumber =
    body.surah_number === undefined
      ? existing?.surah_number ?? null
      : nullableId(body.surah_number);

  const ayahStart =
    body.ayah_start === undefined
      ? existing?.ayah_start ?? null
      : nullableId(body.ayah_start);

  const ayahEnd =
    body.ayah_end === undefined
      ? existing?.ayah_end ?? null
      : nullableId(body.ayah_end);

  const levelId =
    body.level_id === undefined
      ? existing?.level_id ?? null
      : nullableId(body.level_id);

  if (
    body.surah_number !== undefined &&
    body.surah_number !== null &&
    body.surah_number !== "" &&
    !surahNumber
  ) {
    return {
      error: errorResponse(
        "INVALID_SURAH_NUMBER",
        "رقم السورة غير صالح."
      ),
    };
  }

  if (
    subjectType !== "quran" &&
    (
      surahNumber !== null ||
      ayahStart !== null ||
      ayahEnd !== null
    )
  ) {
    return {
      error: errorResponse(
        "QURAN_FIELDS_REQUIRE_QURAN_SUBJECT",
        "بيانات السورة والآيات مخصصة لأسئلة القرآن فقط."
      ),
    };
  }

  if (
    surahNumber !== null &&
    (surahNumber < 1 || surahNumber > 114)
  ) {
    return {
      error: errorResponse(
        "INVALID_SURAH_NUMBER",
        "رقم السورة يجب أن يكون بين 1 و114."
      ),
    };
  }

  if (
    body.ayah_start !== undefined &&
    body.ayah_start !== null &&
    body.ayah_start !== "" &&
    !ayahStart
  ) {
    return {
      error: errorResponse(
        "INVALID_AYAH_START",
        "بداية الآيات غير صالحة."
      ),
    };
  }

  if (
    body.ayah_end !== undefined &&
    body.ayah_end !== null &&
    body.ayah_end !== "" &&
    !ayahEnd
  ) {
    return {
      error: errorResponse(
        "INVALID_AYAH_END",
        "نهاية الآيات غير صالحة."
      ),
    };
  }

  if (
    ayahStart !== null &&
    ayahStart < 1
  ) {
    return {
      error: errorResponse(
        "INVALID_AYAH_START",
        "بداية الآيات يجب أن تكون موجبة."
      ),
    };
  }

  if (
    ayahEnd !== null &&
    ayahEnd < 1
  ) {
    return {
      error: errorResponse(
        "INVALID_AYAH_END",
        "نهاية الآيات يجب أن تكون موجبة."
      ),
    };
  }

  if (
    ayahStart !== null &&
    ayahEnd !== null &&
    ayahStart > ayahEnd
  ) {
    return {
      error: errorResponse(
        "INVALID_AYAH_RANGE",
        "بداية الآيات لا يمكن أن تكون بعد نهايتها."
      ),
    };
  }

  if (
    body.level_id !== undefined &&
    body.level_id !== null &&
    body.level_id !== "" &&
    !levelId
  ) {
    return {
      error: errorResponse(
        "INVALID_LEVEL_ID",
        "معرّف المستوى غير صالح."
      ),
    };
  }

  if (levelId) {
    const level = await db
      .prepare(`
        SELECT id
        FROM quran_levels
        WHERE id = ?
        LIMIT 1
      `)
      .bind(levelId)
      .first();

    if (!level) {
      return {
        error: errorResponse(
          "LEVEL_NOT_FOUND",
          "المستوى غير موجود.",
          404
        ),
      };
    }
  }

  return {
    value: {
      subjectType,
      questionType,
      difficulty,
      questionText,
      optionsJson: options
        ? JSON.stringify(options)
        : null,
      correctAnswer,
      explanation:
        body.explanation === undefined
          ? existing?.explanation ?? null
          : cleanString(body.explanation),
      surahNumber,
      ayahStart,
      ayahEnd,
      levelId,
    },
  };
}

async function getQuestions(request, env) {
  const auth = await requirePermission(
    request,
    env,
    "question_bank.read"
  );

  if (!auth.ok) {
    return auth.response;
  }

  const url = new URL(request.url);

  const subjectType =
    cleanString(url.searchParams.get("subject_type"));

  const questionType =
    cleanString(url.searchParams.get("question_type"));

  const difficulty =
    cleanString(url.searchParams.get("difficulty"));

  const surahNumber =
    nullableId(url.searchParams.get("surah_number"));

  const levelId =
    nullableId(url.searchParams.get("level_id"));

  const activeParam =
    url.searchParams.get("is_active");

  const search =
    cleanString(url.searchParams.get("search"));

  const limitRaw =
    Number(url.searchParams.get("limit") || 100);

  const offsetRaw =
    Number(url.searchParams.get("offset") || 0);

  const limit = Math.max(
    1,
    Math.min(
      200,
      Number.isFinite(limitRaw)
        ? Math.floor(limitRaw)
        : 100
    )
  );

  const offset = Math.max(
    0,
    Number.isFinite(offsetRaw)
      ? Math.floor(offsetRaw)
      : 0
  );

  const where = [];
  const params = [];

  if (subjectType) {
    if (!SUBJECT_TYPES.has(subjectType)) {
      return errorResponse(
        "INVALID_SUBJECT_TYPE",
        "نوع المادة غير صالح."
      );
    }

    where.push("q.subject_type = ?");
    params.push(subjectType);
  }

  if (questionType) {
    if (!QUESTION_TYPES.has(questionType)) {
      return errorResponse(
        "INVALID_QUESTION_TYPE",
        "نوع السؤال غير صالح."
      );
    }

    where.push("q.question_type = ?");
    params.push(questionType);
  }

  if (difficulty) {
    if (!DIFFICULTIES.has(difficulty)) {
      return errorResponse(
        "INVALID_DIFFICULTY",
        "درجة الصعوبة غير صالحة."
      );
    }

    where.push("q.difficulty = ?");
    params.push(difficulty);
  }

  if (
    url.searchParams.has("surah_number") &&
    !surahNumber
  ) {
    return errorResponse(
      "INVALID_SURAH_NUMBER",
      "رقم السورة غير صالح."
    );
  }

  if (surahNumber) {
    if (surahNumber > 114) {
      return errorResponse(
        "INVALID_SURAH_NUMBER",
        "رقم السورة يجب أن يكون بين 1 و114."
      );
    }

    where.push("q.surah_number = ?");
    params.push(surahNumber);
  }

  if (
    url.searchParams.has("level_id") &&
    !levelId
  ) {
    return errorResponse(
      "INVALID_LEVEL_ID",
      "معرّف المستوى غير صالح."
    );
  }

  if (levelId) {
    where.push("q.level_id = ?");
    params.push(levelId);
  }

  if (activeParam !== null) {
    const active = normalizeActive(activeParam, 1);

    if (active === null) {
      return errorResponse(
        "INVALID_IS_ACTIVE",
        "قيمة is_active غير صالحة."
      );
    }

    where.push("q.is_active = ?");
    params.push(active);
  }

  if (search) {
    where.push(`
      (
        q.question_text LIKE ?
        OR q.explanation LIKE ?
      )
    `);

    const pattern = `%${search}%`;
    params.push(pattern, pattern);
  }

  const query = `
    SELECT
      q.*,
      u.full_name AS creator_name
    FROM question_bank q
    LEFT JOIN users u
      ON u.id = q.created_by
    ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
    ORDER BY q.id DESC
    LIMIT ${limit}
    OFFSET ${offset}
  `;

  const result = await env.DB
    .prepare(query)
    .bind(...params)
    .all();

  return json({
    success: true,
    data: result.results || [],
    questions: result.results || [],
    pagination: {
      limit,
      offset,
      count: (result.results || []).length,
    },
  });
}

async function createQuestion(request, env) {
  const auth = await requirePermission(
    request,
    env,
    "question_bank.write"
  );

  if (!auth.ok) {
    return auth.response;
  }

  const user = auth.user;

  const body = await request.json().catch(
    () => null
  );

  if (!body || typeof body !== "object") {
    return errorResponse(
      "INVALID_BODY",
      "بيانات السؤال غير صالحة."
    );
  }

  const validation = await validateQuestion(
    env.DB,
    body
  );

  if (validation.error) {
    return validation.error;
  }

  const q = validation.value;

  const inserted = await env.DB
    .prepare(`
      INSERT INTO question_bank (
        subject_type,
        question_type,
        difficulty,
        question_text,
        options_json,
        correct_answer,
        explanation,
        surah_number,
        ayah_start,
        ayah_end,
        level_id,
        is_active,
        created_by,
        created_at,
        updated_at
      )
      VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
        1, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      )
      RETURNING *
    `)
    .bind(
      q.subjectType,
      q.questionType,
      q.difficulty,
      q.questionText,
      q.optionsJson,
      q.correctAnswer,
      q.explanation,
      q.surahNumber,
      q.ayahStart,
      q.ayahEnd,
      q.levelId,
      user.id
    )
    .first();

  await writeAudit(env, {
    userId: user.id,
    action: "question_bank.create",
    entityType: "question_bank",
    entityId: inserted?.id ?? null,
    request,
    details: {
      subject_type: q.subjectType,
      question_type: q.questionType,
      difficulty: q.difficulty,
    },
  });

  return json(
    {
      success: true,
      message: "QUESTION_CREATED_SUCCESSFULLY",
      data: inserted,
    },
    201
  );
}

async function updateQuestion(request, env) {
  const auth = await requirePermission(
    request,
    env,
    "question_bank.write"
  );

  if (!auth.ok) {
    return auth.response;
  }

  const user = auth.user;
  const url = new URL(request.url);

  const body = await request.json().catch(
    () => null
  );

  const id = validId(
    body?.id ??
    url.searchParams.get("id")
  );

  if (!id) {
    return errorResponse(
      "INVALID_QUESTION_ID",
      "معرّف السؤال غير صالح."
    );
  }

  const existing = await env.DB
    .prepare(`
      SELECT *
      FROM question_bank
      WHERE id = ?
      LIMIT 1
    `)
    .bind(id)
    .first();

  if (!existing) {
    return errorResponse(
      "QUESTION_NOT_FOUND",
      "السؤال غير موجود.",
      404
    );
  }

  if (
    user.role === "teacher" &&
    Number(existing.created_by) !== Number(user.id)
  ) {
    return errorResponse(
      "FORBIDDEN",
      "لا يمكنك تعديل سؤال أنشأه معلم آخر.",
      403
    );
  }

  const validation = await validateQuestion(
    env.DB,
    body || {},
    existing
  );

  if (validation.error) {
    return validation.error;
  }

  const q = validation.value;

  const active =
    body?.is_active === undefined
      ? Number(existing.is_active ?? 1)
      : normalizeActive(body.is_active);

  if (active === null) {
    return errorResponse(
      "INVALID_IS_ACTIVE",
      "قيمة is_active غير صالحة."
    );
  }

  const updated = await env.DB
    .prepare(`
      UPDATE question_bank
      SET
        subject_type = ?2,
        question_type = ?3,
        difficulty = ?4,
        question_text = ?5,
        options_json = ?6,
        correct_answer = ?7,
        explanation = ?8,
        surah_number = ?9,
        ayah_start = ?10,
        ayah_end = ?11,
        level_id = ?12,
        is_active = ?13,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?1
      RETURNING *
    `)
    .bind(
      id,
      q.subjectType,
      q.questionType,
      q.difficulty,
      q.questionText,
      q.optionsJson,
      q.correctAnswer,
      q.explanation,
      q.surahNumber,
      q.ayahStart,
      q.ayahEnd,
      q.levelId,
      active
    )
    .first();

  await writeAudit(env, {
    userId: user.id,
    action: "question_bank.update",
    entityType: "question_bank",
    entityId: id,
    request,
    details: {
      subject_type: q.subjectType,
      question_type: q.questionType,
      is_active: active,
    },
  });

  return json({
    success: true,
    message: "QUESTION_UPDATED_SUCCESSFULLY",
    data: updated,
  });
}

async function deleteQuestion(request, env) {
  const auth = await requirePermission(
    request,
    env,
    "question_bank.write"
  );

  if (!auth.ok) {
    return auth.response;
  }

  const user = auth.user;
  const url = new URL(request.url);

  const id = validId(
    url.searchParams.get("id")
  );

  if (!id) {
    return errorResponse(
      "INVALID_QUESTION_ID",
      "معرّف السؤال غير صالح."
    );
  }

  const existing = await env.DB
    .prepare(`
      SELECT id, created_by
      FROM question_bank
      WHERE id = ?
      LIMIT 1
    `)
    .bind(id)
    .first();

  if (!existing) {
    return errorResponse(
      "QUESTION_NOT_FOUND",
      "السؤال غير موجود.",
      404
    );
  }

  if (
    user.role === "teacher" &&
    Number(existing.created_by) !== Number(user.id)
  ) {
    return errorResponse(
      "FORBIDDEN",
      "لا يمكنك تعطيل سؤال أنشأه معلم آخر.",
      403
    );
  }

  await env.DB
    .prepare(`
      UPDATE question_bank
      SET
        is_active = 0,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `)
    .bind(id)
    .run();

  await writeAudit(env, {
    userId: user.id,
    action: "question_bank.delete",
    entityType: "question_bank",
    entityId: id,
    request,
    details: {
      previous_created_by: existing.created_by,
      soft_delete: true,
    },
  });

  return json({
    success: true,
    message: "QUESTION_DEACTIVATED_SUCCESSFULLY",
  });
}

export async function onRequestGet(context) {
  try {
    return await getQuestions(
      context.request,
      context.env
    );
  } catch (error) {
    console.error(
      "question-bank GET error",
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
    return await createQuestion(
      context.request,
      context.env
    );
  } catch (error) {
    console.error(
      "question-bank POST error",
      error
    );

    return errorResponse(
      "INTERNAL_ERROR",
      "حدث خطأ داخلي.",
      500
    );
  }
}

export async function onRequestPatch(context) {
  try {
    return await updateQuestion(
      context.request,
      context.env
    );
  } catch (error) {
    console.error(
      "question-bank PATCH error",
      error
    );

    return errorResponse(
      "INTERNAL_ERROR",
      "حدث خطأ داخلي.",
      500
    );
  }
}

export async function onRequestDelete(context) {
  try {
    return await deleteQuestion(
      context.request,
      context.env
    );
  } catch (error) {
    console.error(
      "question-bank DELETE error",
      error
    );

    return errorResponse(
      "INTERNAL_ERROR",
      "حدث خطأ داخلي.",
      500
    );
  }
}
