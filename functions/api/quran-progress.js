// =========================================================
// الأوَّابين — Quran Progress API
// functions/api/quran-progress.js
// =========================================================

import {
  requireAuth,
  requirePermission,
  json,
} from "./_auth.js";

function badRequest(message) {
  return json(
    {
      success: false,
      error: "BAD_REQUEST",
      message,
    },
    400
  );
}

function serverError(message, details = null) {
  return json(
    {
      success: false,
      error: "SERVER_ERROR",
      message,
      ...(details ? { details } : {}),
    },
    500
  );
}

function normalizeActivityType(value) {
  const allowed = [
    "new_memorization",
    "review",
    "memorization_review",
    "tamkeen",
    "cumulative_recitation",
  ];

  return allowed.includes(value) ? value : null;
}

function calculateAyahCount(fromAyah, toAyah) {
  if (
    Number.isInteger(fromAyah) &&
    Number.isInteger(toAyah) &&
    fromAyah > 0 &&
    toAyah >= fromAyah
  ) {
    return toAyah - fromAyah + 1;
  }

  return null;
}

function getStudentId(user, requestedId) {
  if (
    requestedId !== undefined &&
    requestedId !== null &&
    requestedId !== ""
  ) {
    const id = Number(requestedId);

    if (Number.isInteger(id) && id > 0) {
      return id;
    }

    return null;
  }

  if (user?.student_id) {
    return Number(user.student_id);
  }

  if (user?.studentId) {
    return Number(user.studentId);
  }

  return null;
}

async function canManageProgress(request, env) {
  const auth = await requireAuth(request, env);

  if (!auth.ok) {
    return auth;
  }

  const management = await requirePermission(
    request,
    env,
    "quran.progress.manage"
  );

  if (management.ok) {
    return management;
  }

  /*
   * السماح للمدير والمعلم بإدارة سجل الورد
   * حتى لا نعتمد على صلاحية غير موجودة مسبقًا.
   */
  if (
    auth.user.role === "admin" ||
    auth.user.role === "teacher"
  ) {
    return auth;
  }

  return management;
}

export async function onRequestGet(context) {
  const { request, env } = context;

  try {
    const auth = await requireAuth(request, env);

    if (!auth.ok) {
      return auth.response;
    }

    const url = new URL(request.url);

    const requestedStudentId =
      url.searchParams.get("student_id");

    const studentId = getStudentId(
      auth.user,
      requestedStudentId
    );

    if (!studentId) {
      return badRequest(
        "يجب تحديد الطالب."
      );
    }

    /*
     * الطالب يستطيع رؤية سجله فقط.
     * الإدارة والمعلم يستطيعان الوصول إلى طالب محدد.
     */
    if (
      requestedStudentId &&
      Number(requestedStudentId) !==
        Number(auth.user.student_id) &&
      auth.user.role !== "admin" &&
      auth.user.role !== "teacher"
    ) {
      return json(
        {
          success: false,
          error: "FORBIDDEN",
          message:
            "لا يمكنك الوصول إلى سجل طالب آخر.",
        },
        403
      );
    }

    const limitRaw =
      Number(url.searchParams.get("limit")) || 50;

    const offsetRaw =
      Number(url.searchParams.get("offset")) || 0;

    const limit = Math.min(
      Math.max(limitRaw, 1),
      200
    );

    const offset = Math.max(
      offsetRaw,
      0
    );

    const activityType =
      url.searchParams.get(
        "activity_type"
      );

    const normalizedActivityType =
      activityType
        ? normalizeActivityType(activityType)
        : null;

    if (
      activityType &&
      !normalizedActivityType
    ) {
      return badRequest(
        "نوع النشاط غير صحيح."
      );
    }

    let query = `
      SELECT
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
    `;

    const bindings = [studentId];

    if (normalizedActivityType) {
      query += `
        AND activity_type = ?
      `;

      bindings.push(
        normalizedActivityType
      );
    }

    query += `
      ORDER BY recorded_at DESC, id DESC
      LIMIT ? OFFSET ?
    `;

    bindings.push(
      limit,
      offset
    );

    const progressResult = await env.DB
      .prepare(query)
      .bind(...bindings)
      .all();

    const summary =
      await env.DB
        .prepare(`
          SELECT
            id,
            student_id,
            memorized_juz_count,
            cumulative_score,
            current_path_id,
            current_level_id,
            updated_at
          FROM student_progress_summary
          WHERE student_id = ?
          LIMIT 1
        `)
        .bind(studentId)
        .first();

    return json({
      success: true,
      data:
        progressResult.results || [],
      summary:
        summary || {
          student_id: studentId,
          memorized_juz_count: 0,
          cumulative_score: 0,
          current_path_id: null,
          current_level_id: null,
          updated_at: null,
        },
      pagination: {
        limit,
        offset,
        count:
          progressResult.results?.length ||
          0,
      },
    });
  } catch (error) {
    return serverError(
      "تعذر تحميل سجل الورد.",
      error?.message
    );
  }
}

