import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InMemoryCredentialStore } from "@earendil-works/pi-ai";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { listCustomProviders, removeCustomProvider, saveCustomProvider } from "./customProviders";
import { setModelContextPublisher } from "./modelContext";
import { configurePiRuntime } from "./piRuntime";

let dir: string;
let prior: string | undefined;
let runtime: ModelRuntime;
const input = {
	id: "kcode-test",
	name: "Local gateway",
	baseUrl: "http://localhost:9999/v1",
	api: "openai-completions" as const,
	models: ["local-model"],
	apiKey: "fixture-secret",
};
beforeEach(async () => {
	dir = mkdtempSync(join(tmpdir(), "kcode-providers-"));
	prior = process.env.PI_CODING_AGENT_DIR;
	process.env.PI_CODING_AGENT_DIR = dir;
	runtime = await ModelRuntime.create({
		credentials: new InMemoryCredentialStore(),
		allowModelNetwork: false,
	});
	configurePiRuntime(runtime);
});
afterEach(() => {
	configurePiRuntime(null);
	setModelContextPublisher(null);
	if (prior === undefined) delete process.env.PI_CODING_AGENT_DIR;
	else process.env.PI_CODING_AGENT_DIR = prior;
	rmSync(dir, { recursive: true, force: true });
});
test("save exposes a secret-free catalog, refreshes pi, preserves keys on edit and removes models", async () => {
	let published = 0;
	setModelContextPublisher(() => {
		published += 1;
	});
	const result = await saveCustomProvider(input, true);
	expect(result[0]?.hasApiKey).toBe(true);
	expect(JSON.stringify(result)).not.toContain(input.apiKey);
	expect(runtime.getModel(input.id, "local-model")).toBeDefined();
	expect(runtime.getError()).toBeUndefined();
	await saveCustomProvider({ ...input, apiKey: "", models: ["second-model"] }, false);
	expect(readFileSync(join(dir, "models.json"), "utf8")).toContain(input.apiKey);
	expect(runtime.getModel(input.id, "second-model")).toBeDefined();
	await removeCustomProvider(input.id);
	expect(await listCustomProviders()).toEqual([]);
	expect(runtime.getModel(input.id, "second-model")).toBeUndefined();
	expect(published).toBe(3);
});
test("JSONC comments, unrelated providers and retained model settings survive concurrent edits", async () => {
	writeFileSync(
		join(dir, "models.json"),
		'\uFEFF{\n// keep me\n"providers":{"other":{"baseUrl":"http://other.invalid"},"kcode-test":{"api":"openai-completions","baseUrl":"http://localhost/v1","apiKey":"keep","models":[{"id":"local-model","contextWindow":32000}]}}}',
	);
	await Promise.all([
		saveCustomProvider({ ...input, apiKey: "" }, false),
		saveCustomProvider({ ...input, id: "kcode-second" }, true),
	]);
	const source = readFileSync(join(dir, "models.json"), "utf8");
	expect(source).toContain("// keep me");
	expect(source).toMatch(/"contextWindow":\s*32000/);
	expect(source).toContain('"other"');
	expect(source.startsWith("\uFEFF")).toBe(true);
	expect((await listCustomProviders()).length).toBe(2);
});
test("invalid endpoints, executable key references, duplicate ids and malformed files are refused", async () => {
	for (const patch of [
		{ baseUrl: "file:///tmp/api" },
		{ baseUrl: "https://user:secret@example.com" },
		{ apiKey: "!echo secret" },
		{ id: "openai" },
		{ models: [] },
		{ models: ["same", "same"] },
	]) {
		await expect(async () => saveCustomProvider({ ...input, ...patch }, true)).toThrow();
	}
	await saveCustomProvider(input, true);
	await expect(saveCustomProvider(input, true)).rejects.toThrow("changed");
	writeFileSync(join(dir, "models.json"), '{"providers": null}');
	await expect(saveCustomProvider(input, true)).rejects.toThrow();
	expect(readFileSync(join(dir, "models.json"), "utf8")).toBe('{"providers": null}');
});
test("an unauthenticated local Responses provider is usable in pi without exposing a key", async () => {
	await saveCustomProvider({ ...input, api: "openai-responses", apiKey: "" }, true);
	expect((await listCustomProviders())[0]?.hasApiKey).toBe(false);
	expect(runtime.getAvailableSnapshot().some((model) => model.provider === input.id)).toBe(true);
	expect(runtime.getError()).toBeUndefined();
});
