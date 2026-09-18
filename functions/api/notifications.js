import {
  requireAuth,
  requirePermission,
  writeAudit
} from "./_auth.js";

import {
  listNotifications,
  notificationUnreadCount,
  markNotificationRead,
  markAllNotificationsRead,
  createNotification
} from "./_notifications.js";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8"
    }
  });
}

export async function onRequestGet({
  request,
  env
}) {
  const auth = await requirePermission(
    request,
    env,
    "notifications.read"
  );

  if (!auth.ok) {
    return auth.response;
  }

  try {
    const url = new URL(request.url);

    const unreadOnly =
      url.searchParams.get("unread") === "1";

    const limit =
      Number(url.searchParams.get("limit") || 50);

    const notifications =
      await listNotifications(
        env.DB,
        auth.user,
        {
          limit,
          unreadOnly
        }
      );

    const unreadCount =
      await notificationUnreadCount(
        env.DB,
        auth.user
      );

    return json({
      success: true,
      notifications,
      unread_count: unreadCount
    });
  } catch (error) {
    console.error("notifications GET:", error);

    return json({
      success: false,
      error: "NOTIFICATIONS_LOAD_FAILED"
    }, 500);
  }
}

export async function onRequestPost({
  request,
  env
}) {
  const auth = await requirePermission(
    request,
    env,
    "notifications.write"
  );

  if (!auth.ok) {
    return auth.response;
  }

  try {
    const body = await request.json();

    const result =
      await createNotification(
        env.DB,
        body || {}
      );

    await writeAudit(
      env.DB,
      auth.user.id,
      result.created
        ? "notification.created"
        : "notification.duplicate",
      "notification",
      result.notification?.id || null,
      {
        type: body?.type || null,
        source_type: body?.sourceType || null,
        source_id: body?.sourceId || null
      },
      request
    );

    return json({
      success: true,
      ...result
    }, result.created ? 201 : 200);
  } catch (error) {
    console.error("notifications POST:", error);

    return json({
      success: false,
      error: error?.message || "NOTIFICATION_CREATE_FAILED"
    }, 400);
  }
}

export async function onRequestPatch({
  request,
  env
}) {
  const auth = await requirePermission(
    request,
    env,
    "notifications.read"
  );

  if (!auth.ok) {
    return auth.response;
  }

  try {
    const body = await request.json();

    if (
      body?.action === "mark_all_read"
    ) {
      const result =
        await markAllNotificationsRead(
          env.DB,
          auth.user
        );

      await writeAudit(
        env.DB,
        auth.user.id,
        "notifications.mark_all_read",
        "notification",
        null,
        {},
        request
      );

      return json({
        success: true,
        ...result,
        unread_count: 0
      });
    }

    const notificationId =
      Number(body?.id);

    if (!Number.isFinite(notificationId)) {
      return json({
        success: false,
        error: "INVALID_NOTIFICATION_ID"
      }, 400);
    }

    const result =
      await markNotificationRead(
        env.DB,
        auth.user,
        notificationId
      );

    if (!result.ok) {
      return json({
        success: false,
        error: result.error
      }, result.status);
    }

    const unreadCount =
      await notificationUnreadCount(
        env.DB,
        auth.user
      );

    await writeAudit(
      env.DB,
      auth.user.id,
      "notification.read",
      "notification",
      notificationId,
      {},
      request
    );

    return json({
      success: true,
      unread_count: unreadCount
    });
  } catch (error) {
    console.error("notifications PATCH:", error);

    return json({
      success: false,
      error: "NOTIFICATION_UPDATE_FAILED"
    }, 500);
  }
}
