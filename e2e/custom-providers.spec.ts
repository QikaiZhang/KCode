import { expect, test } from "@playwright/test";
import { openAppFresh } from "./fixtures/app";

test.afterEach(async ({ page }) => {
	if (page.isClosed()) return;
	if (!(await page.getByTestId("settings-dialog").isVisible()))
		await page.getByTestId("open-settings").click();
	await page.getByTestId("settings-nav-language").click();
	await page.getByTestId("language-system").click();
	await expect(page.locator("html")).toHaveAttribute("lang", "en");
});

test("custom provider settings save, edit without re-entering the secret, and remove pi models", async ({
	page,
}, testInfo) => {
	await openAppFresh(page);
	await page.getByTestId("open-settings").click();
	await page.getByTestId("custom-provider-add").click();
	await page.getByTestId("custom-provider-id").fill("kcode-e2e");
	await page.getByTestId("custom-provider-name").fill("Personal gateway");
	await page.getByTestId("custom-provider-baseUrl").fill("http://127.0.0.1:9999/v1");
	await expect(page.getByTestId("custom-provider-apiKey")).toHaveAttribute("type", "password");
	await page.getByTestId("custom-provider-apiKey").fill("fixture-secret-only");
	await page.getByTestId("custom-provider-models").fill("personal-model");
	await page.getByTestId("custom-provider-save").click();
	const row = page.locator('[data-testid="custom-provider-row"][data-provider="kcode-e2e"]');
	await expect(row).toContainText("Personal gateway");
	await expect(page.getByTestId("custom-provider-apiKey")).toHaveCount(0);
	await row.getByRole("button", { name: "Edit", exact: true }).click();
	await expect(page.getByTestId("custom-provider-apiKey")).toHaveValue("");
	await expect(page.getByTestId("custom-provider-models")).toHaveValue("personal-model");
	await page.getByTestId("custom-provider-name").fill("KCode local models");
	await page.getByTestId("custom-provider-models").fill("personal-model\nsecond-model");
	await page.getByTestId("custom-provider-save").click();
	await expect(row).toContainText("KCode local models");
	await page
		.getByTestId("settings-dialog")
		.screenshot({ path: testInfo.outputPath("kcode-providers.png") });
	await row.getByRole("button", { name: "Delete", exact: true }).click();
	await expect(row).toHaveCount(0);
});

test("Simplified Chinese includes the custom provider form and KCode identity", async ({
	page,
}, testInfo) => {
	await openAppFresh(page);
	await expect(page).toHaveTitle("KCode");
	await page.getByTestId("open-settings").click();
	await page.getByTestId("settings-nav-language").click();
	await page.getByTestId("language-zh-CN").click();
	await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
	await page.getByTestId("settings-nav-providers").click();
	await page.getByTestId("custom-provider-add").click();
	await expect(page.getByTestId("custom-providers")).toContainText("自定义供应商");
	await page.getByTestId("custom-provider-id").fill("kcode-local");
	await page.getByTestId("custom-provider-name").fill("我的模型服务");
	await page.getByTestId("custom-provider-baseUrl").fill("http://localhost:11434/v1");
	await page.getByTestId("custom-provider-models").fill("qwen3-coder");
	await page.getByTestId("custom-provider-save").scrollIntoViewIfNeeded();
	await page
		.getByTestId("settings-dialog")
		.screenshot({ path: testInfo.outputPath("kcode-providers-zh.png") });
});
