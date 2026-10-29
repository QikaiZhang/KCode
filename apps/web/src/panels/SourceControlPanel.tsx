import { RiAddLine, RiRefreshLine, RiSubtractLine, RiUploadCloud2Line } from "@remixicon/react";
import type { GitFileChange, SourceControlStatus } from "@thinkrail/contracts";
import { useT } from "@thinkrail/locales/react";
import { Button, IconButton } from "@thinkrail/ui/button";
import { cn } from "@thinkrail/ui/utils";
import { useState } from "react";
import { selectWorkspaceById, useAppStore } from "@/store";
import { errorText, getTransport, wsErrorCode } from "@/transport";
import { statusNameClass } from "./changesModel";
import { SourceControlDiff } from "./SourceControlDiff";
import { useBranchStatus } from "./useBranchStatus";
import { useShipRunner } from "./useShipRunner";
import { useWorkspaceRead } from "./useWorkspaceRead";

export function SourceControlPanel({
	workspaceId,
	message,
	onMessage,
	onCommitted,
}: {
	workspaceId: string;
	message: string;
	onMessage: (message: string) => void;
	onCommitted: () => void;
}) {
	const t = useT();
	const workspace = useAppStore((s) => selectWorkspaceById(s, workspaceId) ?? null);
	const connection = useAppStore((s) => s.status);
	const branch = useBranchStatus(workspace, connection);
	const [snapshot, setSnapshot] = useState<SourceControlStatus | null>(null);
	const [busy, setBusy] = useState(false);
	const [failure, setFailure] = useState<string | null>(null);
	const [selection, setSelection] = useState<{ path: string; staged: boolean } | null>(null);
	const { reload } = useWorkspaceRead(
		workspaceId,
		(id) => getTransport().request("git.sourceStatus", { workspaceId: id }),
		{ onResult: setSnapshot, onFailure: () => setFailure(t("git.source.loadFailed")) },
	);
	const refresh = () => {
		reload();
		branch.refreshBranchStatus();
	};
	const runner = useShipRunner({
		workspace,
		sessionId: null,
		openReview: null,
		review: branch.review,
		status: branch.status,
		noteOpenReview: branch.noteOpenReview,
		refresh,
	});
	const locked = busy || runner.busy || connection !== "connected";
	const fail = (error: unknown) => {
		const code = wsErrorCode(error);
		setSelection(null);
		setFailure(
			code === "STALE_VIEW"
				? t("git.source.stale")
				: code === "GIT_BUSY"
					? t("git.source.busy")
					: errorText(error),
		);
		reload();
	};
	const stage = (paths: string[], staged: boolean) => {
		if (!snapshot || locked || paths.length === 0) return;
		setBusy(true);
		setFailure(null);
		void getTransport()
			.request("git.sourceStage", { workspaceId, paths, staged, expect: snapshot.fingerprint })
			.then((result) => {
				setFailure(null);
				setSnapshot(result);
				setSelection(null);
				refresh();
			})
			.catch(fail)
			.finally(() => setBusy(false));
	};
	const commit = () => {
		if (!snapshot || locked || !message.trim()) return;
		setBusy(true);
		setFailure(null);
		void getTransport()
			.request(
				"git.sourceCommit",
				{ workspaceId, message, expect: snapshot.fingerprint },
				{ timeoutMs: 65000 },
			)
			.then((result) => {
				setFailure(null);
				setSnapshot(result.status);
				onCommitted();
				setSelection(null);
				refresh();
			})
			.catch(fail)
			.finally(() => setBusy(false));
	};
	const group = (files: GitFileChange[], staged: boolean) => (
		<section
			className="flex flex-col gap-4"
			data-testid={staged ? "source-staged" : "source-unstaged"}
		>
			<div className="flex items-center justify-between gap-8">
				<h3 className="tr-text-label-pill text-text-subtle">
					{t(staged ? "git.source.staged" : "git.source.unstaged", { count: files.length })}
				</h3>
				<Button
					variant="ghost"
					size="s"
					disabled={locked || files.length === 0}
					onClick={() =>
						stage(
							files.map((file) => file.path),
							!staged,
						)
					}
				>
					{t(staged ? "git.source.unstageAll" : "git.source.stageAll")}
				</Button>
			</div>
			{files.length ? (
				files.map((file) => (
					<div
						key={file.path}
						className="flex min-w-0 items-center gap-4"
						data-testid="source-file"
						data-path={file.path}
					>
						<button
							type="button"
							className={cn(
								"min-w-0 flex-1 truncate rounded-sm px-4 py-2 text-left tr-text-ui hover:bg-control-bg-hovered focus-visible:outline-primary",
								statusNameClass(file.status),
							)}
							disabled={snapshot?.conflicts.includes(file.path)}
							onClick={() => setSelection({ path: file.path, staged })}
							title={file.path}
						>
							{file.path}
						</button>
						<IconButton
							variant="ghost"
							size="s"
							icon={staged ? RiSubtractLine : RiAddLine}
							disabled={locked}
							label={t(staged ? "git.source.unstageFile" : "git.source.stageFile", {
								file: file.path,
							})}
							data-testid={staged ? "source-unstage-file" : "source-stage-file"}
							onClick={() => stage([file.path], !staged)}
						/>
					</div>
				))
			) : (
				<p className="tr-text-metadata text-text-muted">{t("git.source.emptyGroup")}</p>
			)}
		</section>
	);
	const canPush =
		branch.status?.hasOrigin === true &&
		Boolean(snapshot?.head) &&
		snapshot?.branch !== null &&
		workspace?.branch === snapshot?.branch;
	return (
		<div className="flex h-full min-h-0 flex-col" data-testid="source-control">
			<div className="flex shrink-0 items-center gap-8 border-b border-border-default px-12 py-8">
				<div className="min-w-0 flex-1">
					<h2 className="tr-text-ui text-text-default">{t("git.source.title")}</h2>
					<p className="truncate tr-code-text-small text-text-muted">
						{snapshot ? (snapshot.branch ?? t("git.source.detached")) : t("git.source.loading")}
					</p>
				</div>
				<IconButton
					icon={RiRefreshLine}
					variant="ghost"
					size="s"
					disabled={locked}
					label={t("git.source.refresh")}
					onClick={refresh}
				/>
			</div>
			<div className="flex min-h-0 flex-1 flex-col gap-12 overflow-auto p-8">
				{failure ? (
					<p role="alert" className="tr-text-ui text-feedback-error">
						{failure}
					</p>
				) : null}
				{snapshot ? (
					<>
						{snapshot.conflicts.length ? (
							<p className="tr-text-metadata text-feedback-error">{t("git.source.conflicts")}</p>
						) : null}
						{group(snapshot.unstaged, false)}
						{group(snapshot.staged, true)}
					</>
				) : (
					<p className="tr-text-ui text-text-muted">{t("git.source.loading")}</p>
				)}
			</div>
			<form
				className="flex shrink-0 flex-col gap-8 border-t border-border-default p-8"
				onSubmit={(event) => {
					event.preventDefault();
					commit();
				}}
			>
				<label className="flex flex-col gap-4 tr-text-ui text-text-default">
					{t("git.source.message")}
					<textarea
						data-testid="source-commit-message"
						rows={2}
						maxLength={10000}
						value={message}
						disabled={busy}
						onChange={(event) => onMessage(event.currentTarget.value)}
						placeholder={t("git.source.messagePlaceholder")}
						className="w-full min-w-0 resize-y rounded-sm border border-control-border-default bg-control-bg px-8 py-4 tr-text-ui text-text-default placeholder:text-text-muted focus-visible:border-control-border-active"
					/>
				</label>
				<div className="flex flex-wrap gap-8">
					<Button
						type="submit"
						size="m"
						data-testid="source-commit"
						loading={busy}
						disabled={
							locked ||
							!message.trim() ||
							!snapshot?.staged.length ||
							Boolean(snapshot?.conflicts.length)
						}
					>
						{t("git.source.commit")}
					</Button>
					<Button
						variant="outline"
						size="m"
						data-testid="source-push"
						tooltip={t("git.source.commitHint")}
						iconLeft={RiUploadCloud2Line}
						disabled={locked || !canPush}
						onClick={() => runner.run(branch.status?.published ? "push" : "publish")}
					>
						{t("git.source.push")}
					</Button>
				</div>
				{branch.status && !branch.status.hasOrigin ? (
					<p className="tr-text-metadata text-text-muted">{t("git.source.noRemote")}</p>
				) : null}
			</form>
			{selection && snapshot ? (
				<SourceControlDiff
					{...selection}
					workspaceId={workspaceId}
					fingerprint={snapshot.fingerprint}
					disabled={locked}
					onToggleStage={() => stage([selection.path], !selection.staged)}
					onClose={() => setSelection(null)}
				/>
			) : null}
			{runner.dialogs}
		</div>
	);
}
