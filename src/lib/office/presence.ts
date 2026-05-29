import fs from "node:fs";
import path from "node:path";

import type {
  SummaryPreviewSnapshot,
  SummaryStatusSnapshot,
} from "@/features/agents/state/runtimeEventBridge";
import { resolveStateDir } from "@/lib/clawdbot/paths";
import { readConfigAgentList } from "@/lib/gateway/agentConfig";
import { NodeGatewayClient, buildAgentMainSessionKey } from "@/lib/gateway/nodeGatewayClient";
import { buildOfficePresenceSnapshotFromGateway } from "@/lib/office/gatewayPresence";
import type { OfficeAgentState } from "@/lib/office/schema";
import { loadStudioSettings } from "@/lib/studio/settings-store";

export type OfficeAgentPresence = {
  agentId: string;
  name: string;
  state: OfficeAgentState;
  preferredDeskId?: string;
};

export type OfficePresenceSnapshot = {
  workspaceId: string;
  timestamp: string;
  agents: OfficeAgentPresence[];
};

const OPENCLAW_CONFIG_FILENAME = "openclaw.json";

const asRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === "object" && !Array.isArray(value));

const normalizeOfficeAgentState = (value: unknown): OfficeAgentState => {
  if (value === "working" || value === "idle" || value === "meeting" || value === "error") {
    return value;
  }
  return "idle";
};

export const normalizeOfficePresenceSnapshot = (
  value: unknown,
  fallbackWorkspaceId = "default"
): OfficePresenceSnapshot => {
  if (!asRecord(value)) {
    return {
      workspaceId: fallbackWorkspaceId,
      timestamp: new Date().toISOString(),
      agents: [],
    };
  }
  const workspaceId =
    typeof value.workspaceId === "string" && value.workspaceId.trim().length > 0
      ? value.workspaceId.trim()
      : fallbackWorkspaceId;
  const timestamp =
    typeof value.timestamp === "string" && value.timestamp.trim().length > 0
      ? value.timestamp
      : new Date().toISOString();
  const rawAgents = Array.isArray(value.agents) ? value.agents : [];
  const agents: OfficeAgentPresence[] = rawAgents.flatMap((entry) => {
    if (!asRecord(entry)) return [];
    const agentId = typeof entry.agentId === "string" ? entry.agentId.trim() : "";
    if (!agentId) return [];
    const name = typeof entry.name === "string" && entry.name.trim().length > 0
      ? entry.name.trim()
      : agentId;
    const preferredDeskId =
      typeof entry.preferredDeskId === "string" && entry.preferredDeskId.trim().length > 0
        ? entry.preferredDeskId.trim()
        : undefined;
    return [
      {
        agentId,
        name,
        state: normalizeOfficeAgentState(entry.state),
        ...(preferredDeskId ? { preferredDeskId } : {}),
      },
    ];
  });
  return {
    workspaceId,
    timestamp,
    agents,
  };
};

export const fetchRemoteOfficePresenceSnapshot = async (params: {
  presenceUrl: string;
  token?: string | null;
  timeoutMs?: number;
}): Promise<OfficePresenceSnapshot> => {
  const presenceUrl = params.presenceUrl.trim();
  if (!presenceUrl) {
    throw new Error("Remote office presence URL is not configured.");
  }
  const controller = new AbortController();
  const timeoutMs = Math.max(1_000, params.timeoutMs ?? 15_000);
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers: Record<string, string> = {
      Accept: "application/json",
    };
    const token = params.token?.trim() ?? "";
    if (token) {
      headers.Authorization = `Bearer ${token}`;
      headers["X-Claw3D-Office-Token"] = token;
    }
    const response = await fetch(presenceUrl, {
      method: "GET",
      headers,
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`Remote office presence request failed with status ${response.status}.`);
    }
    const payload = (await response.json()) as unknown;
    return normalizeOfficePresenceSnapshot(payload, "remote");
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`Remote office presence request timed out after ${timeoutMs}ms.`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
};

const readLocalConfigAgents = (): OfficeAgentPresence[] => {
  const configPath = path.join(resolveStateDir(), OPENCLAW_CONFIG_FILENAME);
  if (!fs.existsSync(configPath)) {
    return [];
  }
  const raw = fs.readFileSync(configPath, "utf8");
  const parsed = JSON.parse(raw) as unknown;
  const config =
    parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined;
  const agentList = readConfigAgentList(config);
  return agentList.map((entry) => {
    const id = entry.id.trim();
    const nameRaw = typeof entry.name === "string" ? entry.name : id;
    return {
      agentId: id,
      name: nameRaw,
      state: "idle",
      preferredDeskId: `desk-${id}`,
    };
  });
};

const buildIdleLocalPresenceSnapshot = (
  workspaceId: string,
  timestamp: string
): OfficePresenceSnapshot => ({
  workspaceId,
  timestamp,
  agents: readLocalConfigAgents(),
});

export const loadOfficePresenceSnapshot = async (
  workspaceId: string
): Promise<OfficePresenceSnapshot> => {
  const timestamp = new Date().toISOString();
  const settings = loadStudioSettings();
  const gatewayUrl = settings.gateway?.url?.trim() ?? "";
  if (!gatewayUrl) {
    return buildIdleLocalPresenceSnapshot(workspaceId, timestamp);
  }

  const gatewayClient = new NodeGatewayClient();
  try {
    await gatewayClient.connect({
      gatewayUrl,
      token: settings.gateway?.token,
    });
    const agentsResult = (await gatewayClient.request("agents.list", {})) as {
      mainKey?: string;
      agents?: Array<{ id?: string; name?: string; identity?: { name?: string } }>;
    };
    const statusSummary = (await gatewayClient.request("status", {})) as SummaryStatusSnapshot;
    const agentIds = Array.isArray(agentsResult.agents)
      ? agentsResult.agents
          .map((agent) => (typeof agent.id === "string" ? agent.id.trim() : ""))
          .filter((agentId) => agentId.length > 0)
      : [];
    const mainKey = agentsResult.mainKey?.trim() || "main";
    const sessionKeys = agentIds.map((agentId) => buildAgentMainSessionKey(agentId, mainKey));
    const previewSnapshot: SummaryPreviewSnapshot | null =
      sessionKeys.length > 0
        ? ((await gatewayClient.request("sessions.preview", {
            keys: sessionKeys,
            limit: 8,
            maxChars: 240,
          })) as SummaryPreviewSnapshot)
        : null;
    const snapshot = buildOfficePresenceSnapshotFromGateway({
      agentsResult,
      statusSummary,
      previewSnapshot,
      workspaceId,
    });
    return {
      ...snapshot,
      timestamp,
    };
  } catch (error) {
    console.warn(
      "[office-presence] Failed to load gateway presence; falling back to idle local agents.",
      error
    );
    return buildIdleLocalPresenceSnapshot(workspaceId, timestamp);
  } finally {
    gatewayClient.close();
  }
};
