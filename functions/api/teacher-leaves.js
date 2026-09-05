import {
  json,
  requirePermission,
  writeAudit,
} from "./_auth.js";

const LEAVE_TYPES = [
  "annual",
  "sick",
  "personal",
  "emergency",
  "academic",
  "other",
];

const STATUSES = [
  "pending",
  "approved",
  "rejected",
  "cancelled",
];

function clean(value) {
  if (value === undefined || value === null) {
    return "";
  }

  return String(value).trim();
}

function validDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(clean(value));
}

function validLeaveType(value) {
  return LEAVE_TYPES.includes(clean(value));
}

function validStatus(value) {
  return STATUSES.includes(clean(value));
}

function isPrivileged(user) {
  return (
    user?.role === "admin" ||
    user?.role === "supervisor"
  );
}

function canAccessTeacher(user, teacherId) {
  if (isPrivileged(user)) {
    return true;
  }

  return (
    user?.role === "teacher" &&
    Number(user?.teacher_id) === Number(teacherId)
  );
}

async function getLeave(db, id) {
  return db
    .prepare(`
      SELECT
        tlr.*,
        t.full_name AS teacher_name
      FROM teacher_leave_requests tlr
      LEFT JOIN teachers t
        ON t.id = tlr.teacher_id
      WHERE tlr.id = ?
      LIMIT 1
    `)
    .bind(id)
    .first();
}

export async function onRequestGet(context) {
  const { env, request } = context;

  const auth = await requirePermission(
    request,
    env,
    "schedule.leave.read"
  );

  if (!auth.ok) {
    return auth.response;
  }

  try {
    const url = new URL(request.url);

    const id = Number(
      url.searchParams.get("id") || 0
    );

    const requestedTeacherId = Number(
      url.searchParams.get("teacher_id") || 0
    );

    const status = clean(
      url.searchParams.get("status")
    );

    if (status && !validStatus(status)) {
      return json(
        {
          success: false,
          error: "INVALID_LEAVE_STATUS",
        },
        400
      );
    }

    if (id > 0) {
      const leave = await getLeave(env.DB, id);

      if (!leave) {
        return json(
          {
            success: false,
            error: "LEAVE_NOT_FOUND",
          },
          404
        );
      }

      if (
        !canAccessTeacher(
          auth.user,
          leave.teacher_id
        )
      ) {
        return json(
          {
            success: false,
            error: "FORBIDDEN",
          },
          403
        );
      }

      return json({
        success: true,
        data: leave,
      });
    }

    let sql = `
      SELECT
        tlr.*,
        t.full_name AS teacher_name
      FROM teacher_leave_requests tlr
      LEFT JOIN teachers t
        ON t.id = tlr.teacher_id
      WHERE 1 = 1
    `;

    const params = [];

    if (
      auth.user?.role === "teacher" &&
      auth.user?.teacher_id
    ) {
      sql += ` AND tlr.teacher_id = ?`;
      params.push(
        Number(auth.user.teacher_id)
      );
    } else if (requestedTeacherId > 0) {
      sql += ` AND tlr.teacher_id = ?`;
      params.push(requestedTeacherId);
    }

    if (status) {
      sql += ` AND tlr.status = ?`;
      params.push(status);
    }

    sql += `
      ORDER BY
        tlr.start_date DESC,
        tlr.id DESC
      LIMIT 500
    `;

    const result = await env.DB
      .prepare(sql)
      .bind(...params)
      .all();

    return json({
      success: true,
      data: result.results || [],
    });
  } catch (error) {
    console.error(
      "TEACHER_LEAVES_GET_FAILED",
      error
    );

    return json(
      {
        success: false,
        error: "TEACHER_LEAVES_GET_FAILED",
      },
      500
    );
  }
}

