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

function normalizeProjectItem(raw, orgMeta = null) {
  if (!raw || typeof raw !== "object") return null;
  const id = String(raw.id || raw.project_id || "").trim();
  if (!id) return null;

  const name = String(
    raw.project_name || raw.name || `Project ${id}`
  ).trim();
  const type = String(raw.project_type || raw.status || "Live").trim();
  const domain = String(
    raw.project_domain_details?.project_domain_name ||
      raw.domain_name ||
      ""
  ).trim();
  const createdTime = String(raw.created_time || "").trim();
  const createdByEmail = String(raw.created_by?.email_id || "").trim();
  const createdByName = [
    raw.created_by?.first_name,
    raw.created_by?.last_name,
  ]
    .filter(Boolean)
    .join(" ")
    .trim();

  return {
    id,
    name,
    type,
    domain,
    createdTime,
    createdByEmail,
    createdByName,
    orgId: String(orgMeta?.orgId || raw.org_id || "").trim(),
    orgName: String(orgMeta?.orgName || "").trim(),
  };
}

export async function POST(request) {
  try {
    const body = await request.json();
    const profile = body.profile || {};
    const { catalystBase } = getZohoUrls(profile.dc);

    let { accessToken: token } = await getValidAccessToken({
      clientId: profile.clientId,
      clientSecret: profile.clientSecret,
      refreshToken: profile.refreshToken,
      dc: profile.dc,
      passedToken: body.accessToken || null,
    });

    let refreshedToken = null;
    let refreshedExpiresAt = null;

    const fetchProjectsForOrg = async (authTok, orgId = null) => {
      const headers = { Authorization: `Zoho-oauthtoken ${authTok}` };
      if (orgId) {
        headers["CATALYST-ORG"] = String(orgId);
      }
      const res = await fetch(`${catalystBase}/baas/v1/project`, {
        method: "GET",
        headers,
        cache: "no-store",
      });
      const text = await res.text();
      return { res, data: parseSafeZohoJson(text, res.status) };
    };

    let { res: primaryRes, data: primaryData } = await fetchProjectsForOrg(token);

    if (
      isCatalystTokenError(primaryRes.status, primaryData) &&
      !isScopeMismatchError(primaryData) &&
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

      const retry = await fetchProjectsForOrg(token);
      primaryRes = retry.res;
      primaryData = retry.data;
    }

    if (!primaryRes.ok || primaryData?.status === "failure") {
      return NextResponse.json({
        success: false,
        scopeMismatch: isScopeMismatchError(primaryData),
        error: extractCatalystError(
          primaryData,
          "Failed to fetch Catalyst projects."
        ),
        newAccessToken: refreshedToken,
        newExpiresAt: refreshedExpiresAt,
        fullResponse: primaryData,
      });
    }

    const projectMap = new Map();
    const primaryList = Array.isArray(primaryData?.data)
      ? primaryData.data
      : Array.isArray(primaryData?.projects)
      ? primaryData.projects
      : [];

    for (const item of primaryList) {
      const norm = normalizeProjectItem(item);
      if (norm) projectMap.set(norm.id, norm);
    }

    // Best-effort Multi-Org discovery in case the account belongs to multiple Catalyst orgs
    try {
      const orgRes = await fetch(`${catalystBase}/baas/v1/orgs`, {
        method: "GET",
        headers: { Authorization: `Zoho-oauthtoken ${token}` },
        cache: "no-store",
      });
      if (orgRes.ok) {
        const orgRaw = await orgRes.text();
        const orgJson = parseSafeZohoJson(orgRaw, orgRes.status);
        const orgs = Array.isArray(orgJson?.data) ? orgJson.data : [];
        if (orgs.length > 0) {
          await Promise.all(
            orgs.slice(0, 8).map(async (org) => {
              const orgId = String(
                org.org_id || org.zaaid || org.id || ""
              ).trim();
              if (!orgId) return;
              const orgName = String(
                org.org_name || org.company_name || org.name || ""
              ).trim();
              try {
                const { res: r, data: d } = await fetchProjectsForOrg(
                  token,
                  orgId
                );
                if (r.ok && Array.isArray(d?.data)) {
                  for (const p of d.data) {
                    const norm = normalizeProjectItem(p, { orgId, orgName });
                    if (norm) {
                      const existing = projectMap.get(norm.id);
                      projectMap.set(norm.id, {
                        ...norm,
                        orgId: norm.orgId || existing?.orgId || "",
                        orgName: norm.orgName || existing?.orgName || "",
                      });
                    }
                  }
                }
              } catch {
                // ignore secondary org error
              }
            })
          );
        }
      }
    } catch {
      // Multi-org lookup is optional; ignore if unavailable
    }

    const projects = Array.from(projectMap.values());

    return NextResponse.json({
      success: true,
      projects,
      newAccessToken: refreshedToken,
      newExpiresAt: refreshedExpiresAt,
    });
  } catch (err) {
    return NextResponse.json(
      {
        success: false,
        error: err.message || "Unexpected server error fetching projects.",
      },
      { status: 500 }
    );
  }
}
