const VALID_DCS = ["com", "eu", "in", "com.au", "jp", "ca", "uk"];

const tokenCache =
  globalThis.__zcTokenCache || (globalThis.__zcTokenCache = new Map());

export function normalizeDc(dc) {
  const cleaned = String(dc || "com")
    .trim()
    .toLowerCase()
    .replace(/^\./, "");
  return VALID_DCS.includes(cleaned) ? cleaned : "com";
}

export function getZohoUrls(dc) {
  const normalized = normalizeDc(dc);
  return {
    dc: normalized,
    accountsBase: `https://accounts.zoho.${normalized}`,
    catalystBase: `https://api.catalyst.zoho.${normalized}`,
  };
}

export function detectDcFromAccountsServer(accountsServer) {
  if (!accountsServer) return null;
  try {
    const parsed = new URL(accountsServer);
    const match = parsed.hostname.match(/^accounts\.zoho\.(.+)$/i);
    if (match && VALID_DCS.includes(match[1].toLowerCase())) {
      return match[1].toLowerCase();
    }
  } catch {
    // ignore malformed URL
  }
  return null;
}

export function resolveRequestOrigin(request) {
  const forwardedHost = request.headers.get("x-forwarded-host");
  const host = forwardedHost || request.headers.get("host");
  const forwardedProto = request.headers.get("x-forwarded-proto");

  if (host) {
    const cleanHost = host.split(",")[0].trim();
    const isLocal =
      cleanHost.startsWith("localhost") || cleanHost.startsWith("127.0.0.1");
    const proto = forwardedProto
      ? forwardedProto.split(",")[0].trim()
      : isLocal
      ? "http"
      : "https";
    return `${proto}://${cleanHost}`;
  }

  return new URL(request.url).origin;
}

export function parseSafeZohoJson(rawText, status = 200) {
  if (!rawText || !rawText.trim()) {
    return status >= 200 && status < 300 ? { status: "success" } : {};
  }
  // Preserve 64-bit Zoho integer IDs as strings before JSON.parse
  const safeText = rawText.replace(
    /"(id|project_id|project_domain_id|user_id|zuid|zaaid|org_id|role_id|ROWID|CREATORID)":\s*(\d{15,})/g,
    '"$1": "$2"'
  );
  try {
    return JSON.parse(safeText);
  } catch {
    return {
      status: "failure",
      message: `Invalid JSON response from upstream (HTTP ${status})`,
      rawSnippet: rawText.slice(0, 500),
    };
  }
}

export function isCatalystTokenError(httpStatus, data) {
  if (httpStatus === 401) return true;
  if (data?.error?.code === 7213) return true;
  const errCode = String(
    data?.data?.error_code || data?.error_code || data?.code || ""
  ).toUpperCase();
  if (
    errCode === "INVALID_OAUTHTOKEN" ||
    errCode === "OAUTH_SCOPE_MISMATCH"
  ) {
    return errCode === "INVALID_OAUTHTOKEN";
  }
  if (errCode === "AUTHENTICATION_FAILURE") {
    const msg = String(
      data?.data?.message || data?.message || ""
    ).toLowerCase();
    if (msg.includes("token") || msg.includes("expired") || msg.includes("oauth")) {
      return true;
    }
  }
  return false;
}

export function isScopeMismatchError(data) {
  const errCode = String(
    data?.data?.error_code || data?.error_code || data?.code || ""
  ).toUpperCase();
  if (errCode === "OAUTH_SCOPE_MISMATCH") return true;
  const msg = String(
    data?.data?.message || data?.message || data?.error?.message || ""
  ).toLowerCase();
  return msg.includes("oauth_scope_mismatch") || msg.includes("scope mismatch");
}

export function extractCatalystError(data, fallback = "Catalyst API request failed.") {
  if (!data) return fallback;
  if (isScopeMismatchError(data)) {
    return "OAuth token is missing required scope permissions (OAUTH_SCOPE_MISMATCH). Click 'Generate Token' in Profile Settings to re-authorize with updated scopes.";
  }
  if (typeof data.message === "string" && data.message.trim()) return data.message;
  if (typeof data?.data?.message === "string" && data.data.message.trim()) {
    return data.data.message;
  }
  if (typeof data?.error?.message === "string" && data.error.message.trim()) {
    return data.error.message;
  }
  if (typeof data?.error === "string" && data.error.trim()) {
    return data.error;
  }
  if (Array.isArray(data?.data) && data.data[0]?.message) {
    return data.data[0].message;
  }
  return fallback;
}

export async function getValidAccessToken({
  clientId,
  clientSecret,
  refreshToken,
  dc = "com",
  passedToken = null,
  forceRefresh = false,
}) {
  if (!forceRefresh && passedToken) {
    return { accessToken: passedToken, expiresAt: null, refreshed: false };
  }

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error(
      "Missing OAuth credentials (Client ID, Client Secret, or Refresh Token)."
    );
  }

  const { dc: normalizedDc, accountsBase } = getZohoUrls(dc);
  const cacheKey = `${normalizedDc}:${clientId}:${refreshToken.slice(-16)}`;
  const now = Date.now();

  if (!forceRefresh && tokenCache.has(cacheKey)) {
    const cached = tokenCache.get(cacheKey);
    if (cached.expiresAt > now) {
      return {
        accessToken: cached.accessToken,
        expiresAt: cached.expiresAt,
        refreshed: false,
      };
    }
  }

  const params = new URLSearchParams({
    refresh_token: refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "refresh_token",
  });

  const oauthRes = await fetch(`${accountsBase}/oauth/v2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params,
    cache: "no-store",
  });

  const raw = await oauthRes.text();
  const oauthData = parseSafeZohoJson(raw, oauthRes.status);

  if (oauthData.error || !oauthData.access_token) {
    const reason =
      oauthData.error_description ||
      oauthData.error ||
      `Failed to refresh Zoho token (HTTP ${oauthRes.status})`;
    throw new Error(`Zoho OAuth Error: ${reason}`);
  }

  const accessToken = oauthData.access_token;
  const expiresInSec = Number(oauthData.expires_in) || 3600;
  const expiresAt = now + Math.max(60, expiresInSec - 120) * 1000;

  if (tokenCache.size > 200) {
    const oldestKey = tokenCache.keys().next().value;
    if (oldestKey) tokenCache.delete(oldestKey);
  }
  tokenCache.set(cacheKey, { accessToken, expiresAt });

  return { accessToken, expiresAt, refreshed: true };
}
