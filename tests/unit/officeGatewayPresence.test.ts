import { describe, expect, it } from "vitest";

import { buildOfficePresenceSnapshotFromGateway } from "@/lib/office/gatewayPresence";

describe("buildOfficePresenceSnapshotFromGateway", () => {
  const agentsResult = {
    mainKey: "main",
    agents: [
      { id: "agent-1", name: "One" },
      { id: "agent-2", name: "Two" },
    ],
  };

  it("marks an agent idle when the latest main-session preview item is from the assistant", () => {
    const snapshot = buildOfficePresenceSnapshotFromGateway({
      agentsResult,
      previewSnapshot: {
        ts: 1,
        previews: [
          {
            key: "agent:agent-1:main",
            status: "ok",
            items: [{ role: "assistant", text: "done" }],
          },
        ],
      },
      now: 1_000,
    });

    expect(snapshot.agents.find((agent) => agent.agentId === "agent-1")?.state).toBe("idle");
  });

  it("marks an agent working when the latest main-session preview item is from the user", () => {
    const snapshot = buildOfficePresenceSnapshotFromGateway({
      agentsResult,
      previewSnapshot: {
        ts: 1,
        previews: [
          {
            key: "agent:agent-1:main",
            status: "ok",
            items: [
              { role: "assistant", text: "ready" },
              { role: "user", text: "please work" },
            ],
          },
        ],
      },
      now: 1_000,
    });

    expect(snapshot.agents.find((agent) => agent.agentId === "agent-1")?.state).toBe("working");
  });

  it("marks an agent working from recent main-session activity when preview is unavailable", () => {
    const snapshot = buildOfficePresenceSnapshotFromGateway({
      agentsResult,
      statusSummary: {
        sessions: {
          byAgent: [
            {
              agentId: "agent-1",
              recent: [{ key: "agent:agent-1:main", updatedAt: 9_000 }],
            },
          ],
        },
      },
      now: 10_000,
    });

    expect(snapshot.agents.find((agent) => agent.agentId === "agent-1")?.state).toBe("working");
  });

  it("attributes child-session activity to the parent byAgent group as meeting", () => {
    const snapshot = buildOfficePresenceSnapshotFromGateway({
      agentsResult,
      statusSummary: {
        sessions: {
          byAgent: [
            {
              agentId: "agent-1",
              recent: [{ key: "agent:agent-2:child-run", updatedAt: 9_000 }],
            },
          ],
        },
      },
      now: 10_000,
    });

    expect(snapshot.agents.find((agent) => agent.agentId === "agent-1")?.state).toBe("meeting");
    expect(snapshot.agents.find((agent) => agent.agentId === "agent-2")?.state).toBe("idle");
  });

  it("maps failed session status to error", () => {
    const snapshot = buildOfficePresenceSnapshotFromGateway({
      agentsResult,
      statusSummary: {
        sessions: {
          byAgent: [
            {
              agentId: "agent-1",
              recent: [
                {
                  key: "agent:agent-1:main",
                  updatedAt: 9_000,
                  status: "failed",
                } as never,
              ],
            },
          ],
        },
      },
      now: 10_000,
    });

    expect(snapshot.agents.find((agent) => agent.agentId === "agent-1")?.state).toBe("error");
  });
});
