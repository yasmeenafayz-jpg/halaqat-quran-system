import {
  requirePermission,
  writeAudit,
} from "./_auth.js";

const HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
};

const VALUE_TYPES = new Set([
  "text",
  "number",
  "boolean",
  "json",
]);

const SCOPE_TYPES = new Set([
  "global",
  "academy",
  "branch",
  "circle",
  "session",
  "role",
  "user",
]);

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: HEADERS,
  });
}

function errorResponse(message, status = 400, extra = {}) {
  return json(
    {
      success: false,
      error: message,
      ...extra,
    },
    status
  );
}

function clean(value) {
  return String(value ?? "").trim();
}

function validId(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0;
}

function parseBoolean(value) {
  if (
    value === true ||
    value === 1 ||
    value === "1" ||
    String(value).toLowerCase() === "true"
  ) {
    return 1;
  }

  if (
    value === false ||
    value === 0 ||
    value === "0" ||
    String(value).toLowerCase() === "false"
  ) {
    return 0;
  }

  return null;
}

function normalizeValue(value, type) {
  if (type === "text") {
    return clean(value);
  }

  if (type === "number") {
    const n = Number(value);

    if (!Number.isFinite(n)) {
      throw new Error("INVALID_NUMBER_VALUE");
    }

    return String(n);
  }

  if (type === "boolean") {
    const b = parseBoolean(value);

    if (b === null) {
      throw new Error("INVALID_BOOLEAN_VALUE");
    }

    return String(b);
  }

  if (type === "json") {
    if (typeof value === "string") {
      JSON.parse(value);
      return value;
    }

    return JSON.stringify(value);
  }

  throw new Error("INVALID_VALUE_TYPE");
}

function deserializeValue(value, type) {
  if (value === null || value === undefined) {
    return null;
  }

  if (type === "number") {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }

  if (type === "boolean") {
    return String(value) === "1";
  }

  if (type === "json") {
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }

  return value;
}

