import type { CustomProvider, CustomProviderInput } from "@thinkrail/contracts";
import { CodedError } from "@thinkrail/shared/codedError";
import { applyEdits, findNodeAtLocation, getNodeValue, modify, type Node } from "jsonc-parser";
import { usePiRuntime } from "./agentSessionManager";
import {
	modelsPath,
	parseConfig,
	publishModelsChange,
	readSource,
	serializeModelsEdit,
	writeModelsFile,
} from "./modelsConfig";

const FORMATTING = { formattingOptions: { insertSpaces: true, tabSize: 2, eol: "\n" } };
const LOCAL_KEY = "kcode-local-no-auth";
const ID = /^kcode-[a-z0-9][a-z0-9-]{0,63}$/;

function invalid(): never {
	throw new CodedError("CUSTOM_PROVIDER_INVALID", "Invalid custom provider configuration.");
}

function providersNode(root: Node | undefined): Node | undefined {
	if (root && root.type !== "object") invalid();
	const node = root && findNodeAtLocation(root, ["providers"]);
	if (node && node.type !== "object") invalid();
	return node;
}

function project(id: string, node: Node): CustomProvider | undefined {
	const raw = getNodeValue(node);
	if (
		!ID.test(id) ||
		!raw ||
		typeof raw !== "object" ||
		(raw.api !== "openai-completions" && raw.api !== "openai-responses") ||
		typeof raw.baseUrl !== "string" ||
		!Array.isArray(raw.models)
	)
		return undefined;
	return {
		id,
		name: typeof raw.name === "string" ? raw.name : id,
		baseUrl: raw.baseUrl,
		api: raw.api,
		models: raw.models.flatMap((model: unknown) =>
			model && typeof model === "object" && "id" in model && typeof model.id === "string"
				? [model.id]
				: [],
		),
		hasApiKey: typeof raw.apiKey === "string" && raw.apiKey.length > 0 && raw.apiKey !== LOCAL_KEY,
	};
}

export async function listCustomProviders(): Promise<CustomProvider[]> {
	const node = providersNode(parseConfig(readSource(modelsPath())));
	return (node?.children ?? []).flatMap((property) => {
		const [key, value] = property.children ?? [];
		if (!key || !value) return [];
		const provider = project(key.value, value);
		return provider ? [provider] : [];
	});
}

function validate(input: CustomProviderInput): void {
	if (
		!input ||
		typeof input.id !== "string" ||
		!ID.test(input.id) ||
		typeof input.name !== "string" ||
		!input.name.trim() ||
		input.name.length > 100 ||
		typeof input.baseUrl !== "string" ||
		input.baseUrl.length > 2048 ||
		(input.api !== "openai-completions" && input.api !== "openai-responses") ||
		!Array.isArray(input.models) ||
		input.models.length === 0 ||
		input.models.length > 100 ||
		input.models.some((id) => typeof id !== "string" || !id.trim() || id.length > 200) ||
		new Set(input.models).size !== input.models.length ||
		(input.apiKey !== undefined &&
			(typeof input.apiKey !== "string" ||
				input.apiKey.length > 8192 ||
				/^[!$]/.test(input.apiKey.trim())))
	)
		invalid();
	let url: URL;
	try {
		url = new URL(input.baseUrl);
	} catch {
		invalid();
	}
	if (
		!["https:", "http:"].includes(url.protocol) ||
		url.username ||
		url.password ||
		url.search ||
		url.hash
	)
		invalid();
}

export function saveCustomProvider(
	input: CustomProviderInput,
	create: boolean,
): Promise<CustomProvider[]> {
	validate(input);
	return edit((source, root) => {
		const path = ["providers", input.id];
		const existing = root && findNodeAtLocation(root, path);
		if (create ? existing !== undefined : !existing || !project(input.id, existing)) {
			throw new CodedError("CUSTOM_PROVIDER_CONFLICT", "Custom provider changed. Reload settings.");
		}
		let next = source;
		for (const [field, value] of Object.entries({
			name: input.name.trim(),
			baseUrl: input.baseUrl.replace(/\/+$/, ""),
			api: input.api,
		})) {
			next = applyEdits(next, modify(next, [...path, field], value, FORMATTING));
		}
		const oldModels = existing && findNodeAtLocation(existing, ["models"]);
		const models = input.models.map((id) => {
			const old = oldModels?.children?.find((m) => findNodeAtLocation(m, ["id"])?.value === id);
			return old ? getNodeValue(old) : { id };
		});
		next = applyEdits(next, modify(next, [...path, "models"], models, FORMATTING));
		const key = input.apiKey?.trim();
		if (key || create) {
			next = applyEdits(next, modify(next, [...path, "apiKey"], key || LOCAL_KEY, FORMATTING));
		}
		if (create)
			next = applyEdits(next, modify(next, [...path, "authHeader"], Boolean(key), FORMATTING));
		else if (key) next = applyEdits(next, modify(next, [...path, "authHeader"], true, FORMATTING));
		return next;
	});
}

export function removeCustomProvider(id: string): Promise<CustomProvider[]> {
	if (typeof id !== "string" || !ID.test(id)) invalid();
	return edit((source, root) => {
		const node = root && findNodeAtLocation(root, ["providers", id]);
		if (node && !project(id, node)) invalid();
		return node
			? applyEdits(source, modify(source, ["providers", id], undefined, FORMATTING))
			: source;
	});
}

function edit(
	patch: (source: string, root: Node | undefined) => string,
): Promise<CustomProvider[]> {
	return serializeModelsEdit(() =>
		usePiRuntime(async (runtime) => {
			const file = modelsPath();
			const original = readSource(file);
			const bom = original?.startsWith("\uFEFF") ? "\uFEFF" : "";
			const source = original?.slice(bom.length) ?? '{\n  "providers": {}\n}\n';
			const root = parseConfig(source);
			providersNode(root);
			const next = bom + patch(source, root);
			if (next !== original) {
				writeModelsFile(file, next);
				await runtime.refresh({ allowNetwork: false });
				publishModelsChange();
			}
			return listCustomProviders();
		}),
	);
}
