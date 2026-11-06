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
    const fromEmail = String(body.fromEmail || profile.fromEmail || "").trim();
    const recipientEmail = String(body.recipientEmail || "").trim();
    const subject = String(body.subject || "").trim();
    const content = String(body.content || "");
    const displayName = String(body.displayName || "").trim();
    const replyTo = String(body.replyTo || "").trim();

    if (!projectId || !fromEmail || !recipientEmail || !subject) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Project ID, From Email, Recipient Email, and Subject are required.",
        },
        { status: 400 }
      );
    }

    const { catalystBase } = getZohoUrls(profile.dc);
    const catalystUrl = `${catalystBase}/baas/v1/project/${encodeURIComponent(
      projectId
    )}/email/send`;

    let { accessToken: token } = await getValidAccessToken({
      clientId: profile.clientId,
      clientSecret: profile.clientSecret,
      refreshToken: profile.refreshToken,
      dc: profile.dc,
      passedToken: body.accessToken || null,
    });

    let refreshedToken = null;
    let refreshedExpiresAt = null;

    const buildForm = () => {
      const fd = new FormData();
      fd.append("from_email", fromEmail);
      fd.append("to_email", recipientEmail);
      fd.append("subject", subject);
      fd.append("content", content);
      fd.append("html_mode", "true");
      if (displayName) fd.append("display_name", displayName);
      if (replyTo) fd.append("reply_to", replyTo);
      return fd;
    };

    let catalystRes = await fetch(catalystUrl, {
      method: "POST",
      headers: { Authorization: `Zoho-oauthtoken ${token}` },
      body: buildForm(),
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
        headers: { Authorization: `Zoho-oauthtoken ${token}` },
        body: buildForm(),
        cache: "no-store",
      });
      rawText = await catalystRes.text();
      catalystData = parseSafeZohoJson(rawText, catalystRes.status);
    }

    const isSuccess = catalystRes.ok && catalystData?.status !== "failure";

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
      error: extractCatalystError(catalystData, "Failed to send email."),
      newAccessToken: refreshedToken,
      newExpiresAt: refreshedExpiresAt,
      fullResponse: catalystData,
    });
  } catch (err) {
    return NextResponse.json(
      {
        success: false,
        error: err.message || "Unexpected server error sending email.",
      },
      { status: 500 }
    );
  }
}
