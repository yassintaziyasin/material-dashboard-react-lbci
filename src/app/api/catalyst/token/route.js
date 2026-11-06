import { NextResponse } from "next/server";
import { getValidAccessToken } from "@/lib/zohoServer";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request) {
  try {
    const body = await request.json();
    const profile = body.profile || body;

    const { accessToken, expiresAt } = await getValidAccessToken({
      clientId: profile.clientId,
      clientSecret: profile.clientSecret,
      refreshToken: profile.refreshToken,
      dc: profile.dc || "com",
      forceRefresh: Boolean(body.forceRefresh),
    });

    return NextResponse.json({
      success: true,
      accessToken,
      expiresAt,
    });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err.message || "Failed to obtain access token." },
      { status: 400 }
    );
  }
}
