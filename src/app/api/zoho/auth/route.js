import { NextResponse } from "next/server";
import { getZohoUrls, resolveRequestOrigin } from "@/lib/zohoServer";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request) {
  try {
    const body = await request.json();
    const clientId = String(body.clientId || "").trim();
    const clientSecret = String(body.clientSecret || "").trim();
    const { dc, accountsBase } = getZohoUrls(body.dc);

    if (!clientId || !clientSecret) {
      return NextResponse.json(
        { success: false, error: "Client ID and Client Secret are required." },
        { status: 400 }
      );
    }

    const origin =
      body.origin && /^https?:\/\//i.test(String(body.origin))
        ? String(body.origin).replace(/\/+$/, "")
        : resolveRequestOrigin(request);

    const redirectUri = `${origin}/api/zoho/callback`;
    const state = crypto.randomUUID();
    const cookieName = `zc_oauth_${state.slice(0, 8)}`;

    const scopes = [
      "ZohoCatalyst.projects.ALL",
      "ZohoCatalyst.projects.users.CREATE",
      "ZohoCatalyst.projects.users.READ",
      "ZohoCatalyst.projects.users.DELETE",
      "ZohoCatalyst.email.CREATE",
      "AaaServer.profile.READ",
    ].join(",");

    const authParams = new URLSearchParams({
      scope: scopes,
      client_id: clientId,
      response_type: "code",
      access_type: "offline",
      redirect_uri: redirectUri,
      prompt: "consent",
      state,
    });

    const authUrl = `${accountsBase}/oauth/v2/auth?${authParams.toString()}`;

    const encodedPayload = Buffer.from(
      JSON.stringify({
        state,
        clientId,
        clientSecret,
        redirectUri,
        dc,
        createdAt: Date.now(),
      }),
      "utf8"
    ).toString("base64url");

    const response = NextResponse.json({
      success: true,
      authUrl,
      state,
      redirectUri,
      dc,
    });

    response.cookies.set(cookieName, encodedPayload, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 600,
      secure: redirectUri.startsWith("https://"),
    });

    return response;
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err.message || "Failed to initialize OAuth." },
      { status: 500 }
    );
  }
}
