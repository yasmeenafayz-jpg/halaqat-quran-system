import { onRequestPost } from "../functions/api/schedule-generate-cron.js";

export default {
  async scheduled(controller, env, ctx) {
    const request = new Request("https://internal.alawabin/schedule-generate-cron", {
      method: "POST",
      headers: {
        "X-Alawabin-Cron": String(env.SCHEDULE_CRON_SECRET ?? "")
      }
    });

    const response = await onRequestPost({
      request,
      env,
      params: {},
      next: () => new Response(null, { status: 404 })
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(
        `SCHEDULE_CRON_FAILED:${response.status}:${body.slice(0, 500)}`
      );
    }

    return response;
  }
};
