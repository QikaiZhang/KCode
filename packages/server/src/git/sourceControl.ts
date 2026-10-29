import { createHash } from "node:crypto";
import { lstatSync, mkdtempSync, readFileSync, readlinkSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
	GitFileChange,
	GitFileStatus,
	SourceControlDiff,
	SourceControlStatus,
} from "@thinkrail/contracts";
import { CodedError } from "@thinkrail/shared/codedError";
import { decodeText, resolveWorktreeFile, resourceMeta } from "../fs";
import { loadWorkspaces } from "../persistence";
import { readBlobBytesAtAsync, readBlobSizeAtAsync } from "./git";
import { gitAsync } from "./gitExec";
import { withIndexMutation } from "./indexMutation";

const CONFLICTS = new Set(["DD", "AU", "UD", "UA", "DU", "AA", "UU"]);
const PREVIEW_LIMIT = 1024 * 1024;

function cwdOf(workspaceId: string): string {
	const workspace = loadWorkspaces().find((entry) => entry.id === workspaceId);
	if (!workspace) throw new CodedError("GIT_INVALID_INPUT", "Unknown workspace.");
	return workspace.worktreePath;
}

async function run(cwd: string, args: string[], raw = false): Promise<string> {
	const result = await gitAsync(cwd, args, {
		raw,
		env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_OPTIONAL_LOCKS: "0" },
	});
	if (!result.ok)
		throw new CodedError("GIT_OPERATION_FAILED", result.err || "Git operation failed.");
	return result.out;
}

async function identity(
	cwd: string,
): Promise<Pick<SourceControlStatus, "branch" | "head" | "fingerprint">> {
	const [branch, head, entries, staged] = await Promise.all([
		run(cwd, ["branch", "--show-current"]),
		gitAsync(cwd, ["rev-parse", "--verify", "--quiet", "HEAD"]),
		run(cwd, ["ls-files", "--stage", "-z"], true),
		run(
			cwd,
			[
				"diff",
				"--cached",
				"--raw",
				"--no-abbrev",
				"--no-renames",
				"--ita-invisible-in-index",
				"-z",
			],
			true,
		),
	]);
	if (head.failure) throw new CodedError("GIT_OPERATION_FAILED", head.err);
	return {
		branch: branch || null,
		head: head.ok ? head.out : null,
		fingerprint: createHash("sha256")
			.update(branch)
			.update("\0")
			.update(head.ok ? head.out : "")
			.update("\0")
			.update(entries)
			.update("\0")
			.update(staged)
			.digest("hex"),
	};
}

function statusOf(code: string): GitFileStatus {
	if (code === "A") return "added";
	if (code === "D") return "deleted";
	return "modified";
}

async function statusAt(cwd: string): Promise<SourceControlStatus> {
	for (let attempt = 0; attempt < 3; attempt += 1) {
		const before = await identity(cwd);
		const raw = await run(
			cwd,
			["status", "--porcelain=v1", "-z", "--no-renames", "--untracked-files=all"],
			true,
		);
		const after = await identity(cwd);
		if (before.fingerprint !== after.fingerprint) continue;
		const staged: GitFileChange[] = [];
		const unstaged: GitFileChange[] = [];
		const conflicts: string[] = [];
		for (const record of raw.split("\0")) {
			if (record.length < 4) continue;
			const code = record.slice(0, 2);
			const path = record.slice(3);
			if (CONFLICTS.has(code)) {
				conflicts.push(path);
				unstaged.push({ path, status: "modified" });
				continue;
			}
			if (code === "??") {
				unstaged.push({ path, status: "untracked" });
				continue;
			}
			if (code[0] !== " ") staged.push({ path, status: statusOf(code[0] ?? "M") });
			if (code[1] !== " ") unstaged.push({ path, status: statusOf(code[1] ?? "M") });
		}
		return { ...after, staged, unstaged, conflicts };
	}
	throw new CodedError("STALE_VIEW", "Git changed while reading. Refresh and retry.");
}

export function sourceControlStatus(workspaceId: string): Promise<SourceControlStatus> {
	return statusAt(cwdOf(workspaceId));
}

function expectCurrent(status: SourceControlStatus, expected: string): void {
	if (status.fingerprint !== expected)
		throw new CodedError("STALE_VIEW", "Git changed. Review the latest staged files and retry.");
}

