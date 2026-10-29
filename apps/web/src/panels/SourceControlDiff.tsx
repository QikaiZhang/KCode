import type { SourceControlDiff as DiffData } from "@thinkrail/contracts";
import { useT } from "@thinkrail/locales/react";
import {
	describeResource,
	diffResourceMeta,
	GuardedRendererDiff,
	resourceContent,
	surfaceLineCount,
	useRendererSelection,
} from "@thinkrail/resource-renderers";
import { Button } from "@thinkrail/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@thinkrail/ui/dialog";
import { LoadingRegion } from "@thinkrail/ui/skeleton";
import { Suspense, useMemo, useState } from "react";
import { getTransport } from "@/transport";
import { useWorkspaceRead } from "./useWorkspaceRead";

function Preview({
	workspaceId,
	path,
	data,
}: {
	workspaceId: string;
	path: string;
	data: DiffData;
}) {
	const resource = useMemo(
		() =>
			describeResource(workspaceId, path, diffResourceMeta(data.meta.original, data.meta.modified)),
		[workspaceId, path, data],
	);
	const { renderer, implementationKey } = useRendererSelection(resource, "diff", "thinkrail/code");
	const original = useMemo(
		() => resourceContent(data.original, data.meta.original, () => null),
		[data],
	);
	const modified = useMemo(
		() => resourceContent(data.modified, data.meta.modified, () => null),
		[data],
	);
	return (
		<Suspense fallback={<LoadingRegion rows={6} />}>
			<GuardedRendererDiff
				resource={resource}
				original={original}
				modified={modified}
				renderer={renderer}
				implementationKey={implementationKey}
				layout="split"
				ignoreWhitespace={false}
				lineCount={surfaceLineCount(original, modified)}
			/>
		</Suspense>
	);
}

export function SourceControlDiff({
	workspaceId,
	path,
	staged,
	fingerprint,
	onClose,
	onToggleStage,
	disabled,
}: {
	workspaceId: string;
	path: string;
	staged: boolean;
	fingerprint: string;
	onClose: () => void;
	onToggleStage: () => void;
	disabled: boolean;
}) {
	const t = useT();
	const [data, setData] = useState<DiffData | null>(null);
	const [failed, setFailed] = useState(false);
	useWorkspaceRead(
		workspaceId,
		(id) => getTransport().request("git.sourceDiff", { workspaceId: id, path, staged }),
		{
			onResult: (result) => {
				setData(result);
				setFailed(false);
			},
			onFailure: () => setFailed(true),
			onSwitch: () => {
				setData(null);
				setFailed(false);
			},
		},
		`${staged}:${path}:${fingerprint}`,
	);

	return (
		<Dialog
			open
			onOpenChange={(open) => {
				if (!open) onClose();
			}}
		>
			<DialogContent
				className="flex h-[80vh] w-[95vw] max-w-[1100px] flex-col"
				data-testid="source-control-diff"
			>
				<DialogHeader>
					<DialogTitle>{path}</DialogTitle>
					<DialogDescription>
						{t(staged ? "git.source.stagedDiff" : "git.source.unstagedDiff")}
					</DialogDescription>
				</DialogHeader>
				<div className="min-h-0 flex-1 overflow-auto">
					{failed ? (
						<p role="alert" className="tr-text-ui text-feedback-error">
							{t("git.source.diffFailed")}
						</p>
					) : data ? (
						data.isText &&
						(data.meta.original.hash !== null || data.meta.modified.hash !== null) ? (
							<Preview workspaceId={workspaceId} path={path} data={data} />
						) : (
							<p className="tr-text-ui text-text-muted">{t("git.source.noPreview")}</p>
						)
					) : (
						<LoadingRegion rows={8} />
					)}
				</div>
				<DialogFooter>
					<Button
						data-testid="source-diff-toggle-stage"
						disabled={disabled || data === null || failed}
						onClick={onToggleStage}
					>
						{t(staged ? "git.source.unstageSelected" : "git.source.stageSelected")}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
