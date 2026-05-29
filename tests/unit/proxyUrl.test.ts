import { describe, expect, it } from "vitest";

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
  it("uses a direct local gateway URL when Studio is also opened on loopback", () => {
    expect(
      resolveStudioProxyGatewayUrl("ws://localhost:18790", locationFor("127.0.0.1"))
    ).toBe("ws://localhost:18790");
  });

  it("rewrites a local gateway to the Studio host when Studio is opened remotely", () => {
    expect(
      resolveStudioProxyGatewayUrl("ws://localhost:18790", locationFor("100.91.24.29"))
    ).toBe("ws://100.91.24.29:18790/");
  });

  it("uses the Studio proxy for non-local upstreams", () => {
    expect(
      resolveStudioProxyGatewayUrl("wss://gateway.example", locationFor("studio.example", "", "https:"))
    ).toBe("wss://studio.example/api/gateway/ws");
  });
});
