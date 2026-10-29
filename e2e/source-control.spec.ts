import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { enterDefaultWorkspace, openFixtureProject, revealWorkbenchTool } from "./fixtures/app";
import { gitAs } from "./fixtures/git";
import { E2E_FIXTURE_REPO } from "./fixtures/paths";

let originalHead: string | null = null;

async function openSourceControl(page: Page): Promise<void> {
	await openFixtureProject(page);
	originalHead = gitAs(E2E_FIXTURE_REPO, "rev-parse", "HEAD");
	await enterDefaultWorkspace(page);
	await revealWorkbenchTool(page, "files");
	await page.getByTestId("files-mode-git").click();
}

test.afterEach(() => {
	if (originalHead) {
		gitAs(E2E_FIXTURE_REPO, "reset", "--hard", originalHead);
		gitAs(E2E_FIXTURE_REPO, "clean", "-fd");
		originalHead = null;
	}
});

test("Git stages selected files, previews the real index, commits staged content and pushes", async ({
	page,
}, testInfo) => {
	await openSourceControl(page);
	const panel = page.getByTestId("source-control");
	await expect(panel).toBeVisible();
	const bare = mkdtempSync(join(tmpdir(), "kcode-source-origin-"));
	gitAs(bare, "init", "--bare");
	try {
		gitAs(E2E_FIXTURE_REPO, "remote", "add", "origin", bare);
		writeFileSync(join(E2E_FIXTURE_REPO, "README.md"), "staged replacement\n");
		writeFileSync(join(E2E_FIXTURE_REPO, "loose.txt"), "not selected\n");
		await panel.getByRole("button", { name: "Refresh Git status" }).click();
		const unstaged = page.getByTestId("source-unstaged");
		await expect(unstaged.locator('[data-path="README.md"]')).toBeVisible();
		await expect(page.getByTestId("source-commit")).toBeDisabled();
		await unstaged.locator('[data-path="README.md"]').getByTestId("source-stage-file").click();
		const staged = page.getByTestId("source-staged");
		await expect(staged.locator('[data-path="README.md"]')).toBeVisible();
		writeFileSync(join(E2E_FIXTURE_REPO, "README.md"), "unstaged next\n");
		await panel.getByRole("button", { name: "Refresh Git status" }).click();
		await staged
			.locator('[data-path="README.md"]')
			.getByRole("button", { name: "README.md", exact: true })
			.click();
		const diff = page.getByTestId("source-control-diff");
		await expect(diff).toContainText("staged replacement", { timeout: 15000 });
		await expect(diff).not.toContainText("unstaged next");
		await diff.getByRole("button", { name: "Close", exact: true }).click();
		await unstaged
			.locator('[data-path="README.md"]')
			.getByRole("button", { name: "README.md", exact: true })
			.click();
		await expect(diff).toContainText("unstaged next");
		writeFileSync(join(E2E_FIXTURE_REPO, "README.md"), "live worktree edit\n");
		await expect(diff).toContainText("live worktree edit");
		await diff.getByRole("button", { name: "Close", exact: true }).click();
		await page.getByTestId("source-commit-message").fill("feat: selected staged content");
		await page.getByTestId("files-mode-all").click();
		await page.getByTestId("files-mode-git").click();
		await expect(page.getByTestId("source-commit-message")).toHaveValue(
			"feat: selected staged content",
		);
		await expect(page.getByTestId("source-commit")).toBeEnabled();
		await panel.screenshot({ path: testInfo.outputPath("source-control.png") });
		await page.getByTestId("source-commit").click();
		await expect(staged.locator('[data-path="README.md"]')).toHaveCount(0);
		expect(gitAs(E2E_FIXTURE_REPO, "show", "HEAD:README.md")).toBe("staged replacement");
		expect(gitAs(E2E_FIXTURE_REPO, "status", "--porcelain")).toContain("loose.txt");
		await expect(page.getByTestId("source-commit-message")).toHaveValue("");
		await expect(page.getByTestId("source-push")).toBeEnabled();
		await page.getByTestId("source-push").click();
		await page.getByTestId("ship-confirm-base-push").click();
		await expect
			.poll(() => gitAs(bare, "for-each-ref", "--format=%(objectname)", "refs/heads/main"))
			.toBe(gitAs(E2E_FIXTURE_REPO, "rev-parse", "HEAD"));
	} finally {
		gitAs(E2E_FIXTURE_REPO, "remote", "remove", "origin");
		rmSync(bare, { recursive: true, force: true });
	}
});

