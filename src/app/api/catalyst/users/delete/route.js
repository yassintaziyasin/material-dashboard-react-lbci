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
    const userId = String(body.userId || "").trim();

    if (!projectId || !userId) {
      return NextResponse.json(
        { success: false, error: "Project ID and User ID are required." },
        { status: 400 }
      );
    }

    const { catalystBase } = getZohoUrls(profile.dc);
    const catalystUrl = `${catalystBase}/baas/v1/project/${encodeURIComponent(
      projectId
    )}/project-user/${encodeURIComponent(userId)}`;

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
      method: "DELETE",
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
        method: "DELETE",
        headers: { Authorization: `Zoho-oauthtoken ${token}` },
        cache: "no-store",
      });
      rawText = await catalystRes.text();
      catalystData = parseSafeZohoJson(rawText, catalystRes.status);
    }

    const isSuccess = catalystRes.ok && catalystData?.status !== "failure";

    return NextResponse.json({
      success: isSuccess,
      data: catalystData,
      error: isSuccess
        ? null
        : extractCatalystError(catalystData, "Failed to delete user."),
      newAccessToken: refreshedToken,
      newExpiresAt: refreshedExpiresAt,
    });
  } catch (err) {
    return NextResponse.json(
      {
        success: false,
        error: err.message || "Unexpected server error deleting user.",
      },
      { status: 500 }
    );
  }
}
