import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { openWorkspaceChat, runInTerminal, visibleTerminalScreen } from "./fixtures/app";

test("renders the branded shell and, with no workspace, the Welcome screen", async ({ page }) => {
	await page.goto("/");

	await expect(page.getByTestId("shell")).toBeVisible();
	await expect(page.getByTestId("left-nav")).toBeVisible();
	await expect(page.getByTestId("welcome")).toBeVisible();
	await expect(page.getByTestId("center-tabs")).toHaveCount(0);
	await expect(page.getByTestId("right-panel")).toHaveCount(0);

	const { primary, themeId } = await page.evaluate(() => ({
		primary: getComputedStyle(document.documentElement).getPropertyValue("--primary").trim(),
		themeId: document.documentElement.getAttribute("data-theme"),
	}));
	expect(themeId).toBeTruthy();
	const manifest = JSON.parse(
		readFileSync(
			new URL(`../apps/web/src/themes/bundled/${themeId}.theme.json`, import.meta.url),
			"utf8",
		),
	) as { colors: { accent: string } };
	expect(primary.toLowerCase()).toBe(manifest.colors.accent);

	const logo = page.getByTestId("brand-logo");
	await expect(logo).toBeVisible();
	await expect(logo).toHaveAttribute("aria-label", "KCode");
	const logoBox = await logo.boundingBox();
	expect(logoBox).not.toBeNull();
	expect(logoBox?.height).toBeCloseTo(20, 0);
	expect(logoBox?.width).toBeCloseTo(20, 0);
	const logoColors = await logo.evaluate((element) => ({
		color: getComputedStyle(element).color,
		fill: getComputedStyle(element.querySelector("path") ?? element).fill,
	}));
	expect(logoColors.fill).toBe(logoColors.color);

	const favicon = page.locator('link[rel="icon"]');
	await expect(favicon).toHaveAttribute("type", "image/svg+xml");
	await expect(favicon).toHaveAttribute("href", "/favicon.svg");
	const faviconResponse = await page.request.get("/favicon.svg");
	expect(faviconResponse.ok()).toBe(true);
	const faviconSvg = await faviconResponse.text();
	expect(faviconSvg).toContain("<title>KCode</title>");
	expect(faviconSvg).toContain("prefers-color-scheme: dark");

	await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");
	await expect(page.getByTestId("connection-status")).toHaveAttribute("aria-label", "Connected");
});

test("Chinese workbench uses compact type and a small brand mark", async ({ page }, testInfo) => {
	await openWorkspaceChat(page);
	await page.getByTestId("open-settings").click();
	await page.getByTestId("settings-nav-language").click();
	await page.getByTestId("language-zh-CN").click();
	try {
		await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
		await expect(page.getByTestId("settings-nav-language")).toHaveCSS("font-size", "13px");
		await page
			.getByTestId("settings-dialog")
			.getByRole("button", { name: "关闭", exact: true })
			.click();
		await expect(page.getByTestId("brand-logo")).toHaveCSS("width", "20px");
		await runInTerminal(page, "PS1='kcode@local % ' PROMPT='kcode@local % '; clear");
		await expect(visibleTerminalScreen(page)).toContainText("kcode@local");
		await page.screenshot({ path: testInfo.outputPath("kcode-compact-zh.png") });
	} finally {
		await page.getByTestId("open-settings").click();
		await page.getByTestId("settings-nav-language").click();
		await page.getByTestId("language-system").click();
	}
});
