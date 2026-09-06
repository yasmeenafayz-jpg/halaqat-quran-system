import {
  requireAuth,
  hasPermission,
  json
} from "../_auth.js";

const ALLOWED_ROLES = new Set([
  "admin",
  "supervisor",
  "teacher",
  "student",
  "guardian"
]);

export async function onRequest(context) {
  const { request, env } = context;

  const auth = await requireAuth(request, env);

  if (!auth.ok) {
    return auth.response;
  }

  const user = auth.user;

  if (request.method.toUpperCase() !== "POST") {
    return json({
      success: false,
      error: "METHOD_NOT_ALLOWED"
    }, 405);
  }

  if (
    !(await hasPermission(
      env.DB,
      user,
      "documents.permissions"
    ))
  ) {
    return json({
      success: false,
      error: "FORBIDDEN"
    }, 403);
  }

  let body;

  try {
    body = await request.json();
  } catch {
    return json({
      success: false,
      error: "INVALID_JSON"
    }, 400);
  }

  if (
    !body ||
    typeof body !== "object" ||
    Array.isArray(body)
  ) {
    return json({
      success: false,
      error: "INVALID_REQUEST_BODY"
    }, 400);
  }

  const documentId = Number(body.document_id);

  if (!Number.isInteger(documentId) || documentId <= 0) {
    return json({
      success: false,
      error: "INVALID_DOCUMENT_ID"
    }, 400);
  }

  const document = await env.DB
    .prepare(`
      SELECT id
      FROM documents
      WHERE id = ?
      LIMIT 1
    `)
    .bind(documentId)
    .first();

  if (!document) {
    return json({
      success: false,
      error: "DOCUMENT_NOT_FOUND"
    }, 404);
  }

  const permissions =
    Array.isArray(body.permissions)
      ? body.permissions
      : [];

  const normalizedPermissions = [];

  /*
   * Prevent duplicate targets in the same request.
   */
  const roleTargets = new Set();
  const userTargets = new Set();

  /*
   * Validate the complete request BEFORE changing
   * the database.
   */
  for (const item of permissions) {
    if (
      !item ||
      typeof item !== "object" ||
      Array.isArray(item)
    ) {
      return json({
        success: false,
        error: "INVALID_PERMISSION_ENTRY"
      }, 400);
    }

    const role =
      item.role?.toString().trim() || null;

    const userId =
      item.user_id == null
        ? null
        : Number(item.user_id);

    if (role && !ALLOWED_ROLES.has(role)) {
      return json({
        success: false,
        error: "INVALID_ROLE"
      }, 400);
    }

    if (
      userId !== null &&
      (!Number.isInteger(userId) || userId <= 0)
    ) {
      return json({
        success: false,
        error: "INVALID_USER_ID"
      }, 400);
    }

    if (!role && userId === null) {
      return json({
        success: false,
        error: "PERMISSION_TARGET_REQUIRED"
      }, 400);
    }

    /*
     * A permission row targets either a role or a user,
     * never both.
     */
    if (role && userId !== null) {
      return json({
        success: false,
        error: "ROLE_AND_USER_CANNOT_BOTH_BE_SET"
      }, 400);
    }

    if (role) {
      if (roleTargets.has(role)) {
        return json({
          success: false,
          error: "DUPLICATE_ROLE_PERMISSION"
        }, 400);
      }

      roleTargets.add(role);
    }

    if (userId !== null) {
      if (userTargets.has(userId)) {
        return json({
          success: false,
          error: "DUPLICATE_USER_PERMISSION"
        }, 400);
      }

      userTargets.add(userId);
    }

    normalizedPermissions.push({
      role,
      userId,
      canView: item.can_view === false ? 0 : 1,
      canDownload: item.can_download === false ? 0 : 1,
      canEdit: item.can_edit === true ? 1 : 0,
      canDelete: item.can_delete === true ? 1 : 0
    });
  }

  /*
   * Verify every referenced user before any mutation.
   */
  if (userTargets.size > 0) {
    const userIds = [...userTargets];

    for (const userId of userIds) {
      const targetUser = await env.DB
        .prepare(`
          SELECT id, role, status
          FROM users
          WHERE id = ?
          LIMIT 1
        `)
        .bind(userId)
        .first();

      if (!targetUser) {
        return json({
          success: false,
          error: "USER_NOT_FOUND",
          user_id: userId
        }, 404);
      }

      /*
       * Do not grant document permissions to an invalid
       * account role.
       */
      if (!ALLOWED_ROLES.has(targetUser.role)) {
        return json({
          success: false,
          error: "USER_ROLE_NOT_ALLOWED",
          user_id: userId
        }, 400);
      }
    }
  }

  /*
   * Only now mutate the database.
   */
  await env.DB
    .prepare(`
      DELETE FROM document_permissions
      WHERE document_id = ?
    `)
    .bind(documentId)
    .run();

  for (const item of normalizedPermissions) {
    await env.DB
      .prepare(`
        INSERT INTO document_permissions (
          document_id,
          role,
          user_id,
          can_view,
          can_download,
          can_edit,
          can_delete,
          created_by
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .bind(
        documentId,
        item.role,
        item.userId,
        item.canView,
        item.canDownload,
        item.canEdit,
        item.canDelete,
        user.id
      )
      .run();
  }

  return json({
    success: true,
    message: "DOCUMENT_PERMISSIONS_UPDATED"
  });
}
