// =========================================================
// الأوَّابين — Academic Materials API
// functions/api/academic-materials.js
// =========================================================

import {
  requireAuth,
  json,
  writeAudit,
} from "./_auth.js";

const SUBJECT_TYPES = new Set([
  "tajweed",
  "tafsir",
  "fiqh",
  "hadith",
  "sirah",
  "noorani_qaida",
  "other",
]);

const MATERIAL_STATUSES = new Set([
  "draft",
  "approved",
  "archived",
]);

function id(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function text(value) {
  if (value === undefined || value === null) return null;
  const v = String(value).trim();
  return v || null;
}

function errorResponse(error, message, status = 400) {
  return json({ success: false, error, message }, status);
}

function canManage(user) {
  return ["admin", "supervisor", "teacher"].includes(user?.role);
}

function canApprove(user) {
  return ["admin", "supervisor"].includes(user?.role);
}

async function getMaterial(db, materialId) {
  return db.prepare(`
    SELECT *
    FROM academic_materials
    WHERE id = ?
    LIMIT 1
  `).bind(materialId).first();
}

async function getUnit(db, unitId) {
  return db.prepare(`
    SELECT *
    FROM academic_material_units
    WHERE id = ?
    LIMIT 1
  `).bind(unitId).first();
}

async function getLesson(db, lessonId) {
  return db.prepare(`
    SELECT
      l.*,
      u.material_id
    FROM academic_material_lessons l
    INNER JOIN academic_material_units u
      ON u.id = l.unit_id
    WHERE l.id = ?
    LIMIT 1
  `).bind(lessonId).first();
}

export async function onRequest({ request, env }) {
  const auth = await requireAuth(request, env);

  if (!auth.ok) return auth.response;

  const user = auth.user;
  const url = new URL(request.url);
  const action = url.searchParams.get("action") || "list";

  if (request.method === "GET") {
    if (action === "units") {
      const materialId = id(url.searchParams.get("material_id"));

      if (!materialId) {
        return errorResponse(
          "MATERIAL_ID_REQUIRED",
          "معرّف المادة مطلوب."
        );
      }

      const rows = await env.DB.prepare(`
        SELECT *
        FROM academic_material_units
        WHERE material_id = ?
          AND status = 'active'
        ORDER BY sort_order, id
      `).bind(materialId).all();

      return json({
        success: true,
        data: rows.results || [],
      });
    }

    if (action === "lessons") {
      const unitId = id(url.searchParams.get("unit_id"));

      if (!unitId) {
        return errorResponse(
          "UNIT_ID_REQUIRED",
          "معرّف الوحدة مطلوب."
        );
      }

      const rows = await env.DB.prepare(`
        SELECT *
        FROM academic_material_lessons
        WHERE unit_id = ?
          AND status = 'active'
        ORDER BY sort_order, id
      `).bind(unitId).all();

      return json({
        success: true,
        data: rows.results || [],
      });
    }

    if (action === "lesson") {
      const lessonId = id(url.searchParams.get("id"));

      if (!lessonId) {
        return errorResponse(
          "LESSON_ID_REQUIRED",
          "معرّف الدرس مطلوب."
        );
      }

      const lesson = await getLesson(env.DB, lessonId);

      if (!lesson) {
        return errorResponse(
          "LESSON_NOT_FOUND",
          "الدرس غير موجود.",
          404
        );
      }

      return json({
        success: true,
        data: lesson,
      });
    }

    const status = text(url.searchParams.get("status"));
    const subjectType = text(
      url.searchParams.get("subject_type")
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

      where.push("m.subject_type = ?");
      params.push(subjectType);
    }

    if (status) {
      if (!MATERIAL_STATUSES.has(status)) {
        return errorResponse(
          "INVALID_STATUS",
          "حالة المادة غير صالحة."
        );
      }

      where.push("m.status = ?");
      params.push(status);
    } else if (!canManage(user)) {
      where.push("m.status = 'approved'");
    }

    const rows = await env.DB.prepare(`
      SELECT
        m.*,
        u.full_name AS creator_name,
        a.full_name AS approver_name,
        t.name AS term_name
      FROM academic_materials m
      LEFT JOIN users u ON u.id = m.created_by
      LEFT JOIN users a ON a.id = m.approved_by
      LEFT JOIN academic_terms t ON t.id = m.term_id
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY m.id DESC
    `).bind(...params).all();

    return json({
      success: true,
      data: rows.results || [],
      materials: rows.results || [],
    });
  }

  if (!canManage(user)) {
    return errorResponse(
      "ACADEMIC_MATERIALS_FORBIDDEN",
      "لا تملك صلاحية إدارة المواد الأكاديمية.",
      403
    );
  }

  const body = await request.json().catch(() => null);

  if (!body || typeof body !== "object") {
    return errorResponse(
      "INVALID_BODY",
      "بيانات الطلب غير صالحة."
    );
  }

  if (request.method === "POST") {
    if (action === "unit") {
      const materialId = id(body.material_id);
      const title = text(body.title);

      if (!materialId || !title) {
        return errorResponse(
          "MATERIAL_AND_TITLE_REQUIRED",
          "المادة وعنوان الوحدة مطلوبان."
        );
      }

      const material = await getMaterial(env.DB, materialId);

      if (!material) {
        return errorResponse(
          "MATERIAL_NOT_FOUND",
          "المادة غير موجودة.",
          404
        );
      }

      const result = await env.DB.prepare(`
        INSERT INTO academic_material_units
          (material_id, title, description, sort_order, created_by)
        VALUES (?, ?, ?, ?, ?)
        RETURNING *
      `).bind(
        materialId,
        title,
        text(body.description),
        Number.isInteger(Number(body.sort_order))
          ? Math.max(0, Number(body.sort_order))
          : 0,
        user.id
      ).first();

      return json({
        success: true,
        data: result,
      }, 201);
    }

    if (action === "lesson") {
      const unitId = id(body.unit_id);
      const title = text(body.title);

      if (!unitId || !title) {
        return errorResponse(
          "UNIT_AND_TITLE_REQUIRED",
          "الوحدة وعنوان الدرس مطلوبان."
        );
      }

      const unit = await getUnit(env.DB, unitId);

      if (!unit) {
        return errorResponse(
          "UNIT_NOT_FOUND",
          "الوحدة غير موجودة.",
          404
        );
      }

      const result = await env.DB.prepare(`
        INSERT INTO academic_material_lessons
          (
            unit_id,
            title,
            content,
            document_id,
            external_url,
            sort_order,
            created_by
          )
        VALUES (?, ?, ?, ?, ?, ?, ?)
        RETURNING *
      `).bind(
        unitId,
        title,
        text(body.content),
        id(body.document_id),
        text(body.external_url),
        Number.isInteger(Number(body.sort_order))
          ? Math.max(0, Number(body.sort_order))
          : 0,
        user.id
      ).first();

      return json({
        success: true,
        data: result,
      }, 201);
    }

    const title = text(body.title);
    const subjectType = text(body.subject_type);

    if (!title) {
      return errorResponse(
        "TITLE_REQUIRED",
        "عنوان المادة مطلوب."
      );
    }

    if (!subjectType || !SUBJECT_TYPES.has(subjectType)) {
      return errorResponse(
        "INVALID_SUBJECT_TYPE",
        "نوع المادة غير صالح."
      );
    }

    const result = await env.DB.prepare(`
      INSERT INTO academic_materials
        (
          title,
          subject_type,
          description,
          content,
          document_id,
          external_url,
          status,
          test_eligible,
          term_id,
          created_by
        )
      VALUES (?, ?, ?, ?, ?, ?, 'draft', 0, ?, ?)
      RETURNING *
    `).bind(
      title,
      subjectType,
      text(body.description),
      text(body.content),
      id(body.document_id),
      text(body.external_url),
      id(body.term_id),
      user.id
    ).first();

    await writeAudit(env, {
      userId: user.id,
      action: "academic_material.create",
      entityType: "academic_material",
      entityId: result?.id ?? null,
      request,
      details: {
        subject_type: subjectType,
      },
    });

    return json({
      success: true,
      message: "ACADEMIC_MATERIAL_CREATED_SUCCESSFULLY",
      data: result,
    }, 201);
  }

  if (request.method === "PATCH" && action === "lesson") {
    const lessonId = id(
      body.id ?? url.searchParams.get("id")
    );

    if (!lessonId) {
      return errorResponse(
        "LESSON_ID_REQUIRED",
        "معرّف الدرس مطلوب."
      );
    }

    const current = await getLesson(env.DB, lessonId);

    if (!current) {
      return errorResponse(
        "LESSON_NOT_FOUND",
        "الدرس غير موجود.",
        404
      );
    }

    const fields = [];
    const values = [];

    if ("title" in body) {
      const title = text(body.title);

      if (!title) {
        return errorResponse(
          "TITLE_REQUIRED",
          "عنوان الدرس مطلوب."
        );
      }

      fields.push("title = ?");
      values.push(title);
    }

    if ("content" in body) {
      fields.push("content = ?");
      values.push(text(body.content));
    }

    if ("document_id" in body) {
      fields.push("document_id = ?");
      values.push(id(body.document_id));
    }

    if ("external_url" in body) {
      fields.push("external_url = ?");
      values.push(text(body.external_url));
    }

    if ("sort_order" in body) {
      const sortOrder = Number(body.sort_order);

      if (!Number.isInteger(sortOrder) || sortOrder < 0) {
        return errorResponse(
          "INVALID_SORT_ORDER",
          "ترتيب الدرس غير صالح."
        );
      }

      fields.push("sort_order = ?");
      values.push(sortOrder);
    }

    if ("status" in body) {
      const status = text(body.status);

      if (!["active", "archived"].includes(status)) {
        return errorResponse(
          "INVALID_LESSON_STATUS",
          "حالة الدرس غير صالحة."
        );
      }

      fields.push("status = ?");
      values.push(status);
    }

    if (!fields.length) {
      return json({
        success: true,
        data: current,
      });
    }

    fields.push("updated_at = CURRENT_TIMESTAMP");
    values.push(lessonId);

    await env.DB.prepare(`
      UPDATE academic_material_lessons
      SET ${fields.join(", ")}
      WHERE id = ?
    `).bind(...values).run();

    const updated = await getLesson(
      env.DB,
      lessonId
    );

    await writeAudit(env, {
      userId: user?.id ?? null,
      action: "academic_material_lesson_updated",
      entityType: "academic_material_lessons",
      entityId: lessonId,
      details: {
        changed_fields: fields
          .filter(field => !field.startsWith("updated_at"))
          .map(field => field.split(" = ")[0])
      }
    });

    return json({
      success: true,
      data: updated,
    });
  }

  if (request.method === "PATCH") {
    const materialId = id(
      body.id ?? url.searchParams.get("id")
    );

    if (!materialId) {
      return errorResponse(
        "MATERIAL_ID_REQUIRED",
        "معرّف المادة مطلوب."
      );
    }

    const current = await getMaterial(env.DB, materialId);

    if (!current) {
      return errorResponse(
        "MATERIAL_NOT_FOUND",
        "المادة غير موجودة.",
        404
      );
    }

    if ("status" in body) {
      const status = text(body.status);

      if (!MATERIAL_STATUSES.has(status)) {
        return errorResponse(
          "INVALID_STATUS",
          "حالة المادة غير صالحة."
        );
      }

      if (status === "approved" && !canApprove(user)) {
        return errorResponse(
          "APPROVAL_FORBIDDEN",
          "اعتماد المادة متاح للإدارة فقط.",
          403
        );
      }

      await env.DB.prepare(`
        UPDATE academic_materials
        SET
          status = ?,
          test_eligible = ?,
          approved_by = ?,
          approved_at = ?,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).bind(
        status,
        status === "approved" ? 1 : 0,
        status === "approved" ? user.id : null,
        status === "approved"
          ? new Date().toISOString()
          : null,
        materialId
      ).run();
    }

    const fields = [];
    const values = [];

    for (const field of [
      "title",
      "description",
      "content",
      "external_url",
    ]) {
      if (field in body) {
        const value = text(body[field]);

        if (field === "title" && !value) {
          return errorResponse(
            "TITLE_REQUIRED",
            "عنوان المادة مطلوب."
          );
        }

        fields.push(`${field} = ?`);
        values.push(value);
      }
    }

    if ("subject_type" in body) {
      const value = text(body.subject_type);

      if (!SUBJECT_TYPES.has(value)) {
        return errorResponse(
          "INVALID_SUBJECT_TYPE",
          "نوع المادة غير صالح."
        );
      }

      fields.push("subject_type = ?");
      values.push(value);
    }

    if ("document_id" in body) {
      fields.push("document_id = ?");
      values.push(id(body.document_id));
    }

    if ("term_id" in body) {
      fields.push("term_id = ?");
      values.push(id(body.term_id));
    }

    if (fields.length) {
      fields.push("updated_at = CURRENT_TIMESTAMP");

      values.push(materialId);

      await env.DB.prepare(`
        UPDATE academic_materials
        SET ${fields.join(", ")}
        WHERE id = ?
      `).bind(...values).run();
    }

    return json({ success: true });
  }

  if (request.method === "DELETE") {
    const materialId = id(
      body.id ?? url.searchParams.get("id")
    );

    if (!materialId) {
      return errorResponse(
        "MATERIAL_ID_REQUIRED",
        "معرّف المادة مطلوب."
      );
    }

    const current = await getMaterial(env.DB, materialId);

    if (!current) {
      return errorResponse(
        "MATERIAL_NOT_FOUND",
        "المادة غير موجودة.",
        404
      );
    }

    await env.DB.prepare(`
      UPDATE academic_materials
      SET
        status = 'archived',
        test_eligible = 0,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).bind(materialId).run();

    return json({ success: true });
  }

  return errorResponse(
    "METHOD_NOT_SUPPORTED",
    "العملية غير مدعومة.",
    405
  );
}