export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    const management =
      await canManageProgress(
        request,
        env
      );

    if (!management.ok) {
      return management.response;
    }

    const body =
      await request
        .json()
        .catch(() => null);

    if (
      !body ||
      typeof body !== "object"
    ) {
      return badRequest(
        "بيانات الطلب غير صحيحة."
      );
    }

    const studentId =
      getStudentId(
        management.user,
        body.student_id
      );

    if (!studentId) {
      return badRequest(
        "يجب تحديد الطالب."
      );
    }

    const activityType =
      normalizeActivityType(
        body.activity_type
      );

    if (!activityType) {
      return badRequest(
        "نوع نشاط الورد غير صحيح."
      );
    }

    const surahNumber =
      Number(body.surah_number);

    if (
      !Number.isInteger(
        surahNumber
      ) ||
      surahNumber < 1 ||
      surahNumber > 114
    ) {
      return badRequest(
        "رقم السورة يجب أن يكون بين 1 و114."
      );
    }

    const fromAyah =
      body.from_ayah === null ||
      body.from_ayah === undefined ||
      body.from_ayah === ""
        ? null
        : Number(body.from_ayah);

    const toAyah =
      body.to_ayah === null ||
      body.to_ayah === undefined ||
      body.to_ayah === ""
        ? null
        : Number(body.to_ayah);

    if (
      fromAyah !== null &&
      (
        !Number.isInteger(
          fromAyah
        ) ||
        fromAyah < 1
      )
    ) {
      return badRequest(
        "بداية الآيات غير صحيحة."
      );
    }

    if (
      toAyah !== null &&
      (
        !Number.isInteger(
          toAyah
        ) ||
        toAyah < 1 ||
        (
          fromAyah !== null &&
          toAyah < fromAyah
        )
      )
    ) {
      return badRequest(
        "نهاية الآيات غير صحيحة."
      );
    }

    const ayahCount =
      calculateAyahCount(
        fromAyah,
        toAyah
      );

    let amountValue =
      body.amount_value === null ||
      body.amount_value === undefined ||
      body.amount_value === ""
        ? ayahCount
        : Number(
            body.amount_value
          );

    if (
      amountValue !== null &&
      !Number.isFinite(
        amountValue
      )
    ) {
      return badRequest(
        "قيمة الورد غير صحيحة."
      );
    }

    const qualityScore =
      body.quality_score === null ||
      body.quality_score === undefined ||
      body.quality_score === ""
        ? null
        : Number(
            body.quality_score
          );

    if (
      qualityScore !== null &&
      (
        !Number.isFinite(
          qualityScore
        ) ||
        qualityScore < 0 ||
        qualityScore > 100
      )
    ) {
      return badRequest(
        "درجة الجودة يجب أن تكون بين 0 و100."
      );
    }

    const sessionId =
      body.session_id === null ||
      body.session_id === undefined ||
      body.session_id === ""
        ? null
        : Number(
            body.session_id
          );

    const levelId =
      body.level_id === null ||
      body.level_id === undefined ||
      body.level_id === ""
        ? null
        : Number(
            body.level_id
          );

    const result =
      await env.DB
        .prepare(`
          INSERT INTO quran_progress (
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
            teacher_note
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .bind(
          studentId,
          sessionId,
          levelId,
          activityType,
          surahNumber,
          body.surah_name ||
            null,
          fromAyah,
          toAyah,
          body.amount_label ||
            null,
          amountValue,
          qualityScore,
          body.teacher_note ||
            null
        )
        .run();

    const insertedId =
      result?.meta?.last_row_id;

    const progress =
      insertedId
        ? await env.DB
            .prepare(`
              SELECT *
              FROM quran_progress
              WHERE id = ?
              LIMIT 1
            `)
            .bind(
              insertedId
            )
            .first()
        : null;

    return json(
      {
        success: true,
        message:
          "تم تسجيل الورد بنجاح.",
        data: progress,
        ayah_count:
          ayahCount,
      },
      201
    );
  } catch (error) {
    return serverError(
      "تعذر حفظ الورد.",
      error?.message
    );
  }
}

export async function onRequestDelete(context) {
  const { request, env } = context;

  try {
    const management =
      await canManageProgress(
        request,
        env
      );

    if (!management.ok) {
      return management.response;
    }

    const url =
      new URL(request.url);

    const id =
      Number(
        url.searchParams.get(
          "id"
        )
      );

    if (
      !Number.isInteger(id) ||
      id <= 0
    ) {
      return badRequest(
        "رقم السجل غير صحيح."
      );
    }

    const existing =
      await env.DB
        .prepare(`
          SELECT id
          FROM quran_progress
          WHERE id = ?
          LIMIT 1
        `)
        .bind(id)
        .first();

    if (!existing) {
      return json(
        {
          success: false,
          error: "NOT_FOUND",
          message:
            "سجل الورد غير موجود.",
        },
        404
      );
    }

    await env.DB
      .prepare(`
        DELETE FROM quran_progress
        WHERE id = ?
      `)
      .bind(id)
      .run();

    return json({
      success: true,
      message:
        "تم حذف سجل الورد.",
      deleted_id: id,
    });
  } catch (error) {
    return serverError(
      "تعذر حذف سجل الورد.",
      error?.message
    );
  }
}