export async function onRequestPost(context) {
  const { env, request } = context;

  const auth = await requirePermission(
    request,
    env,
    "schedule.leave.write"
  );

  if (!auth.ok) {
    return auth.response;
  }

  try {
    const data = await request.json();

    let teacherId = Number(
      data.teacher_id ??
      data.teacherId ??
      0
    );

    if (
      auth.user?.role === "teacher" &&
      auth.user?.teacher_id
    ) {
      teacherId = Number(
        auth.user.teacher_id
      );
    }

    const leaveType = clean(
      data.leave_type ??
      data.leaveType ??
      "personal"
    );

    const startDate = clean(
      data.start_date ??
      data.startDate
    );

    const endDate = clean(
      data.end_date ??
      data.endDate
    );

    const reason =
      clean(data.reason) || null;

    if (
      !Number.isInteger(teacherId) ||
      teacherId <= 0
    ) {
      return json(
        {
          success: false,
          error: "INVALID_TEACHER_ID",
        },
        400
      );
    }

    if (
      !canAccessTeacher(
        auth.user,
        teacherId
      )
    ) {
      return json(
        {
          success: false,
          error: "FORBIDDEN",
        },
        403
      );
    }

    if (!validLeaveType(leaveType)) {
      return json(
        {
          success: false,
          error: "INVALID_LEAVE_TYPE",
        },
        400
      );
    }

    if (
      !validDate(startDate) ||
      !validDate(endDate) ||
      endDate < startDate
    ) {
      return json(
        {
          success: false,
          error: "INVALID_LEAVE_DATES",
        },
        400
      );
    }

    const teacher = await env.DB
      .prepare(`
        SELECT
          id,
          full_name,
          status
        FROM teachers
        WHERE id = ?
        LIMIT 1
      `)
      .bind(teacherId)
      .first();

    if (!teacher) {
      return json(
        {
          success: false,
          error: "TEACHER_NOT_FOUND",
        },
        404
      );
    }

    const result = await env.DB
      .prepare(`
        INSERT INTO teacher_leave_requests (
          teacher_id,
          leave_type,
          start_date,
          end_date,
          reason,
          status,
          created_at,
          updated_at
        )
        VALUES (
          ?,
          ?,
          ?,
          ?,
          ?,
          'pending',
          CURRENT_TIMESTAMP,
          CURRENT_TIMESTAMP
        )
      `)
      .bind(
        teacherId,
        leaveType,
        startDate,
        endDate,
        reason
      )
      .run();

    const leaveId =
      result.meta?.last_row_id ?? null;

    try {
      await writeAudit(
        env.DB,
        {
          userId: auth.user.id,
          action: "teacher_leave.create",
          entityType: "teacher_leave_request",
          entityId: leaveId,
          details: {
            teacher_id: teacherId,
            leave_type: leaveType,
            start_date: startDate,
            end_date: endDate,
          },
          request,
        }
      );
    } catch (auditError) {
      console.error(
        "TEACHER_LEAVE_AUDIT_FAILED",
        auditError
      );
    }

    const leave = leaveId
      ? await getLeave(env.DB, leaveId)
      : null;

    return json(
      {
        success: true,
        data: leave,
      },
      201
    );
  } catch (error) {
    console.error(
      "TEACHER_LEAVE_CREATE_FAILED",
      error
    );

    return json(
      {
        success: false,
        error: "TEACHER_LEAVE_CREATE_FAILED",
      },
      500
    );
  }
}

