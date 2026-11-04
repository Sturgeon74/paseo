import { execFileSync } from "node:child_process";
import { expect, type Locator, type Page } from "@playwright/test";
import { test } from "../support/fixtures";
import { gotoAppShell } from "../support/helpers/app";
import { seedMockAgentWorkspace } from "../support/helpers/mock-agent";
import { getServerId } from "../support/helpers/server-id";
import { expectWorkspaceTabVisible } from "../support/helpers/archive-tab";

function folderRow(page: Page, name: string): Locator {
  return page
    .getByRole("button", { name, exact: true })
    .and(page.locator('[data-testid^="sidebar-conversation-folder-"]'));
}

async function nameEntry(page: Page, name: string) {
  await page.getByTestId("sidebar-conversation-name-input").fill(name);
  await page.getByTestId("sidebar-conversation-name-submit").click();
  await expect(page.getByTestId("sidebar-conversation-name-input")).toHaveCount(0);
}

async function moveConversation(page: Page, row: Locator, destination: string) {
  await row.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Move to folder", exact: true }).click();
  await page.getByRole("menuitem", { name: destination, exact: true }).click();
}

test("files real sidebar sessions by ID without changing their workspace or history", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const prompt = "Folder test context that should survive filing";
  const first = await seedMockAgentWorkspace({
    repoPrefix: "conversation-folders-",
    title: "Existing conversation",
    initialPrompt: prompt,
  });
  const serverId = getServerId();
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: first.cwd, encoding: "utf8" });
  const head = git("symbolic-ref", "HEAD");
  const worktrees = git("worktree", "list", "--porcelain");
  const branches = git("for-each-ref", "refs/heads");
  const existing = page.getByTestId(`sidebar-conversation-${serverId}-${first.agentId}`);
  const unfiled = page.getByRole("button", { name: "Unfiled", exact: true });
  const create = page.getByRole("button", { name: "New conversation folder", exact: true });

  try {
    await first.client.waitForFinish(first.agentId, 30_000);
    await gotoAppShell(page);
    await create.click();
    await nameEntry(page, "Feature");
    const feature = folderRow(page, "Feature");
    await feature.click({ button: "right" });
    await page.getByRole("menuitem", { name: "New subfolder", exact: true }).click();
    await nameEntry(page, "Implementation");

    await create.click();
    await nameEntry(page, "Review");
    await page.getByRole("button", { name: "Actions for Review" }).click();
    await page.getByRole("menuitem", { name: "Move up", exact: true }).click();
    await expect(
      page.getByTestId(/^sidebar-conversation-folder-/).filter({ hasText: /^(Review|Feature)$/ }),
    ).toHaveText(["Review", "Feature"]);

    await unfiled.click();
    await moveConversation(page, existing, "Feature / Implementation");
    await feature.click();
    await expect(existing).toHaveCount(0);
    await expect(folderRow(page, "Implementation")).toHaveCount(0);
    await page.reload();
    await expect(feature).toHaveAttribute("aria-expanded", "false", { timeout: 30_000 });
    await expect(unfiled).toHaveAttribute("aria-expanded", "true");
    await expect(existing).toHaveCount(0);

    await feature.click();
    await expect(existing).toBeVisible();
    await folderRow(page, "Implementation").click({ button: "right" });
    await page.getByRole("menuitem", { name: "Rename folder", exact: true }).click();
    await nameEntry(page, "Build");
    await existing.click();
    await expectWorkspaceTabVisible(page, first.agentId);
    await expect(
      page.getByTestId("agent-chat-scroll").getByText(prompt, { exact: true }),
    ).toBeVisible();

    await page.getByRole("button", { name: "Actions for Existing conversation" }).click();
    await page.getByRole("menuitem", { name: "Rename agent", exact: true }).click();
    await nameEntry(page, "Renamed conversation");
    await expect(existing).toHaveText("Renamed conversation");

    const second = await first.client.createAgent({
      provider: "mock",
      cwd: first.cwd,
      workspaceId: first.workspaceId,
      title: "New conversation",
      modeId: "load-test",
      model: "e2e-fast-stream",
    });
    const newConversation = page.getByTestId(`sidebar-conversation-${serverId}-${second.id}`);
    await expect(newConversation).toBeVisible();
    await moveConversation(page, newConversation, "Feature / Build");
    await expect(newConversation).toBeVisible();
    await first.client.archiveAgent(second.id);
    await expect(newConversation).toHaveCount(0);

    await folderRow(page, "Build").click({ button: "right" });
    await page.getByRole("menuitem", { name: /^Remove folder/ }).click();
    await expect(folderRow(page, "Build")).toHaveCount(0);
    await expect(existing).toHaveText("Renamed conversation");
    const directory = await first.client.fetchAgents({ scope: "active" });
    expect(
      directory.entries.find(({ agent }) => agent.id === first.agentId)?.agent.workspaceId,
    ).toBe(first.workspaceId);
    expect(git("symbolic-ref", "HEAD")).toBe(head);
    expect(git("worktree", "list", "--porcelain")).toBe(worktrees);
    expect(git("for-each-ref", "refs/heads")).toBe(branches);
  } finally {
    await first.cleanup();
  }
});
