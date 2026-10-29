import { afterEach, beforeEach, expect, test } from "bun:test";
import {
	chmodSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	renameSync,
	rmSync,
	symlinkSync,
	utimesSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gitCommitPaths } from "./git";
import { withIndexMutation } from "./indexMutation";
import {
	commitSourceIndex,
	sourceControlDiff,
	sourceControlStatus,
	stageSourcePaths,
} from "./sourceControl";

let root: string;
let repo: string;
const previous = process.env.THINKRAIL_DATA_DIR;
function git(...args: string[]): string {
	const result = Bun.spawnSync(["git", "-C", repo, ...args], { stdout: "pipe", stderr: "pipe" });
	if (!result.success) throw new Error(result.stderr.toString());
	return result.stdout.toString().trim();
}
beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "kcode-source-control-"));
	repo = join(root, "repo");
	mkdirSync(repo);
	process.env.THINKRAIL_DATA_DIR = root;
	git("init", "-b", "main");
	git("config", "commit.gpgsign", "false");
	git("config", "core.hooksPath", join(repo, ".git", "hooks"));
	git("config", "user.name", "Fixture");
	git("config", "user.email", "fixture@example.invalid");
	writeFileSync(
		join(root, "workspaces.json"),
		JSON.stringify([
			{
				id: "w1",
				projectId: "p1",
				name: "Fixture",
				branch: "main",
				baseBranch: "main",
				worktreePath: repo,
				createdAt: 1,
			},
		]),
	);
});
afterEach(() => {
	if (previous === undefined) delete process.env.THINKRAIL_DATA_DIR;
	else process.env.THINKRAIL_DATA_DIR = previous;
	rmSync(root, { recursive: true, force: true });
});
async function stage(paths: string[], staged = true) {
	return stageSourcePaths("w1", paths, staged, (await sourceControlStatus("w1")).fingerprint);
}
async function commit(message = "Fixture commit") {
	return commitSourceIndex("w1", message, (await sourceControlStatus("w1")).fingerprint);
}
function seed() {
	writeFileSync(join(repo, "a.txt"), "base\n");
	git("add", "a.txt");
	git("commit", "-m", "seed");
}

test("an unborn repository can stage, unstage and commit only the chosen literal files", async () => {
	writeFileSync(join(repo, "[literal].txt"), "literal\n");
	writeFileSync(join(repo, "keep.txt"), "keep\n");
	const first = await sourceControlStatus("w1");
	expect(first.head).toBeNull();
	expect(first.branch).toBe("main");
	await stage(["[literal].txt"]);
	expect((await sourceControlStatus("w1")).staged.map((f) => f.path)).toEqual(["[literal].txt"]);
	await stage(["[literal].txt"], false);
	expect(readFileSync(join(repo, "[literal].txt"), "utf8")).toBe("literal\n");
	await stage(["[literal].txt"]);
	const result = await commit();
	expect(result.sha).toBe(git("rev-parse", "HEAD"));
	expect(git("ls-tree", "--name-only", "HEAD")).toBe("[literal].txt");
	expect(result.status.unstaged.map((f) => f.path)).toEqual(["keep.txt"]);
});

test("partly staged files preview the real index and commit leaves later worktree edits intact", async () => {
	seed();
	writeFileSync(join(repo, "a.txt"), "staged\n");
	await stage(["a.txt"]);
	writeFileSync(join(repo, "a.txt"), "working\n");
	const staged = await sourceControlDiff("w1", "a.txt", true);
	const working = await sourceControlDiff("w1", "a.txt", false);
	expect(staged.original).toBe("base\n");
	expect(staged.modified).toBe("staged\n");
	expect(working.original).toBe("staged\n");
	expect(working.modified).toBe("working\n");
	await commit();
	expect(git("show", "HEAD:a.txt")).toBe("staged");
	expect(readFileSync(join(repo, "a.txt"), "utf8")).toBe("working\n");
	expect((await sourceControlStatus("w1")).unstaged.map((f) => f.path)).toEqual(["a.txt"]);
});

test("stale index and branch views cannot commit unreviewed changes", async () => {
	seed();
	writeFileSync(join(repo, "a.txt"), "edit\n");
	await stage(["a.txt"]);
	const before = await sourceControlStatus("w1");
	writeFileSync(join(repo, "other.txt"), "outside selection\n");
	git("add", "other.txt");
	await expect(commitSourceIndex("w1", "stale", before.fingerprint)).rejects.toMatchObject({
		code: "STALE_VIEW",
	});
	const next = await sourceControlStatus("w1");
	git("switch", "-c", "different");
	await expect(commitSourceIndex("w1", "wrong branch", next.fingerprint)).rejects.toMatchObject({
		code: "STALE_VIEW",
	});
	expect(git("log", "-1", "--format=%s")).toBe("seed");
});

