import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import pino from "pino";
import { expect, test } from "vitest";
import { CodexAppServerAgentClient } from "./providers/codex-app-server-agent.js";
import { DaemonClient } from "../test-utils/daemon-client.js";
import { createTestPaseoDaemon } from "../test-utils/paseo-daemon.js";
import type { AgentStorage } from "./agent-storage.js";

test("real disposable Codex session safely resumes a completed turn after runtime closes", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "paseo-real-idle-resume-"));
  const logger = pino({ level: "silent" });
  const daemon = await createTestPaseoDaemon({
    agentClients: { codex: new CodexAppServerAgentClient(logger) },
    logger,
    mcpEnabled: false,
  });
  const client = new DaemonClient({
    url: `ws://127.0.0.1:${daemon.port}/ws`,
    appVersion: "0.15.4",
  });
  try {
    await client.connect();
    const agent = await client.createAgent({
      provider: "codex",
      cwd: directory,
      title: "Disposable idle-resume test",
    });
    await client.sendAgentMessage(agent.id, "Reply with exactly FIRST. Do not use tools.");
    const first = await client.waitForFinish(agent.id, 120000);
    expect(first.status).toBe("idle");
    const turnId = daemon.daemon.agentManager.getAgent(agent.id)?.lastCompletedTurnId;
    expect(turnId).toBeTruthy();
    expect(daemon.daemon.agentManager.getAgent(agent.id)?.lastCompletedTurnProof).toBeTruthy();
    await daemon.daemon.agentManager.closeAgent(agent.id);
    const admitted = await client.sendAgentMessageIfIdle(
      agent.id,
      "Reply with exactly SECOND. Do not use tools.",
      turnId!,
    );
    expect(admitted.accepted).toBe(true);
    const second = await client.waitForFinish(agent.id, 120000);
    expect(second.status).toBe("idle");
    const page = await client.fetchAgentTimeline(agent.id, { direction: "tail", limit: 50 });
    expect(page.entries.filter((entry) => entry.item.type === "user_message")).toHaveLength(2);
    const secondTurn = daemon.daemon.agentManager.getAgent(agent.id)?.lastCompletedTurnId;
    expect(secondTurn).not.toBe(turnId);
    await daemon.daemon.agentManager.closeAgent(agent.id);
    const registry = (daemon.daemon.agentManager as unknown as { registry: AgentStorage }).registry;
    const legacy = (await registry.get(agent.id))!;
    delete legacy.lastCompletedTurnId;
    delete legacy.lastCompletedTurnProof;
    delete legacy.legacyContinuationRecovery;
    await registry.upsert(legacy);
    const migrated = await client.sendAgentMessageIfIdle(
      agent.id,
      "Reply with exactly THIRD. Do not use tools.",
      secondTurn!,
    );
    expect(migrated).toEqual({ accepted: true });
    expect((await client.waitForFinish(agent.id, 120000)).status).toBe("idle");
    const finalPage = await client.fetchAgentTimeline(agent.id, { direction: "tail", limit: 50 });
    expect(finalPage.entries.filter((entry) => entry.item.type === "user_message")).toHaveLength(3);
  } finally {
    await client.close();
    await daemon.close();
    await rm(directory, { recursive: true, force: true });
  }
}, 240000);
