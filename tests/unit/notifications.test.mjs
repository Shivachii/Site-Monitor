import { describe, expect, it, vi } from "vitest";
import { sendNotification } from "../../worker/notifications.mjs";

const delivery = {
  channel_type: "email",
  destination: "ops@example.com",
  event_type: "outage",
  monitor_name: "Example site",
  failure_reason: "HTTP 503",
  started_at: "2026-10-14T12:00:00.000Z",
  resolved_at: null,
};

describe("worker notifications", () => {
  it("sends outage email through Resend", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 200 }));

    await sendNotification(
      delivery,
      { RESEND_API_KEY: "re_test", RESEND_FROM_EMAIL: "status@example.com" },
      fetchImpl,
    );

    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, request] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://api.resend.com/emails");
    expect(JSON.parse(request.body)).toMatchObject({
      to: ["ops@example.com"],
      subject: "Outage detected: Example site",
    });
  });

  it("sends recovery messages through Telegram", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 200 }));

    await sendNotification(
      {
        ...delivery,
        channel_type: "telegram",
        destination: "12345",
        event_type: "recovery",
        resolved_at: "2026-10-14T12:05:00.000Z",
      },
      { TELEGRAM_BOT_TOKEN: "test-token" },
      fetchImpl,
    );

    const [url, request] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://api.telegram.org/bottest-token/sendMessage");
    expect(JSON.parse(request.body)).toMatchObject({
      chat_id: "12345",
    });
  });

  it("fails clearly when provider credentials are missing", async () => {
    await expect(sendNotification(delivery, {}, vi.fn())).rejects.toThrow(
      "Resend credentials are not configured",
    );
  });
});
