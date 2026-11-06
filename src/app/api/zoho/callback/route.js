import { NextResponse } from "next/server";
import {
  detectDcFromAccountsServer,
  getZohoUrls,
  parseSafeZohoJson,
  resolveRequestOrigin,
} from "@/lib/zohoServer";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function buildCallbackHtml({ success, title, subtitle, state, refreshToken, detectedDc, errorDetail }) {
  const payloadJson = JSON.stringify({
    type: "ZOHO_OAUTH_RESULT",
    success,
    state: state || "",
    refreshToken: refreshToken || "",
    detectedDc: detectedDc || "",
    error: errorDetail || "",
    ts: Date.now(),
  }).replace(/</g, "\\u003c");

  const safeTitle = String(title || "").replace(/[<>&"]/g, "");
  const safeSub = String(subtitle || "").replace(/[<>&"]/g, "");
  const safeToken = String(refreshToken || "").replace(/[<>&"]/g, "");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${safeTitle}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: #09090b;
      color: #f4f4f5;
      font-family: -apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", sans-serif;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
    }
    .card {
      width: 100%;
      max-width: 440px;
      background: #111114;
      border: 1px solid ${success ? "rgba(16, 185, 129, 0.35)" : "rgba(244, 63, 94, 0.35)"};
      border-radius: 10px;
      padding: 28px;
      box-shadow: 0 24px 48px rgba(0, 0, 0, 0.6);
    }
    .badge {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      font-size: 11px;
      font-weight: 600;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      padding: 4px 10px;
      border-radius: 999px;
      background: ${success ? "rgba(16, 185, 129, 0.12)" : "rgba(244, 63, 94, 0.12)"};
      color: ${success ? "#34d399" : "#fb7185"};
      margin-bottom: 16px;
    }
    h1 { font-size: 18px; font-weight: 600; margin-bottom: 8px; color: #fafafa; }
    p { font-size: 13px; line-height: 1.5; color: #a1a1aa; }
    .token-box {
      margin-top: 16px;
      padding: 10px 12px;
      background: #09090b;
      border: 1px solid #27272a;
      border-radius: 6px;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 11px;
      color: #d4d4d8;
      word-break: break-all;
    }
    .actions {
      margin-top: 16px;
      display: flex;
      gap: 8px;
    }
    button {
      cursor: pointer;
      border: 1px solid #27272a;
      background: #18181b;
      color: #e4e4e7;
      font-size: 12px;
      font-weight: 500;
      padding: 8px 14px;
      border-radius: 6px;
    }
    button:hover { background: #27272a; }
  </style>
</head>
<body>
  <div class="card">
    <div class="badge">${success ? "● OAuth Authorized" : "● Authorization Failed"}</div>
    <h1>${safeTitle}</h1>
    <p>${safeSub}</p>
    ${
      success && safeToken
        ? `<div class="token-box" id="tok">${safeToken}</div>
           <div class="actions">
             <button onclick="navigator.clipboard.writeText('${safeToken}'); this.textContent='Copied!';">Copy Token</button>
             <button onclick="window.close()">Close Window</button>
           </div>`
        : `<div class="actions"><button onclick="window.close()">Close Window</button></div>`
    }
  </div>
  <script>
    (function() {
      var payload = ${payloadJson};
      try {
        if (payload.state) {
          localStorage.setItem("zc_oauth_result_" + payload.state, JSON.stringify(payload));
        }
      } catch (e) {}
      try {
        if (typeof BroadcastChannel !== "undefined") {
          var bc = new BroadcastChannel("zc_oauth_channel");
          bc.postMessage(payload);
          setTimeout(function() { bc.close(); }, 500);
        }
      } catch (e) {}
      try {
        if (window.opener && !window.opener.closed) {
          window.opener.postMessage(payload, window.location.origin);
        }
      } catch (e) {}
      if (payload.success) {
        setTimeout(function() { window.close(); }, 950);
      }
    })();
  </script>
</body>
</html>`;
}

export async function GET(request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state") || "";
  const errorParam = url.searchParams.get("error");
  const accountsServerParam = url.searchParams.get("accounts-server");

  const cookieName = state ? `zc_oauth_${state.slice(0, 8)}` : "";
  const rawCookie = cookieName ? request.cookies.get(cookieName)?.value : null;

  const respondHtml = (opts, status = 200) => {
    const res = new NextResponse(buildCallbackHtml(opts), {
      status,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
    if (cookieName) {
      res.cookies.delete(cookieName);
    }
    return res;
  };

  if (errorParam) {
    return respondHtml(
      {
        success: false,
        title: "Zoho Authorization Declined",
        subtitle: `Zoho returned error: ${errorParam}`,
        state,
        errorDetail: errorParam,
      },
      400
    );
  }

  if (!code || !rawCookie) {
    return respondHtml(
      {
        success: false,
        title: "Invalid or Expired Session",
        subtitle:
          "OAuth session cookie was not found or expired. Please close this window and click Generate Token again.",
        state,
        errorDetail: "Invalid or expired OAuth state session.",
      },
      400
    );
  }

  let authSession;
  try {
    authSession = JSON.parse(
      Buffer.from(rawCookie, "base64url").toString("utf8")
    );
  } catch {
    return respondHtml(
      {
        success: false,
        title: "Corrupted OAuth Session",
        subtitle: "Could not decode OAuth session parameters.",
        state,
        errorDetail: "Corrupted OAuth session.",
      },
      400
    );
  }

  if (authSession.state !== state) {
    return respondHtml(
      {
        success: false,
        title: "State Mismatch",
        subtitle: "OAuth state verification failed. Please retry.",
        state,
        errorDetail: "State mismatch.",
      },
      400
    );
  }

  try {
    const detectedDc =
      detectDcFromAccountsServer(accountsServerParam) || authSession.dc || "com";
    const { accountsBase } = getZohoUrls(detectedDc);
    const redirectUri =
      authSession.redirectUri ||
      `${resolveRequestOrigin(request)}/api/zoho/callback`;

    const tokenParams = new URLSearchParams({
      code,
      client_id: authSession.clientId,
      client_secret: authSession.clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    });

    const tokenRes = await fetch(`${accountsBase}/oauth/v2/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: tokenParams,
      cache: "no-store",
    });

    const rawText = await tokenRes.text();
    const tokenData = parseSafeZohoJson(rawText, tokenRes.status);

    if (!tokenData.refresh_token) {
      const reason =
        tokenData.error_description ||
        tokenData.error ||
        "No refresh_token returned by Zoho. Ensure prompt=consent and Redirect URI match your Zoho Self/Server Client.";
      return respondHtml(
        {
          success: false,
          title: "Token Exchange Failed",
          subtitle: reason,
          state,
          errorDetail: reason,
        },
        500
      );
    }

    return respondHtml({
      success: true,
      title: "Refresh Token Captured",
      subtitle:
        "Credentials synced with the console. This window will close automatically...",
      state,
      refreshToken: tokenData.refresh_token,
      detectedDc,
    });
  } catch (err) {
    return respondHtml(
      {
        success: false,
        title: "Token Exchange Error",
        subtitle: err.message || "Unexpected network error talking to Zoho.",
        state,
        errorDetail: err.message,
      },
      500
    );
  }
}
