const notificationTimeoutMs = 15_000;

function notificationCopy(delivery) {
  const isOutage = delivery.event_type === "outage";
  const siteName = delivery.monitor_name ?? "Monitored site";
  const subject = isOutage
    ? `Outage detected: ${siteName}`
    : `Service recovered: ${siteName}`;
  const detail = isOutage
    ? delivery.failure_reason || "The latest HTTP check failed."
    : "The site is responding successfully again.";
  const text = `${subject}\n\n${detail}\n\nDetected: ${delivery.started_at ?? "unknown"}${delivery.resolved_at ? `\nResolved: ${delivery.resolved_at}` : ""}`;

  return { subject, text };
}

async function providerError(response) {
  const body = (await response.text()).slice(0, 300);
  return `${response.status} ${response.statusText}${body ? `: ${body}` : ""}`;
}

async function sendEmail(delivery, environment, fetchImpl) {
  const apiKey = environment.RESEND_API_KEY;
  const from = environment.RESEND_FROM_EMAIL;
  if (!apiKey || !from) {
    throw new Error("Resend credentials are not configured.");
  }

  const copy = notificationCopy(delivery);
  const response = await fetchImpl("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [delivery.destination],
      subject: copy.subject,
      text: copy.text,
    }),
    signal: AbortSignal.timeout(notificationTimeoutMs),
  });

  if (!response.ok) {
    throw new Error(
      `Resend rejected the notification: ${await providerError(response)}`,
    );
  }
}

async function sendTelegram(delivery, environment, fetchImpl) {
  const token = environment.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error("Telegram bot credentials are not configured.");

  const copy = notificationCopy(delivery);
  const response = await fetchImpl(
    `https://api.telegram.org/bot${token}/sendMessage`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: delivery.destination,
        text: copy.text,
        disable_web_page_preview: true,
      }),
      signal: AbortSignal.timeout(notificationTimeoutMs),
    },
  );

  if (!response.ok) {
    throw new Error(
      `Telegram rejected the notification: ${await providerError(response)}`,
    );
  }
}

export async function sendNotification(
  delivery,
  environment = process.env,
  fetchImpl = fetch,
) {
  if (delivery.channel_type === "email") {
    return sendEmail(delivery, environment, fetchImpl);
  }

  if (delivery.channel_type === "telegram") {
    return sendTelegram(delivery, environment, fetchImpl);
  }

  throw new Error(`Unsupported notification channel: ${delivery.channel_type}`);
}
