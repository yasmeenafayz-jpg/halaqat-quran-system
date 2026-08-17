const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization"
    }
  });

const error = (message, status = 400) =>
  json({ success: false, error: message }, status);

async function readBody(request) {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Authorization"
        }
      });
    }

    const url = new URL(request.url);
    const path = url.pathname;

    try {
      // فحص حالة الـAPI
      if (path === "/api/health") {
        let database = "not_configured";

        if (env.DB) {
          try {
            await env.DB.prepare("SELECT 1").first();
            database = "connected";
          } catch {
            database = "error";
          }
        }

        return json({
          success: true,
          app: env.APP_NAME || "الأوَّابين",
          environment: env.APP_ENV || "production",
          database,
          time: new Date().toISOString()
        });
      }

      // إعدادات عامة
      if (path === "/api/settings" && request.method === "GET") {
        if (!env.DB) {
          return json({
            success: true,
            settings: {},
            message: "Database is not configured yet"
          });
        }

        const result = await env.DB
          .prepare(
            "SELECT key, value, is_secret, updated_at FROM app_settings ORDER BY key"
          )
          .all();

        return json({
          success: true,
          settings: result.results || []
        });
      }

      // الطلاب
      if (path === "/api/students" && request.method === "GET") {
        if (!env.DB) {
          return error("Database is not configured", 503);
        }

        const result = await env.DB
          .prepare(`
            SELECT
              id,
              student_number,
              name,
              phone,
              guardian_phone,
              teacher_id,
              companion_name,
              current_level_id,
              current_plan_type,
              current_portion,
              last_page,
              active,
              created_at,
              updated_at
            FROM students
            ORDER BY name
          `)
          .all();

        return json({
          success: true,
          students: result.results || []
        });
      }

      // طالب واحد
      const studentMatch = path.match(/^\/api\/students\/(\d+)$/);

      if (studentMatch && request.method === "GET") {
        if (!env.DB) {
          return error("Database is not configured", 503);
        }

        const id = Number(studentMatch[1]);

        const student = await env.DB
          .prepare(`
            SELECT *
            FROM students
            WHERE id = ?
          `)
          .bind(id)
          .first();

        if (!student) {
          return error("Student not found", 404);
        }

        return json({
          success: true,
          student
        });
      }

      // إنشاء طالب
      if (path === "/api/students" && request.method === "POST") {
        if (!env.DB) {
          return error("Database is not configured", 503);
        }

        const body = await readBody(request);

        if (!body.name || !String(body.name).trim()) {
          return error("Student name is required");
        }

        const result = await env.DB
          .prepare(`
            INSERT INTO students (
              name,
              phone,
              guardian_phone,
              companion_name,
              current_plan_type,
              current_portion
            )
            VALUES (?, ?, ?, ?, ?, ?)
          `)
          .bind(
            String(body.name).trim(),
            body.phone || null,
            body.guardian_phone || null,
            body.companion_name || null,
            body.current_plan_type || null,
            body.current_portion || null
          )
          .run();

        return json({
          success: true,
          id: result.meta?.last_row_id || null
        }, 201);
      }

      // الحلقات
      if (path === "/api/circles" && request.method === "GET") {
        if (!env.DB) {
          return error("Database is not configured", 503);
        }

        const result = await env.DB
          .prepare(`
            SELECT
              c.*,
              st.name AS session_type_name
            FROM circles c
            LEFT JOIN session_types st
              ON st.id = c.session_type_id
            ORDER BY c.name
          `)
          .all();

        return json({
          success: true,
          circles: result.results || []
        });
      }

      // جلسات اليوم
      if (path === "/api/sessions/today" && request.method === "GET") {
        if (!env.DB) {
          return error("Database is not configured", 503);
        }

        const result = await env.DB
          .prepare(`
            SELECT
              s.*,
              c.name AS circle_name
            FROM sessions s
            JOIN circles c
              ON c.id = s.circle_id
            WHERE s.session_date = date('now')
            ORDER BY s.start_time
          `)
          .all();

        return json({
          success: true,
          sessions: result.results || []
        });
      }

      return error("Route not found", 404);

    } catch (err) {
      return json({
        success: false,
        error: "Internal server error",
        message: err?.message || "Unknown error"
      }, 500);
    }
  }
};
