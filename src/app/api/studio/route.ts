import { NextResponse } from "next/server";

import {
  sanitizeStudioGatewaySettings,
  sanitizeStudioSettings,
  type StudioSettingsPatch,
} from "@/lib/studio/settings";
import {
  applyStudioSettingsPatch,
  loadLocalGatewayDefaults,
  loadStudioSettings,
} from "@/lib/studio/settings-store";

export const runtime = "nodejs";

const isPatch = (value: unknown): value is StudioSettingsPatch =>
  Boolean(value && typeof value === "object");

const isLoopbackHost = (value: string | null) => {
  const raw = value?.trim() ?? "";
  if (!raw) return false;
  try {
    const parsed = new URL(raw.includes("://") ? raw : `http://${raw}`);
    return parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1" || parsed.hostname === "[::1]";
  } catch {
    return false;
  }
};

export async function GET(request?: Request) {
  try {
    const settings = loadStudioSettings();
    const localGatewayDefaults = loadLocalGatewayDefaults();
    const includePrivateLocalDefaults = isLoopbackHost(request?.headers.get("host") ?? null);
    return NextResponse.json(
      {
        settings: sanitizeStudioSettings(settings),
        localGatewayDefaults: sanitizeStudioGatewaySettings(localGatewayDefaults),
        ...(includePrivateLocalDefaults
          ? { localGatewayDefaultsPrivate: localGatewayDefaults }
          : {}),
        // gatewayPrivate is intentionally omitted.
        // Upstream tokens must not cross the browser API boundary — the Studio proxy
        // (server/gateway-proxy.js) injects the server-side token into connect frames.
        // Local OpenClaw can bypass the proxy only for loopback Studio requests, so
        // it receives localGatewayDefaultsPrivate when the browser is also local.
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to load studio settings.";
    console.error(message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const rawBody = await request.text();
    if (!rawBody.trim()) {
      return NextResponse.json({ error: "Invalid settings payload." }, { status: 400 });
    }
    const body = JSON.parse(rawBody) as unknown;
    if (!isPatch(body)) {
      return NextResponse.json({ error: "Invalid settings payload." }, { status: 400 });
    }
    const settings = applyStudioSettingsPatch(body);
    return NextResponse.json(
      {
        settings: sanitizeStudioSettings(settings),
        localGatewayDefaults: sanitizeStudioGatewaySettings(loadLocalGatewayDefaults()),
        // gatewayPrivate intentionally omitted — see GET handler comment.
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to save studio settings.";
    console.error(message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
