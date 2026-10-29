import { RiAddLine, RiDeleteBinLine, RiEditLine } from "@remixicon/react";
import type { CustomProvider, CustomProviderInput } from "@thinkrail/contracts";
import { useT } from "@thinkrail/locales/react";
import { Button } from "@thinkrail/ui/button";
import { useEffect, useState } from "react";
import { getTransport } from "@/transport";
import { SettingsGroup } from "./SettingsGroup";

const INPUT_CLASS =
	"w-full min-w-0 rounded-sm border border-control-border-default bg-control-bg px-8 py-4 tr-code-text text-text-default outline-none focus-visible:border-control-border-active";
const EMPTY: CustomProviderInput = {
	id: "kcode-",
	name: "",
	baseUrl: "",
	api: "openai-completions",
	models: [],
	apiKey: "",
};
type Draft = { provider: CustomProviderInput; modelText: string; create: boolean };

export function CustomProvidersSettings() {
	const t = useT();
	const [providers, setProviders] = useState<CustomProvider[] | null>(null);
	const [draft, setDraft] = useState<Draft | null>(null);
	const [busy, setBusy] = useState(false);
	const [failed, setFailed] = useState(false);
	const load = async () => {
		setFailed(false);
		try {
			setProviders(await getTransport().request("provider.customList", {}));
		} catch {
			setFailed(true);
		}
	};
	useEffect(() => {
		let active = true;
		getTransport()
			.request("provider.customList", {})
			.then((result) => {
				if (active) setProviders(result);
			})
			.catch(() => {
				if (active) setFailed(true);
			});
		return () => {
			active = false;
		};
	}, []);
	const save = () => {
		if (!draft) return;
		setBusy(true);
		setFailed(false);
		const provider = {
			...draft.provider,
			models: draft.modelText
				.split(/\r?\n/)
				.map((id) => id.trim())
				.filter(Boolean),
		};
		void getTransport()
			.request("provider.customSave", { provider, create: draft.create })
			.then((result) => {
				setProviders(result);
				setDraft(null);
			})
			.catch(() => setFailed(true))
			.finally(() => setBusy(false));
	};
	const remove = (id: string) => {
		setBusy(true);
		setFailed(false);
		void getTransport()
			.request("provider.customRemove", { id })
			.then(setProviders)
			.catch(() => setFailed(true))
			.finally(() => setBusy(false));
	};
	const update = (patch: Partial<CustomProviderInput>) =>
		setDraft((current) =>
			current ? { ...current, provider: { ...current.provider, ...patch } } : null,
		);
	return (
		<SettingsGroup
			title={t("settings.customProviders.title")}
			description={t("settings.customProviders.description")}
			testId="custom-providers"
		>
			<div className="flex flex-col gap-12 py-12">
				{failed ? (
					<p role="alert" className="tr-text-ui text-feedback-error">
						{t("settings.customProviders.failed")}{" "}
						<Button variant="ghost" size="s" onClick={() => void load()}>
							{t("settings.providers.refresh")}
						</Button>
					</p>
				) : null}
				{providers?.map((provider) => (
					<div
						key={provider.id}
						className="flex items-center gap-8"
						data-testid="custom-provider-row"
						data-provider={provider.id}
					>
						<div className="min-w-0 flex-1">
							<p className="tr-text-ui text-text-default">{provider.name}</p>
							<p className="truncate tr-text-metadata text-text-muted">{provider.baseUrl}</p>
						</div>
						<Button
							variant="ghost"
							size="s"
							iconLeft={RiEditLine}
							disabled={busy || draft !== null}
							onClick={() => {
								setFailed(false);
								setDraft({
									provider: {
										id: provider.id,
										name: provider.name,
										baseUrl: provider.baseUrl,
										api: provider.api,
										models: provider.models,
										apiKey: "",
									},
									modelText: provider.models.join("\n"),
									create: false,
								});
							}}
						>
							{t("common.edit")}
						</Button>
						<Button
							variant="ghost"
							size="s"
							iconLeft={RiDeleteBinLine}
							disabled={busy || draft !== null}
							onClick={() => void remove(provider.id)}
						>
							{t("common.delete")}
						</Button>
					</div>
				))}
				{draft ? (
					<form
						onSubmit={(event) => {
							event.preventDefault();
							void save();
						}}
					>
						<fieldset disabled={busy} className="flex flex-col gap-12">
							{(
								[
									["id", "settings.customProviders.id"],
									["name", "settings.customProviders.name"],
									["baseUrl", "settings.customProviders.baseUrl"],
									["apiKey", "settings.customProviders.apiKey"],
								] as const
							).map(([field, key]) => (
								<label key={field} className="flex flex-col gap-4 tr-text-ui text-text-default">
									{t(key)}
									<input
										data-testid={`custom-provider-${field}`}
										data-settings-draft-input
										className={INPUT_CLASS}
										type={field === "apiKey" ? "password" : field === "baseUrl" ? "url" : "text"}
										autoComplete="off"
										spellCheck={false}
										required={field !== "apiKey"}
										disabled={field === "id" && !draft.create}
										value={draft.provider[field] ?? ""}
										onChange={(event) => update({ [field]: event.currentTarget.value })}
									/>
								</label>
							))}
							<div className="flex gap-8">
								{(["openai-completions", "openai-responses"] as const).map((api) => (
									<Button
										key={api}
										variant={draft.provider.api === api ? "soft-primary" : "outline"}
										size="s"
										aria-pressed={draft.provider.api === api}
										onClick={() => update({ api })}
									>
										{t(
											api === "openai-completions"
												? "settings.customProviders.completions"
												: "settings.customProviders.responses",
										)}
									</Button>
								))}
							</div>
							<label className="flex flex-col gap-4 tr-text-ui text-text-default">
								{t("settings.customProviders.models")}
								<textarea
									data-testid="custom-provider-models"
									data-settings-draft-input
									className={INPUT_CLASS}
									rows={4}
									required
									value={draft.modelText}
									onChange={(event) => setDraft({ ...draft, modelText: event.currentTarget.value })}
								/>
							</label>
							<p className="tr-text-metadata text-text-muted">
								{t("settings.customProviders.note")}
							</p>
							<div className="flex gap-8">
								<Button type="submit" size="m" data-testid="custom-provider-save" loading={busy}>
									{t("common.save")}
								</Button>
								<Button
									variant="ghost"
									size="m"
									onClick={() => {
										setDraft(null);
										setFailed(false);
									}}
								>
									{t("common.cancel")}
								</Button>
							</div>
						</fieldset>
					</form>
				) : (
					<Button
						variant="outline"
						size="m"
						iconLeft={RiAddLine}
						data-testid="custom-provider-add"
						disabled={busy || providers === null}
						onClick={() => {
							setFailed(false);
							setDraft({ provider: { ...EMPTY }, modelText: "", create: true });
						}}
					>
						{t("settings.customProviders.add")}
					</Button>
				)}
			</div>
		</SettingsGroup>
	);
}