test("a rejected commit keeps its message and staged files for retry", async ({ page }) => {
	await openSourceControl(page);
	writeFileSync(join(E2E_FIXTURE_REPO, "retry.txt"), "retry me\n");
	const panel = page.getByTestId("source-control");
	await panel.getByRole("button", { name: "Refresh Git status" }).click();
	await page
		.getByTestId("source-unstaged")
		.locator('[data-path="retry.txt"]')
		.getByTestId("source-stage-file")
		.click();
	const hook = join(E2E_FIXTURE_REPO, ".git", "hooks", "pre-commit");
	writeFileSync(hook, "#!/bin/sh\necho fixture-rejection >&2\nexit 1\n");
	chmodSync(hook, 0o755);
	try {
		await page.getByTestId("source-commit-message").fill("retry commit");
		await page.getByTestId("source-commit").click();
		await expect(panel.getByRole("alert")).toContainText("fixture-rejection");
		await expect(page.getByTestId("source-commit-message")).toHaveValue("retry commit");
		await expect(
			page.getByTestId("source-staged").locator('[data-path="retry.txt"]'),
		).toBeVisible();
		rmSync(hook);
		await page.getByTestId("source-commit").click();
		await expect(page.getByTestId("source-commit-message")).toHaveValue("");
		await expect(panel.getByRole("alert")).toHaveCount(0);
	} finally {
		rmSync(hook, { force: true });
	}
});

test("the diff dialog can stage and unstage the reviewed file", async ({ page }) => {
	await openSourceControl(page);
	writeFileSync(join(E2E_FIXTURE_REPO, "review.txt"), "reviewed text\n");
	await page
		.getByTestId("source-control")
		.getByRole("button", { name: "Refresh Git status" })
		.click();
	await page
		.getByTestId("source-unstaged")
		.locator('[data-path="review.txt"]')
		.getByRole("button", { name: "review.txt", exact: true })
		.click();
	await expect(page.getByTestId("source-control-diff")).toContainText("reviewed text");
	await page.getByTestId("source-diff-toggle-stage").click();
	await expect(page.getByTestId("source-control-diff")).toHaveCount(0);
	await page
		.getByTestId("source-staged")
		.locator('[data-path="review.txt"]')
		.getByRole("button", { name: "review.txt", exact: true })
		.click();
	await page.getByTestId("source-diff-toggle-stage").click();
	await expect(page.getByTestId("source-control-diff")).toHaveCount(0);
	await expect(
		page.getByTestId("source-unstaged").locator('[data-path="review.txt"]'),
	).toBeVisible();
});

for (const nextMessage of ["next draft", "first draft"]) {
	test(`a late commit acknowledgement preserves a newer draft (${nextMessage}) after switching file modes`, async ({
		page,
	}) => {
		let capture: ((release: () => void) => void) | undefined;
		const captured = new Promise<() => void>((resolve) => {
			capture = resolve;
		});
		await page.routeWebSocket(/\/ws(\?|$)/, (ws) => {
			const server = ws.connectToServer();
			let commitId: string | undefined;
			ws.onMessage((message) => {
				const frame = JSON.parse(typeof message === "string" ? message : message.toString()) as {
					id?: string;
					method?: string;
				};
				if (frame.method === "git.sourceCommit") commitId = frame.id;
				server.send(message);
			});
			server.onMessage((message) => {
				const frame = JSON.parse(typeof message === "string" ? message : message.toString()) as {
					id?: string;
				};
				if (commitId && frame.id === commitId) {
					capture?.(() => ws.send(message));
					commitId = undefined;
				} else ws.send(message);
			});
		});
		await openSourceControl(page);
		writeFileSync(join(E2E_FIXTURE_REPO, "late.txt"), "late acknowledgement\n");
		await page
			.getByTestId("source-control")
			.getByRole("button", { name: "Refresh Git status" })
			.click();
		await page
			.getByTestId("source-unstaged")
			.locator('[data-path="late.txt"]')
			.getByTestId("source-stage-file")
			.click();
		await page.getByTestId("source-commit-message").fill("first draft");
		await page.getByTestId("source-commit").click();
		const release = await captured;
		await page.getByTestId("files-mode-all").click();
		await page.getByTestId("files-mode-git").click();
		await page.getByTestId("source-commit-message").fill("intermediate edit");
		await page.getByTestId("source-commit-message").fill(nextMessage);
		release();
		await page.evaluate(
			() =>
				new Promise<void>((resolve) =>
					requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
				),
		);
		await expect(page.getByTestId("source-commit-message")).toHaveValue(nextMessage);
		expect(gitAs(E2E_FIXTURE_REPO, "log", "-1", "--format=%s")).toBe("first draft");
	});
}