export function stageSourcePaths(
	workspaceId: string,
	paths: string[],
	staged: boolean,
	expected: string,
): Promise<SourceControlStatus> {
	if (
		!Array.isArray(paths) ||
		paths.length === 0 ||
		paths.length > 10000 ||
		typeof staged !== "boolean" ||
		paths.some((path) => typeof path !== "string" || path.includes("\0")) ||
		paths.join("").length > 1000000
	) {
		throw new CodedError("GIT_INVALID_INPUT", "Choose files to stage or unstage.");
	}
	const cwd = cwdOf(workspaceId);
	return withIndexMutation(cwd, async () => {
		const status = await statusAt(cwd);
		expectCurrent(status, expected);
		const allowed = new Set((staged ? status.unstaged : status.staged).map((entry) => entry.path));
		if (paths.some((path) => !allowed.has(path)))
			throw new CodedError("STALE_VIEW", "A selected file changed. Refresh and retry.");
		const folder = mkdtempSync(join(tmpdir(), "kcode-git-paths-"));
		const file = join(folder, "paths");
		try {
			writeFileSync(file, `${paths.join("\0")}\0`, { mode: 0o600 });
			const selection = [`--pathspec-from-file=${file}`, "--pathspec-file-nul"];
			await run(
				cwd,
				staged
					? ["--literal-pathspecs", "add", "-A", ...selection]
					: status.head
						? ["--literal-pathspecs", "reset", "--quiet", ...selection, "HEAD"]
						: ["--literal-pathspecs", "rm", "--cached", "-f", "--ignore-unmatch", ...selection],
			);
		} finally {
			rmSync(folder, { recursive: true, force: true });
		}
		return statusAt(cwd);
	});
}

export function commitSourceIndex(
	workspaceId: string,
	message: string,
	expected: string,
): Promise<{ sha: string; status: SourceControlStatus }> {
	if (typeof message !== "string" || !message.trim() || message.length > 10000)
		throw new CodedError("GIT_INVALID_INPUT", "Enter a commit message.");
	const cwd = cwdOf(workspaceId);
	return withIndexMutation(cwd, async () => {
		const status = await statusAt(cwd);
		expectCurrent(status, expected);
		if (status.conflicts.length)
			throw new CodedError("GIT_CONFLICT", "Resolve and stage conflicts before committing.");
		if (!status.staged.length)
			throw new CodedError("GIT_NOTHING_STAGED", "Stage at least one file before committing.");
		await run(cwd, ["commit", "-m", message.trim()]);
		const next = await statusAt(cwd);
		if (!next.head) throw new CodedError("GIT_OPERATION_FAILED", "Git did not report a commit.");
		return { sha: next.head, status: next };
	});
}

async function blob(
	cwd: string,
	ref: string,
	path: string,
): Promise<{ bytes: Uint8Array | null; available: boolean }> {
	const objectRef = ref === "" ? ":0" : ref;
	const size = await readBlobSizeAtAsync(cwd, objectRef, path);
	if (size !== null && size > PREVIEW_LIMIT) return { bytes: null, available: false };
	return {
		bytes: size === null ? null : await readBlobBytesAtAsync(cwd, objectRef, path),
		available: true,
	};
}

export async function sourceControlDiff(
	workspaceId: string,
	path: string,
	staged: boolean,
): Promise<SourceControlDiff> {
	const cwd = cwdOf(workspaceId);
	const status = await statusAt(cwd);
	if (
		!(staged ? status.staged : status.unstaged).some((entry) => entry.path === path) ||
		status.conflicts.includes(path)
	)
		throw new CodedError("STALE_VIEW", "That diff is no longer available.");
	const original = staged
		? status.head
			? await blob(cwd, status.head, path)
			: { bytes: null, available: true }
		: await blob(cwd, "", path);
	let modified: Awaited<ReturnType<typeof blob>>;
	if (staged) modified = await blob(cwd, "", path);
	else {
		const abs = resolveWorktreeFile(workspaceId, path, { followLeaf: false });
		try {
			const stat = lstatSync(abs);
			modified =
				stat.size > PREVIEW_LIMIT || stat.isDirectory()
					? { bytes: null, available: false }
					: {
							bytes: stat.isSymbolicLink()
								? new TextEncoder().encode(readlinkSync(abs))
								: readFileSync(abs),
							available: true,
						};
		} catch (error) {
			if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
			modified = { bytes: null, available: true };
		}
	}
	const meta = {
		original: resourceMeta(original.bytes, path),
		modified: resourceMeta(modified.bytes, path),
	};
	const isText =
		original.available && modified.available && meta.original.text && meta.modified.text;
	return {
		original: isText && original.bytes ? decodeText(original.bytes) : "",
		modified: isText && modified.bytes ? decodeText(modified.bytes) : "",
		isText,
		meta,
	};
}
