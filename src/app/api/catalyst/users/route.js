import { NextResponse } from "next/server";
import {
  extractCatalystError,
  getValidAccessToken,
  getZohoUrls,
  isCatalystTokenError,
  parseSafeZohoJson,
} from "@/lib/zohoServer";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request) {
  try {
    const body = await request.json();
    const profile = body.profile || {};
    const projectId = String(body.projectId || profile.projectId || "").trim();
    const page = Math.max(1, parseInt(body.page || "1", 10) || 1);
    const perPage = Math.min(
      200,
      Math.max(1, parseInt(body.perPage || "50", 10) || 50)
    );
    const start = (page - 1) * perPage + 1;
    const end = start + perPage - 1;

    if (!projectId) {
      return NextResponse.json(
        { success: false, error: "Catalyst Project ID is required." },
        { status: 400 }
      );
    }

    const { catalystBase } = getZohoUrls(profile.dc);
    const catalystUrl = `${catalystBase}/baas/v1/project/${encodeURIComponent(
      projectId
    )}/project-user?start=${start}&end=${end}`;

    let { accessToken: token } = await getValidAccessToken({
      clientId: profile.clientId,
      clientSecret: profile.clientSecret,
      refreshToken: profile.refreshToken,
      dc: profile.dc,
      passedToken: body.accessToken || null,
    });

    let refreshedToken = null;
    let refreshedExpiresAt = null;

    let catalystRes = await fetch(catalystUrl, {
      method: "GET",
      headers: { Authorization: `Zoho-oauthtoken ${token}` },
      cache: "no-store",
    });

    let rawText = await catalystRes.text();
    let catalystData = parseSafeZohoJson(rawText, catalystRes.status);

    if (
      isCatalystTokenError(catalystRes.status, catalystData) &&
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

      catalystRes = await fetch(catalystUrl, {
        method: "GET",
        headers: { Authorization: `Zoho-oauthtoken ${token}` },
        cache: "no-store",
      });
      rawText = await catalystRes.text();
      catalystData = parseSafeZohoJson(rawText, catalystRes.status);
    }

    if (!catalystRes.ok || catalystData?.status === "failure") {
      return NextResponse.json({
        success: false,
        error: extractCatalystError(catalystData, "Failed to fetch users."),
        newAccessToken: refreshedToken,
        newExpiresAt: refreshedExpiresAt,
        fullResponse: catalystData,
      });
    }

    const users = Array.isArray(catalystData?.data) ? catalystData.data : [];

    return NextResponse.json({
      success: true,
      users,
      page,
      perPage,
      hasMore: Boolean(catalystData?.more_records || users.length >= perPage),
      newAccessToken: refreshedToken,
      newExpiresAt: refreshedExpiresAt,
    });
  } catch (err) {
    return NextResponse.json(
      {
        success: false,
        error: err.message || "Unexpected server error fetching users.",
      },
      { status: 500 }
    );
  }
}