export async function onRequestPatch(context) {
  const { env, request } = context;

  const auth = await requirePermission(
    request,
    env,
    "schedule.leave.write"
  );

  if (!auth.ok) {
    return auth.response;
  }

  try {
    const data = await request.json();

    const id = Number(
      data.id ??
      data.leave_id ??
      data.leaveId ??
      0
    );

    if (
      !Number.isInteger(id) ||
      id <= 0
    ) {
      return json(
        {
          success: false,
          error: "INVALID_LEAVE_ID",
        },
        400
      );
    }

    const current =
      await getLeave(env.DB, id);

    if (!current) {
      return json(
        {
          success: false,
          error: "LEAVE_NOT_FOUND",
        },
        404
      );
    }

    if (
      !canAccessTeacher(
        auth.user,
        current.teacher_id
      )
    ) {
      return json(
        {
          success: false,
          error: "FORBIDDEN",
        },
        403
      );
    }

    const requestedStatus =
      clean(
        data.status
      );

    const nextLeaveType =
      clean(
        data.leave_type ??
        data.leaveType ??
        current.leave_type
      );

    const nextStartDate =
      clean(
        data.start_date ??
        data.startDate ??
        current.start_date
      );

    const nextEndDate =
      clean(
        data.end_date ??
        data.endDate ??
        current.end_date
      );

    const nextReason =
      data.reason !== undefined
        ? clean(data.reason) || null
        : current.reason;

    /*
     * Approval/rejection/cancellation is
     * restricted to admin/supervisor.
     */
    if (requestedStatus) {
      if (!validStatus(requestedStatus)) {
        return json(
          {
            success: false,
            error: "INVALID_LEAVE_STATUS",
          },
          400
        );
      }

      if (!isPrivileged(auth.user)) {
        return json(
          {
            success: false,
            error: "ONLY_ADMIN_OR_SUPERVISOR_CAN_REVIEW",
          },
          403
        );
      }
    }

    if (!validLeaveType(nextLeaveType)) {
      return json(
        {
          success: false,
          error: "INVALID_LEAVE_TYPE",
        },
        400
      );
    }

    if (
      !validDate(nextStartDate) ||
      !validDate(nextEndDate) ||
      nextEndDate < nextStartDate
    ) {
      return json(
        {
          success: false,
          error: "INVALID_LEAVE_DATES",
        },
        400
      );
    }

    /*
     * Teachers can modify their own request,
     * but cannot modify an already reviewed request
     * unless it is cancelled.
     */
    if (
      !isPrivileged(auth.user) &&
      (
        current.status === "approved" ||
        current.status === "rejected"
      )
    ) {
      return json(
        {
          success: false,
          error: "LEAVE_ALREADY_REVIEWED",
        },
        409
      );
    }

    let nextStatus =
      requestedStatus ||
      current.status;

    let reviewedBy =
      current.reviewed_by;

    let reviewedAt =
      current.reviewed_at;

    if (
      requestedStatus &&
      isPrivileged(auth.user)
    ) {
      reviewedBy = auth.user.id;
      reviewedAt =
        new Date().toISOString();
    }

    if (
      !requestedStatus &&
      !isPrivileged(auth.user)
    ) {
      nextStatus = "pending";
      reviewedBy = null;
      reviewedAt = null;
    }

    await env.DB
      .prepare(`
        UPDATE teacher_leave_requests
        SET
          leave_type = ?,
          start_date = ?,
          end_date = ?,
          reason = ?,
          status = ?,
          reviewed_by = ?,
          reviewed_at = ?,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `)
      .bind(
        nextLeaveType,
        nextStartDate,
        nextEndDate,
        nextReason,
        nextStatus,
        reviewedBy,
        reviewedAt,
        id
      )
      .run();

    try {
      await writeAudit(
        env.DB,
        {
          userId: auth.user.id,
          action: requestedStatus
            ? `teacher_leave.${requestedStatus}`
            : "teacher_leave.update",
          entityType:
            "teacher_leave_request",
          entityId: id,
          details: {
            before: {
              status: current.status,
              leave_type: current.leave_type,
              start_date: current.start_date,
              end_date: current.end_date,
            },
            after: {
              status: nextStatus,
              leave_type: nextLeaveType,
              start_date: nextStartDate,
              end_date: nextEndDate,
            },
          },
          request,
        }
      );
    } catch (auditError) {
      console.error(
        "TEACHER_LEAVE_AUDIT_FAILED",
        auditError
      );
    }

    const leave =
      await getLeave(env.DB, id);

    return json({
      success: true,
      data: leave,
    });
  } catch (error) {
    console.error(
      "TEACHER_LEAVE_UPDATE_FAILED",
      error
    );

    return json(
      {
        success: false,
        error: "TEACHER_LEAVE_UPDATE_FAILED",
      },
      500
    );
  }
}
