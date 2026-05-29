import { afterEach, describe, expect, it, vi } from "vitest";

import { resolveStudioProxyGatewayUrl } from "@/lib/gateway/proxy-url";

const locationFor = (
  hostname: string,
  port = "3000",
  protocol: "http:" | "https:" = "http:"
) => ({
  hostname,
  port,
  protocol,
});

describe("resolveStudioProxyGatewayUrl", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("uses a direct local gateway URL when Studio is also opened on loopback", () => {
    expect(
      resolveStudioProxyGatewayUrl("ws://localhost:18790", locationFor("127.0.0.1"))
    ).toBe("ws://localhost:18790");
  });

  it("uses the Studio proxy for a local gateway when Studio is opened remotely", () => {
    expect(
      resolveStudioProxyGatewayUrl("ws://localhost:18790", locationFor("100.91.24.29"))
    ).toBe("ws://100.91.24.29:3000/api/gateway/ws");
  });

  it("uses a configured Studio proxy port", () => {
    vi.stubEnv("NEXT_PUBLIC_GATEWAY_PROXY_PORT", "3011");

    expect(
      resolveStudioProxyGatewayUrl("ws://localhost:18790", locationFor("100.91.24.29"))
    ).toBe("ws://100.91.24.29:3011/api/gateway/ws");
  });

  it("uses the Studio proxy for non-local upstreams", () => {
    expect(
      resolveStudioProxyGatewayUrl("wss://gateway.example", locationFor("studio.example", "", "https:"))
    ).toBe("wss://studio.example/api/gateway/ws");
  });
});
