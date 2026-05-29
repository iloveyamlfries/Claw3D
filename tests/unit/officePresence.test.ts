// @vitest-environment node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ORIGINAL_ENV = { ...process.env };

const requests: Array<{ method: string; params: unknown }> = [];
const connectMock = vi.fn();
const closeMock = vi.fn();
const requestMock = vi.fn(async (method: string, params: unknown) => {
  requests.push({ method, params });
  if (method === "agents.list") {
    return {
      mainKey: "main",
      agents: [{ id: "agent-1", name: "Agent One" }],
    };
  }
  if (method === "status") {
    return {
      sessions: {
        byAgent: [
          {
            agentId: "agent-1",
            recent: [{ key: "agent:agent-1:main", updatedAt: Date.now() }],
          },
        ],
      },
    };
  }
  if (method === "sessions.preview") {
    return { ts: 10_000, previews: [] };
  }
  throw new Error(`Unhandled method: ${method}`);
});

vi.mock("@/lib/gateway/nodeGatewayClient", async () => {
  const actual = await vi.importActual<typeof import("@/lib/gateway/nodeGatewayClient")>(
    "@/lib/gateway/nodeGatewayClient"
  );
  return {
    ...actual,
    NodeGatewayClient: vi.fn().mockImplementation(function MockNodeGatewayClient() {
      return {
        connect: connectMock,
        request: requestMock,
        close: closeMock,
      };
    }),
  };
});

const makeTempDir = (name: string) => fs.mkdtempSync(path.join(os.tmpdir(), `${name}-`));

const writeOpenclawConfig = (
  stateDir: string,
  options: { includeGateway?: boolean } = { includeGateway: true }
) => {
  fs.writeFileSync(
    path.join(stateDir, "openclaw.json"),
    JSON.stringify(
      {
        ...(options.includeGateway
          ? { gateway: { port: 18790, auth: { token: "openclaw-token" } } }
          : {}),
        agents: { list: [{ id: "agent-1", name: "Agent One" }] },
      },
      null,
      2
    ),
    "utf8"
  );
};

const writeStudioSettings = (stateDir: string, gateway?: { url: string; token: string }) => {
  const settingsDir = path.join(stateDir, "claw3d");
  fs.mkdirSync(settingsDir, { recursive: true });
  fs.writeFileSync(
    path.join(settingsDir, "settings.json"),
    JSON.stringify(
      {
        version: 1,
        ...(gateway ? { gateway: { ...gateway, adapterType: "openclaw" } } : {}),
      },
      null,
      2
    ),
    "utf8"
  );
};

describe("loadOfficePresenceSnapshot", () => {
  let tempDir: string | null = null;

  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
    delete process.env.OPENCLAW_STATE_DIR;
    delete process.env.CLAW3D_GATEWAY_URL;
    delete process.env.CLAW3D_GATEWAY_TOKEN;
    requests.length = 0;
    connectMock.mockReset();
    closeMock.mockReset();
    requestMock.mockClear();
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    if (tempDir) {
      fs.rmSync(tempDir, { recursive: true, force: true });
      tempDir = null;
    }
  });

  it("loads real gateway presence using studio settings", async () => {
    tempDir = makeTempDir("office-presence-settings");
    process.env.OPENCLAW_STATE_DIR = tempDir;
    writeOpenclawConfig(tempDir);
    writeStudioSettings(tempDir, { url: "ws://gateway.example:18789", token: "settings-token" });

    const { loadOfficePresenceSnapshot } = await import("@/lib/office/presence");
    const snapshot = await loadOfficePresenceSnapshot("local");

    expect(connectMock).toHaveBeenCalledWith({
      gatewayUrl: "ws://gateway.example:18789",
      token: "settings-token",
    });
    expect(requests.map((request) => request.method)).toEqual([
      "agents.list",
      "status",
      "sessions.preview",
    ]);
    expect(snapshot.agents).toEqual([
      {
        agentId: "agent-1",
        name: "Agent One",
        state: "working",
      },
    ]);
    expect(closeMock).toHaveBeenCalledTimes(1);
  });

  it("falls back to idle config agents when no gateway is configured", async () => {
    tempDir = makeTempDir("office-presence-no-gateway");
    process.env.OPENCLAW_STATE_DIR = tempDir;
    writeOpenclawConfig(tempDir, { includeGateway: false });
    writeStudioSettings(tempDir);

    const { loadOfficePresenceSnapshot } = await import("@/lib/office/presence");
    const snapshot = await loadOfficePresenceSnapshot("local");

    expect(connectMock).not.toHaveBeenCalled();
    expect(snapshot.agents).toEqual([
      {
        agentId: "agent-1",
        name: "Agent One",
        state: "idle",
        preferredDeskId: "desk-agent-1",
      },
    ]);
  });

  it("falls back to idle config agents when gateway presence fails", async () => {
    tempDir = makeTempDir("office-presence-gateway-fails");
    process.env.OPENCLAW_STATE_DIR = tempDir;
    writeOpenclawConfig(tempDir);
    writeStudioSettings(tempDir, { url: "ws://gateway.example:18789", token: "settings-token" });
    connectMock.mockRejectedValueOnce(new Error("offline"));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const { loadOfficePresenceSnapshot } = await import("@/lib/office/presence");
    const snapshot = await loadOfficePresenceSnapshot("local");

    expect(connectMock).toHaveBeenCalledTimes(1);
    expect(snapshot.agents).toEqual([
      {
        agentId: "agent-1",
        name: "Agent One",
        state: "idle",
        preferredDeskId: "desk-agent-1",
      },
    ]);
    expect(closeMock).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith(
      "[office-presence] Failed to load gateway presence; falling back to idle local agents.",
      expect.any(Error)
    );
    warnSpy.mockRestore();
  });
});