function sanitizeSetting(row, user) {
  const sensitive =
    Number(row.is_sensitive) === 1;

  return {
    id: row.id,
    setting_key: row.setting_key,
    setting_value:
      sensitive && user.role !== "admin"
        ? null
        : deserializeValue(
            row.setting_value,
            row.value_type
          ),
    value_type: row.value_type,
    scope_type: row.scope_type,
    scope_id: row.scope_id,
    description: row.description,
    is_sensitive: sensitive,
    is_editable: Number(row.is_editable) === 1,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function validScope(scopeType, scopeId) {
  if (!SCOPE_TYPES.has(scopeType)) {
    return false;
  }

  if (scopeType === "global") {
    return scopeId === null || scopeId === undefined || scopeId === "";
  }

  return validId(scopeId);
}

async function onRequestGet(context) {
  const auth = await requirePermission(
    context.request,
    context.env,
    "settings.read"
  );

  if (!auth.ok) {
    return auth.response;
  }

  const db = context.env.DB;
  const url = new URL(context.request.url);

  const key = clean(
    url.searchParams.get("key")
  );

  const scopeType = clean(
    url.searchParams.get("scopeType")
  );

  const scopeIdRaw =
    url.searchParams.get("scopeId");

  const scopeId =
    scopeIdRaw === null ||
    scopeIdRaw === ""
      ? null
      : Number(scopeIdRaw);

  try {
    let sql = `
      SELECT
        id,
        setting_key,
        setting_value,
        value_type,
        scope_type,
        scope_id,
        description,
        is_sensitive,
        is_editable,
        created_at,
        updated_at
      FROM system_settings
      WHERE 1 = 1
    `;

    const params = [];

    if (key) {
      sql += ` AND setting_key = ?`;
      params.push(key);
    }

    if (scopeType) {
      if (!SCOPE_TYPES.has(scopeType)) {
        return errorResponse(
          "INVALID_SCOPE_TYPE",
          400
        );
      }

      sql += ` AND scope_type = ?`;
      params.push(scopeType);
    }

    if (scopeId !== null) {
      if (!validId(scopeId)) {
        return errorResponse(
          "INVALID_SCOPE_ID",
          400
        );
      }

      sql += ` AND scope_id = ?`;
      params.push(scopeId);
    }

    sql += ` ORDER BY setting_key ASC, id ASC`;

    const statement = db.prepare(sql);

    const result =
      params.length > 0
        ? await statement.bind(...params).all()
        : await statement.all();

    return json({
      success: true,
      data: (result.results || []).map(
        (row) =>
          sanitizeSetting(
            row,
            auth.user
          )
      ),
    });
  } catch (error) {
    console.error(
      "SETTINGS_GET_FAILED",
      error
    );

    return errorResponse(
      "SETTINGS_READ_FAILED",
      500
    );
  }
}

async function onRequestPost(context) {
  const auth = await requirePermission(
    context.request,
    context.env,
    "settings.write"
  );

  if (!auth.ok) {
    return auth.response;
  }

  if (auth.user.role !== "admin") {
    return errorResponse(
      "ADMIN_ONLY",
      403
    );
  }

  try {
    const body =
      await context.request.json();

    const settingKey =
      clean(body.setting_key);

    const valueType =
      clean(body.value_type || "text");

    const scopeType =
      clean(body.scope_type || "global");

    const scopeId =
      body.scope_id === undefined ||
      body.scope_id === null ||
      body.scope_id === ""
        ? null
        : Number(body.scope_id);

    const description =
      clean(body.description) || null;

    const isSensitive =
      body.is_sensitive === true ||
      body.is_sensitive === 1 ||
      body.is_sensitive === "1"
        ? 1
        : 0;

    const isEditable =
      body.is_editable === false ||
      body.is_editable === 0 ||
      body.is_editable === "0"
        ? 0
        : 1;

    if (!settingKey) {
      return errorResponse(
        "SETTING_KEY_REQUIRED",
        400
      );
    }

    if (
      !/^[a-zA-Z0-9_.:-]{1,160}$/.test(
        settingKey
      )
    ) {
      return errorResponse(
        "INVALID_SETTING_KEY",
        400
      );
    }

    if (!VALUE_TYPES.has(valueType)) {
      return errorResponse(
        "INVALID_VALUE_TYPE",
        400
      );
    }

    if (
      !validScope(
        scopeType,
        scopeId
      )
    ) {
      return errorResponse(
        "INVALID_SCOPE",
        400
      );
    }

    const normalized =
      normalizeValue(
        body.setting_value,
        valueType
      );

    const existing =
      await context.env.DB
        .prepare(`
          SELECT *
          FROM system_settings
          WHERE setting_key = ?
            AND scope_type = ?
            AND (
              (scope_id = ?)
              OR (scope_id IS NULL AND ? IS NULL)
            )
          LIMIT 1
        `)
        .bind(
          settingKey,
          scopeType,
          scopeId,
          scopeId
        )
        .first();

    if (existing) {
      return errorResponse(
        "SETTING_ALREADY_EXISTS",
        409
      );
    }

    const created =
      await context.env.DB
        .prepare(`
          INSERT INTO system_settings (
            setting_key,
            setting_value,
            value_type,
            scope_type,
            scope_id,
            description,
            is_sensitive,
            is_editable,
            created_by,
            updated_by
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          RETURNING *
        `)
        .bind(
          settingKey,
          normalized,
          valueType,
          scopeType,
          scopeId,
          description,
          isSensitive,
          isEditable,
          auth.user.id,
          auth.user.id
        )
        .first();

    await writeAudit(
      context.env,
      {
        userId: auth.user.id,
        action: "settings.create",
        entityType: "system_setting",
        entityId: created?.id ?? null,
        request: context.request,
        details: {
          setting_key: settingKey,
          scope_type: scopeType,
          scope_id: scopeId,
          is_sensitive: isSensitive,
        },
      }
    );

    return json({
      success: true,
      message: "SETTING_CREATED_SUCCESSFULLY",
      data: sanitizeSetting(
        created,
        auth.user
      ),
    }, 201);
  } catch (error) {
    console.error(
      "SETTINGS_POST_FAILED",
      error
    );

    return errorResponse(
      error instanceof Error
        ? error.message
        : "SETTING_CREATE_FAILED",
      400
    );
  }
}

async function onRequestPatch(context) {
  const auth = await requirePermission(
    context.request,
    context.env,
    "settings.write"
  );

  if (!auth.ok) {
    return auth.response;
  }

  if (auth.user.role !== "admin") {
    return errorResponse(
      "ADMIN_ONLY",
      403
    );
  }

  try {
    const body =
      await context.request.json();

    const id =
      body.id === undefined
        ? null
        : Number(body.id);

    const settingKey =
      clean(body.setting_key);

    if (
      id === null &&
      !settingKey
    ) {
      return errorResponse(
        "SETTING_ID_OR_KEY_REQUIRED",
        400
      );
    }

    let existing;

    if (id !== null) {
      if (!validId(id)) {
        return errorResponse(
          "INVALID_SETTING_ID",
          400
        );
      }

      existing =
        await context.env.DB
          .prepare(`
            SELECT *
            FROM system_settings
            WHERE id = ?
            LIMIT 1
          `)
          .bind(id)
          .first();
    } else {
      existing =
        await context.env.DB
          .prepare(`
            SELECT *
            FROM system_settings
            WHERE setting_key = ?
              AND scope_type = ?
              AND (
                (scope_id = ?)
                OR (scope_id IS NULL AND ? IS NULL)
              )
            LIMIT 1
          `)
          .bind(
            settingKey,
            clean(
              body.scope_type ||
                "global"
            ),
            body.scope_id ??
              null,
            body.scope_id ??
              null
          )
          .first();
    }

    if (!existing) {
      return errorResponse(
        "SETTING_NOT_FOUND",
        404
      );
    }

    if (
      Number(existing.is_editable) !== 1
    ) {
      return errorResponse(
        "SETTING_NOT_EDITABLE",
        409
      );
    }

    const valueType =
      body.value_type === undefined
        ? existing.value_type
        : clean(body.value_type);

    if (!VALUE_TYPES.has(valueType)) {
      return errorResponse(
        "INVALID_VALUE_TYPE",
        400
      );
    }

    let normalizedValue =
      existing.setting_value;

    if (
      body.setting_value !==
      undefined
    ) {
      normalizedValue =
        normalizeValue(
          body.setting_value,
          valueType
        );
    }

    const description =
      body.description === undefined
        ? existing.description
        : clean(body.description) ||
          null;

    const isSensitive =
      body.is_sensitive === undefined
        ? Number(existing.is_sensitive)
        : body.is_sensitive === true ||
          body.is_sensitive === 1 ||
          body.is_sensitive === "1"
          ? 1
          : 0;

    const updated =
      await context.env.DB
        .prepare(`
          UPDATE system_settings
          SET
            setting_value = ?2,
            value_type = ?3,
            description = ?4,
            is_sensitive = ?5,
            updated_by = ?6,
            updated_at = CURRENT_TIMESTAMP
          WHERE id = ?1
          RETURNING *
        `)
        .bind(
          existing.id,
          normalizedValue,
          valueType,
          description,
          isSensitive,
          auth.user.id
        )
        .first();

    await writeAudit(
      context.env,
      {
        userId: auth.user.id,
        action: "settings.update",
        entityType: "system_setting",
        entityId: existing.id,
        request: context.request,
        details: {
          setting_key:
            existing.setting_key,
          scope_type:
            existing.scope_type,
          scope_id:
            existing.scope_id,
        },
      }
    );

    return json({
      success: true,
      message: "SETTING_UPDATED_SUCCESSFULLY",
      data: sanitizeSetting(
        updated,
        auth.user
      ),
    });
  } catch (error) {
    console.error(
      "SETTINGS_PATCH_FAILED",
      error
    );

    return errorResponse(
      error instanceof Error
        ? error.message
        : "SETTING_UPDATE_FAILED",
      400
    );
  }
}

export async function onRequest(context) {
  switch (
    context.request.method.toUpperCase()
  ) {
    case "GET":
      return onRequestGet(context);

    case "POST":
      return onRequestPost(context);

    case "PATCH":
      return onRequestPatch(context);

    default:
      return errorResponse(
        "METHOD_NOT_ALLOWED",
        405
      );
  }
}
