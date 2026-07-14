export function json(payload, status = 200) {
  if (payload instanceof ClientError || payload instanceof UpstreamError) {
    status = payload.status;
    payload = { success: false, error: payload.message };
  }

  let body = JSON.stringify(payload);
  if (body.length > 80_000) {
    status = 502;
    body = JSON.stringify({
      success: false,
      error: "The filtered result was still too large. Request a narrower profile section.",
    });
  }

  return new Response(body, {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

export function privacyPolicy() {
  const contact = "Discord: gs._";
  const html = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>SkyBlock GPT Proxy Privacy Policy</title></head>
<body style="max-width:760px;margin:40px auto;padding:0 20px;font:16px/1.55 system-ui,sans-serif;color:#202124">
<h1>SkyBlock GPT Proxy Privacy Policy</h1>
<p><strong>Last updated:</strong> July 13, 2026</p>
<p>This unofficial service helps a Custom GPT retrieve compact Hypixel SkyBlock profile, inventory, resource, Bazaar, auction, and event data.</p>
<h2>Data processed</h2>
<p>The service processes Minecraft UUIDs, optional SkyBlock profile identifiers, item or product IDs, and the public or API-enabled data needed to answer the request.</p>
<h2>Use and retention</h2>
<p>Data is used only to complete requested lookups. The Worker does not intentionally maintain a user database or persist player-profile responses. Static resources and non-player public market responses may be cached briefly to reduce upstream requests. Infrastructure providers may process ordinary security and operational logs under their own policies.</p>
<h2>Third parties</h2>
<p>Requests are processed through Cloudflare and the Hypixel Public API. This service is unofficial and is not affiliated with or endorsed by Hypixel.</p>
<h2>Secrets</h2>
<p>The creator's Hypixel API key and proxy authentication secret are server-side secrets and are not included in responses.</p>
<h2>Contact</h2><p>${contact}</p>
</body></html>`;

  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
}

export class ClientError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

export class UpstreamError extends Error {
  constructor(message, status = 502) {
    super(message);
    this.status = status >= 400 && status <= 599 ? status : 502;
  }
}
