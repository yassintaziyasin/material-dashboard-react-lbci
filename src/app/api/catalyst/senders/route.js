import { NextResponse } from "next/server";
import {
  extractCatalystError,
  getValidAccessToken,
  getZohoUrls,
  isCatalystTokenError,
  isScopeMismatchError,
  parseSafeZohoJson,
} from "@/lib/zohoServer";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function isValidEmail(val) {
  const s = String(val || "").trim();
  return s.length > 3 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

export async function POST(request) {
  try {
    const body = await request.json();
    const profile = body.profile || {};
    const projectId = String(body.projectId || profile.projectId || "").trim();
    const orgId = String(body.orgId || "").trim();

    if (!projectId) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Enter or fetch a Catalyst Project ID first before fetching sender addresses.",
        },
        { status: 400 }
      );
    }

    const { accountsBase, catalystBase } = getZohoUrls(profile.dc);

    let { accessToken: token } = await getValidAccessToken({
      clientId: profile.clientId,
      clientSecret: profile.clientSecret,
      refreshToken: profile.refreshToken,
      dc: profile.dc,
      passedToken: body.accessToken || null,
    });

    let refreshedToken = null;
    let refreshedExpiresAt = null;

    const buildHeaders = (authTok) => {
      const h = { Authorization: `Zoho-oauthtoken ${authTok}` };
      if (orgId) h["CATALYST-ORG"] = orgId;
      return h;
    };

    const encodedPid = encodeURIComponent(projectId);

    // First probe project users or project details to detect expired access token
    let probeRes = await fetch(
      `${catalystBase}/baas/v1/project/${encodedPid}/project-user?start=1&end=50`,
      {
        method: "GET",
        headers: buildHeaders(token),
        cache: "no-store",
      }
    );
    let probeText = await probeRes.text();
    let probeData = parseSafeZohoJson(probeText, probeRes.status);

    if (
      isCatalystTokenError(probeRes.status, probeData) &&
      !isScopeMismatchError(probeData) &&
      profile.clientId &&
      profile.clientSecret &&
      profile.refreshToken
    ) {
      const refreshed = await getValidAccessToken({
        clientId: profile.clientId,
        clientSecret: profile.clientSecret,
        refreshToken: profile.refreshToken,
        dc: profile.dc,
        forceRefresh: true,
      });
      token = refreshed.accessToken;
      refreshedToken = refreshed.accessToken;
      refreshedExpiresAt = refreshed.expiresAt;

      probeRes = await fetch(
        `${catalystBase}/baas/v1/project/${encodedPid}/project-user?start=1&end=50`,
        {
          method: "GET",
          headers: buildHeaders(token),
          cache: "no-store",
        }
      );
      probeText = await probeRes.text();
      probeData = parseSafeZohoJson(probeText, probeRes.status);
    }

    const senderMap = new Map();
    const addCandidate = (email, name, source, verified = true) => {
      if (!isValidEmail(email)) return;
      const cleanEmail = String(email).trim();
      const key = cleanEmail.toLowerCase();
      if (!senderMap.has(key)) {
        senderMap.set(key, {
          email: cleanEmail,
          name: String(name || "").trim(),
          source,
          verified: Boolean(verified),
        });
      }
    };

    // Run additional discovery probes in parallel:
    // 1) Mail configuration endpoint (if exposed for this org/project)
    // 2) Specific Project metadata (created_by.email_id)
    // 3) Current authenticated Catalyst user (/project-user/current)
    // 4) Zoho IAM OAuth User Info (/oauth/user/info)
    const [mailConfigResult, projectDetailResult, currentUserResult, iamResult] =
      await Promise.allSettled([
        fetch(`${catalystBase}/baas/v1/project/${encodedPid}/email`, {
          method: "GET",
          headers: buildHeaders(token),
          cache: "no-store",
        }).then(async (r) => ({
          ok: r.ok,
          data: parseSafeZohoJson(await r.text(), r.status),
        })),
        fetch(`${catalystBase}/baas/v1/project/${encodedPid}`, {
          method: "GET",
          headers: buildHeaders(token),
          cache: "no-store",
        }).then(async (r) => ({
          ok: r.ok,
          status: r.status,
          data: parseSafeZohoJson(await r.text(), r.status),
        })),
        fetch(
          `${catalystBase}/baas/v1/project/${encodedPid}/project-user/current`,
          {
            method: "GET",
            headers: buildHeaders(token),
            cache: "no-store",
          }
        ).then(async (r) => ({
          ok: r.ok,
          data: parseSafeZohoJson(await r.text(), r.status),
        })),
        fetch(`${accountsBase}/oauth/user/info`, {
          method: "GET",
          headers: { Authorization: `Zoho-oauthtoken ${token}` },
          cache: "no-store",
        }).then(async (r) => ({
          ok: r.ok,
          data: parseSafeZohoJson(await r.text(), r.status),
        })),
      ]);

    // 1. Parse Mail configuration response if available
    if (
      mailConfigResult.status === "fulfilled" &&
      mailConfigResult.value.ok &&
      mailConfigResult.value.data?.status !== "failure"
    ) {
      const rawMail = mailConfigResult.value.data?.data ?? mailConfigResult.value.data;
      const list = Array.isArray(rawMail)
        ? rawMail
        : Array.isArray(rawMail?.senders)
        ? rawMail.senders
        : Array.isArray(rawMail?.email_details)
        ? rawMail.email_details
        : [];
      for (const entry of list) {
        const em =
          entry?.from_email ||
          entry?.email_id ||
          entry?.sender_email ||
          entry?.email;
        const nm =
          entry?.display_name || entry?.sender_name || entry?.user_name || "";
        const isVer =
          entry?.is_verified !== false && entry?.confirmation_status !== false;
        addCandidate(em, nm, "Catalyst Mail Sender", isVer);
      }
    }

    // 2. Parse Specific Project owner email
    let projectNotFoundError = null;
    if (projectDetailResult.status === "fulfilled") {
      const { ok, status, data } = projectDetailResult.value;
      if (ok && data?.status !== "failure") {
        const proj = data?.data || data;
        const owner = proj?.created_by;
        if (owner?.email_id) {
          const nm = [owner.first_name, owner.last_name]
            .filter(Boolean)
            .join(" ");
          addCandidate(owner.email_id, nm, "Project Owner");
        }
      } else if (status === 404 || status === 400) {
        if (!isScopeMismatchError(data)) {
          projectNotFoundError = extractCatalystError(data, null);
        }
      }
    }

    // 3. Parse Current Authenticated Catalyst User
    if (
      currentUserResult.status === "fulfilled" &&
      currentUserResult.value.ok &&
      currentUserResult.value.data?.status !== "failure"
    ) {
      const cur =
        currentUserResult.value.data?.data || currentUserResult.value.data;
      const em = cur?.email_id || cur?.user_details?.email_id;
      const nm = [
        cur?.first_name || cur?.user_details?.first_name,
        cur?.last_name || cur?.user_details?.last_name,
      ]
        .filter(Boolean)
        .join(" ");
      addCandidate(em, nm, "Project Current Admin");
    }

    // 4. Parse Project Users list (prioritize Admin / App Administrator accounts)
    if (probeRes.ok && probeData?.status !== "failure") {
      const users = Array.isArray(probeData?.data) ? probeData.data : [];
      for (const u of users) {
        const uType = String(u.user_type || "").toLowerCase();
        const roleName = String(u.role_details?.role_name || "").toLowerCase();
        const isAdmin =
          uType === "admin" ||
          roleName.includes("admin") ||
          roleName.includes("owner");
        if (isAdmin && u.email_id) {
          const nm = [u.first_name, u.last_name].filter(Boolean).join(" ");
          addCandidate(u.email_id, nm, "Project Admin");
        }
      }
    }

    // 5. Parse Zoho IAM OAuth User Info
    if (iamResult.status === "fulfilled" && iamResult.value.ok) {
      const iam = iamResult.value.data;
      if (iam?.Email) {
        addCandidate(
          iam.Email,
          iam.Display_Name ||
            [iam.First_Name, iam.Last_Name].filter(Boolean).join(" "),
          "Zoho Account Email"
        );
      }
    }

    const senders = Array.from(senderMap.values());

    if (senders.length === 0) {
      // Check if primary probe failed (e.g., invalid Project ID or scope error)
      if (!probeRes.ok || probeData?.status === "failure") {
        return NextResponse.json({
          success: false,
          error:
            projectNotFoundError ||
            extractCatalystError(
              probeData,
              `Could not fetch sender emails for Project ID ${projectId}.`
            ),
          newAccessToken: refreshedToken,
          newExpiresAt: refreshedExpiresAt,
        });
      }

      return NextResponse.json({
        success: false,
        error: `No admin/sender emails were returned by Catalyst for Project ID ${projectId}. Enter your verified sender address from Catalyst Console → Notify → Mail.`,
        newAccessToken: refreshedToken,
        newExpiresAt: refreshedExpiresAt,
      });
    }

    return NextResponse.json({
      success: true,
      senders,
      note: "Zoho Catalyst BaaS exposes project owner/admin account emails via API; custom domain aliases added under Notify → Mail can also be typed manually.",
      newAccessToken: refreshedToken,
      newExpiresAt: refreshedExpiresAt,
    });
  } catch (err) {
    return NextResponse.json(
      {
        success: false,
        error: err.message || "Unexpected server error fetching sender emails.",
      },
      { status: 500 }
    );
  }
}
