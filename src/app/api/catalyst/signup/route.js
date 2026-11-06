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
    const email = String(body.email || "").trim();
    const firstName = String(body.firstName || "User").trim();
    const lastName = String(body.lastName || "").trim();

    if (!projectId || !email) {
      return NextResponse.json(
        { success: false, error: "Project ID and Email are required." },
        { status: 400 }
      );
    }

    const { catalystBase } = getZohoUrls(profile.dc);
    const catalystUrl = `${catalystBase}/baas/v1/project/${encodeURIComponent(
      projectId
    )}/project-user/signup`;

    const signupBody = JSON.stringify({
      platform_type: "web",
      user_details: {
        first_name: firstName || "User",
        last_name: lastName,
        email_id: email,
      },
    });

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
      method: "POST",
      headers: {
        Authorization: `Zoho-oauthtoken ${token}`,
        "Content-Type": "application/json",
      },
      body: signupBody,
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
        method: "POST",
        headers: {
          Authorization: `Zoho-oauthtoken ${token}`,
          "Content-Type": "application/json",
        },
        body: signupBody,
        cache: "no-store",
      });
      rawText = await catalystRes.text();
      catalystData = parseSafeZohoJson(rawText, catalystRes.status);
    }

    const isSuccess =
      catalystRes.ok &&
      catalystData?.status !== "failure" &&
      (catalystData?.status === "success" || Boolean(catalystData?.data));

    if (isSuccess) {
      return NextResponse.json({
        success: true,
        newAccessToken: refreshedToken,
        newExpiresAt: refreshedExpiresAt,
        fullResponse: catalystData,
      });
    }

    return NextResponse.json({
      success: false,
      error: extractCatalystError(catalystData, "Failed to register user."),
      newAccessToken: refreshedToken,
      newExpiresAt: refreshedExpiresAt,
      fullResponse: catalystData,
    });
  } catch (err) {
    return NextResponse.json(
      {
        success: false,
        error: err.message || "Unexpected server error registering user.",
      },
      { status: 500 }
    );
  }
}
