import {
  audit,
  canUseSeries,
  loadExceptions,
  loadSeries,
  generateSeries
} from "./schedule-generate.js";

const WINDOW_DAYS = 60;
const MAX_GENERATION_DAYS = 366;

function clean(value) {
  return String(value ?? "").trim();
}

function addDays(dateString, days) {
  const date = new Date(`${dateString}T00:00:00Z`);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  date.setUTCDate(
    date.getUTCDate() + Number(days)
  );

  return date.toISOString().slice(0, 10);
}

function cairoToday() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Africa/Cairo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());

  const values = Object.fromEntries(
    parts
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value])
  );

  return `${values.year}-${values.month}-${values.day}`;
}

function json(data, status = 200) {
  return new Response(
    JSON.stringify(data),
    {
      status,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store"
      }
    }
  );
}

function authorized(request, env) {
  const configured =
    clean(env.SCHEDULE_CRON_SECRET);

  const supplied =
    request.headers.get(
      "X-Alawabin-Cron"
    ) || "";

  if (
    !configured ||
    !supplied ||
    supplied.length !== configured.length
  ) {
    return false;
  }

  let mismatch = 0;

  for (
    let index = 0;
    index < configured.length;
    index++
  ) {
    mismatch |=
      supplied.charCodeAt(index) ^
      configured.charCodeAt(index);
  }

  return mismatch === 0;
}

export async function onRequestPost({
  request,
  env
}) {
  if (!authorized(request, env)) {
    return json(
      {
        success: false,
        error: "UNAUTHORIZED"
      },
      401
    );
  }

  if (!env.DB) {
    return json(
      {
        success: false,
        error: "DB_NOT_CONFIGURED"
      },
      500
    );
  }

  try {
    const today = cairoToday();

    const rangeStart = today;

    const rangeEnd =
      addDays(
        rangeStart,
        WINDOW_DAYS
      );

    if (!rangeEnd) {
      throw new Error(
        "تعذر حساب نافذة التوليد."
      );
    }

    const systemUser = {
      role: "admin",
      id: null
    };

    const series =
      await loadSeries(
        env.DB,
        systemUser,
        null
      );

    const seriesIds =
      series.map(
        (item) =>
          Number(item.id)
      );

    const exceptions =
      await loadExceptions(
        env.DB,
        seriesIds
      );

    const totals = {
      series: series.length,
      created: 0,
      skipped: 0,
      cancelled: 0
    };

    const details = [];

    for (const item of series) {
      if (
        !(await canUseSeries(
          env.DB,
          systemUser,
          item
        ))
      ) {
        continue;
      }

      const itemExceptions =
        exceptions.filter(
          (exception) =>
            Number(
              exception.series_id
            ) === Number(item.id)
        );

      const result =
        await generateSeries(
          env.DB,
          item,
          itemExceptions,
          rangeStart,
          rangeEnd
        );

      totals.created +=
        result.created.length;

      totals.skipped +=
        result.skipped.length;

      totals.cancelled +=
        result.cancelled.length;

      details.push({
        series_id: item.id,
        title: item.title,
        created: result.created.length,
        skipped: result.skipped.length,
        cancelled: result.cancelled.length
      });

      await audit(
        env.DB,
        null,
        "schedule.generate.cron",
        item.id,
        {
          range_start: rangeStart,
          range_end: rangeEnd,
          created:
            result.created.length,
          skipped:
            result.skipped.length,
          cancelled:
            result.cancelled.length
        }
      );
    }

    return json({
      success: true,
      automated: true,
      timezone: "Africa/Cairo",
      range: {
        start_date: rangeStart,
        end_date: rangeEnd
      },
      totals,
      details
    });
  } catch (error) {
    return json(
      {
        success: false,
        error: "SERVER_ERROR",
        message:
          error.message ||
          "تعذر التوليد الآلي للجلسات."
      },
      500
    );
  }
}