test("path selection rejects traversals and unstage preserves worktree deletions andrenamed file.txtfiles", async () => {
	seed();
	renameSync(join(repo, "a.txt"), join(repo, "renamed file.txt"));
	await expect(
		stageSourcePaths("w1", ["../outside"], true, (await sourceControlStatus("w1")).fingerprint),
	).rejects.toMatchObject({ code: "STALE_VIEW" });
	await stage(["a.txt", "renamed file.txt"]);
	await stage(["a.txt", "renamed file.txt"], false);
	expect(existsSync(join(repo, "a.txt"))).toBe(false);
	expect(readFileSync(join(repo, "renamed file.txt"), "utf8")).toBe("base\n");
	expect((await sourceControlStatus("w1")).staged).toEqual([]);
});

test("hooks run and a rejected commit keeps the staged files available", async () => {
	seed();
	writeFileSync(join(repo, "a.txt"), "edit\n");
	await stage(["a.txt"]);
	const hook = join(repo, ".git", "hooks", "pre-commit");
	writeFileSync(hook, "#!/bin/sh\nexit 1\n");
	chmodSync(hook, 0o755);
	await expect(commit()).rejects.toMatchObject({ code: "GIT_OPERATION_FAILED" });
	expect((await sourceControlStatus("w1")).staged.map((f) => f.path)).toEqual(["a.txt"]);
	expect(git("log", "-1", "--format=%s")).toBe("seed");
});

test("manual index writes exclude TODO save/restore and other manual writers", async () => {
	seed();
	writeFileSync(join(repo, "a.txt"), "edit\n");
	let release = () => {};
	const gate = new Promise<void>((resolve) => {
		release = resolve;
	});
	const pending = withIndexMutation(repo, () => gate);
	expect(gitCommitPaths("w1", "auto", ["a.txt"])).toBeNull();
	await expect(stage(["a.txt"])).rejects.toMatchObject({ code: "GIT_BUSY" });
	release();
	await pending;
	await stage(["a.txt"]);
	expect((await sourceControlStatus("w1")).staged).toHaveLength(1);
});

test("conflicts block commits until the resolved file is staged", async () => {
	seed();
	git("switch", "-c", "side");
	writeFileSync(join(repo, "a.txt"), "side\n");
	git("commit", "-am", "side");
	git("switch", "main");
	writeFileSync(join(repo, "a.txt"), "main\n");
	git("commit", "-am", "main");
	const merge = Bun.spawnSync(["git", "-C", repo, "merge", "side"], {
		stdout: "pipe",
		stderr: "pipe",
	});
	expect(merge.exitCode).toBe(1);
	expect((await sourceControlStatus("w1")).conflicts).toEqual(["a.txt"]);
	await expect(commit()).rejects.toMatchObject({ code: "GIT_CONFLICT" });
	writeFileSync(join(repo, "a.txt"), "resolved\n");
	await stage(["a.txt"]);
	await commit("resolve");
	expect(git("show", "HEAD:a.txt")).toBe("resolved");
});

test("binary and large files remain stageable without text previews", async () => {
	writeFileSync(join(repo, "binary.bin"), new Uint8Array([0, 255, 0]));
	writeFileSync(join(repo, "large.txt"), "x".repeat(1024 * 1024 + 1));
	expect((await sourceControlDiff("w1", "binary.bin", false)).isText).toBe(false);
	expect((await sourceControlDiff("w1", "large.txt", false)).isText).toBe(false);
	await stage(["binary.bin", "large.txt"]);
	expect((await sourceControlStatus("w1")).staged).toHaveLength(2);
});

test("index stat-cache refreshes do not invalidate the reviewed staged content", async () => {
	seed();
	writeFileSync(join(repo, "a.txt"), "staged\n");
	await stage(["a.txt"]);
	const before = await sourceControlStatus("w1");
	const future = new Date(Date.now() + 2000);
	utimesSync(join(repo, "a.txt"), future, future);
	git("update-index", "--refresh");
	await commitSourceIndex("w1", "same staged content", before.fingerprint);
	expect(git("show", "HEAD:a.txt")).toBe("staged");
});

test.skipIf(process.platform === "win32")(
	"symlink previews show the link rather than reading outside the worktree",
	async () => {
		const outside = join(root, "outside.txt");
		writeFileSync(outside, "private-fixture-content");
		symlinkSync(outside, join(repo, "link.txt"));
		const preview = await sourceControlDiff("w1", "link.txt", false);
		expect(preview.modified).toBe(outside);
		expect(preview.modified).not.toContain("private-fixture-content");
	},
);

test.skipIf(process.platform === "win32")(
	"index previews treat a stage-like filename as a literal path",
	async () => {
		writeFileSync(join(repo, "name.txt"), "other index entry\n");
		writeFileSync(join(repo, "0:name.txt"), "chosen index entry\n");
		await stage(["name.txt", "0:name.txt"]);
		const preview = await sourceControlDiff("w1", "0:name.txt", true);
		expect(preview.modified).toBe("chosen index entry\n");
	},
);
