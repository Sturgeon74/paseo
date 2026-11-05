import { execFileSync } from "node:child_process";
import { expect, type Locator, type Page } from "@playwright/test";
import { test } from "../support/fixtures";
import { gotoAppShell } from "../support/helpers/app";
import { seedMockAgentWorkspace } from "../support/helpers/mock-agent";
import { getServerId } from "../support/helpers/server-id";
import { expectWorkspaceTabVisible } from "../support/helpers/archive-tab";
import { seedWorkspace } from "../support/helpers/seed-client";

function folderRow(page: Page, name: string): Locator {
  return page
    .getByRole("button", { name, exact: true })
    .and(page.locator('[data-testid^="sidebar-conversation-folder-"]'));
}

test("keeps a filed archived chat with its name and history after reopening", async ({ page }) => {
  test.setTimeout(120_000);
  const seeded = await seedMockAgentWorkspace({
    repoPrefix: "archived-folder-",
    title: "Saved review",
    initialPrompt: "Remember this review",
  });
  const serverId = getServerId();
  const workspace = page.getByTestId(`sidebar-workspace-row-${serverId}:${seeded.workspaceId}`);
  const chat = page.getByTestId(`sidebar-conversation-${serverId}-${seeded.agentId}`);
  try {
    await seeded.client.waitForFinish(seeded.agentId, 30000);
    await gotoAppShell(page);
    const project = workspace.locator('xpath=ancestor::*[@role="group"][1]');
    await project.getByTestId(/^sidebar-project-row-/).hover();
    await project.getByTestId(/^sidebar-project-kebab-/).click();
    await page.getByRole("menuitem", { name: "New conversation folder", exact: true }).click();
    await nameEntry(page, "F03");
    await workspace.click({ button: "right" });
    await page.getByRole("menuitem", { name: "Move to folder", exact: true }).click();
    await page.getByRole("menuitem", { name: "F03", exact: true }).click();
    await expect(chat).toHaveText("Saved review");
    await seeded.client.archiveAgent(seeded.agentId);
    await expect(chat).toHaveText("Saved review");
    await expect(workspace).toHaveCount(0);
    await page.reload();
    await expect(chat).toHaveText("Saved review");
    await chat.click();
    await expect(page.getByText("This agent is archived", { exact: true })).toBeVisible();
    expect((await seeded.client.archiveWorkspace(seeded.workspaceId)).error).toBeNull();
    await page.reload();
    await expect(chat).toHaveText("Saved review");
  } finally {
    await seeded.cleanup();
  }
});

test("files a workspace without active sessions and keeps its move action after reload", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const seeded = await seedWorkspace({
    repoPrefix: "conversation-empty-",
    title: "F03 inactive review",
  });
  const serverId = getServerId();
  const workspace = page.getByTestId(`sidebar-workspace-row-${serverId}:${seeded.workspaceId}`);
  const kebab = page.getByTestId(`sidebar-workspace-kebab-${serverId}:${seeded.workspaceId}`);
  try {
    await page.setViewportSize({ width: 1180, height: 900 });
    await gotoAppShell(page);
    await expect(workspace).toBeVisible();
    await workspace.hover();
    await kebab.click();
    await page.getByRole("menuitem", { name: "Create folder and move", exact: true }).click();
    await nameEntry(page, "F03");
    const folder = folderRow(page, "F03");
    await expect(folder).toBeVisible();
    await expect(workspace).toHaveCount(1);
    await expect(workspace).toBeVisible();
    expect((await workspace.boundingBox())!.x).toBeGreaterThan(
      (await folder.boundingBox())!.x + 18,
    );
    await page.reload();
    await expect(folder).toBeVisible();
    await expect(workspace).toBeVisible();
    await folder.click();
    await expect(workspace).toHaveCount(0);
    await folder.click();
    await expect(workspace).toBeVisible();
    await workspace.hover();
    await kebab.click();
    await page.getByRole("menuitem", { name: "Move to folder", exact: true }).click();
    await page.getByRole("menuitem", { name: "Project root", exact: true }).click();
    await expect(workspace).toBeVisible();
    await folder.click();
    await expect(workspace).toBeVisible();
    await workspace.hover();
    await kebab.click();
    await page.getByRole("menuitem", { name: "Move to folder", exact: true }).click();
    await page.getByRole("menuitem", { name: "F03", exact: true }).click();
    await expect(workspace).toBeVisible();
    await page.screenshot({ path: "/private/tmp/paseo-empty-workspace-folder.png" });
  } finally {
    await seeded.cleanup();
  }
});

async function nameEntry(page: Page, name: string) {
  await page.getByTestId("sidebar-conversation-name-input").fill(name);
  await page.getByTestId("sidebar-conversation-name-submit").click();
  await expect(page.getByTestId("sidebar-conversation-name-input")).toHaveCount(0);
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
  const workspace = page.getByTestId(`sidebar-workspace-row-${serverId}:${first.workspaceId}`);
  const project = workspace.locator('xpath=ancestor::*[@role="group"][1]');
  const create = async () => {
    await project.getByTestId(/^sidebar-project-row-/).hover();
    await project.getByTestId(/^sidebar-project-kebab-/).click();
    await page.getByRole("menuitem", { name: "New conversation folder", exact: true }).click();
  };

  try {
    await first.client.waitForFinish(first.agentId, 30_000);
    await gotoAppShell(page);
    await create();
    await nameEntry(page, "Feature");
    const feature = folderRow(page, "Feature");
    await feature.click({ button: "right" });
    await page.getByRole("menuitem", { name: "New subfolder", exact: true }).click();
    await nameEntry(page, "Implementation");

    await create();
    await nameEntry(page, "Review");
    await page.getByRole("button", { name: "Actions for Review" }).click();
    await page.getByRole("menuitem", { name: "Move up", exact: true }).click();
    await expect(
      page.getByTestId(/^sidebar-conversation-folder-/).filter({ hasText: /^(Review|Feature)$/ }),
    ).toHaveText(["Review", "Feature"]);

    await workspace.click({ button: "right" });
    await page.getByRole("menuitem", { name: "Move to folder", exact: true }).click();
    await page.getByRole("menuitem", { name: "Feature / Implementation", exact: true }).click();
    await expect(workspace).toHaveCount(0);
    await feature.click();
    await expect(existing).toHaveCount(0);
    await expect(folderRow(page, "Implementation")).toHaveCount(0);
    await page.reload();
    await expect(feature).toHaveAttribute("aria-expanded", "false", { timeout: 30_000 });
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

    await folderRow(page, "Build").click({ button: "right" });
    await page.getByRole("menuitem", { name: /^Remove folder/ }).click();
    await expect(folderRow(page, "Build")).toHaveCount(0);
    await expect(existing).toHaveCount(0);
    await expect(workspace).toBeVisible();
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
