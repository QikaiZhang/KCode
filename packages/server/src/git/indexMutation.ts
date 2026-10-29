import { realpathSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { CodedError } from "@thinkrail/shared/codedError";
import { git } from "./gitExec";

const active = new Set<string>();

function indexKey(cwd: string): string | null {
	const result = git(cwd, ["rev-parse", "--git-path", "index"]);
	if (!result.ok || !result.out) return null;
	const file = resolve(cwd, result.out);
	try {
		return resolve(realpathSync(dirname(file)), basename(file));
	} catch {
		return null;
	}
}

export function indexMutationActive(cwd: string): boolean {
	const key = indexKey(cwd);
	return key === null || active.has(key);
}

export async function withIndexMutation<T>(cwd: string, run: () => Promise<T>): Promise<T> {
	const key = indexKey(cwd);
	if (key === null) throw new CodedError("GIT_OPERATION_FAILED", "Could not locate the Git index.");
	if (active.has(key)) throw new CodedError("GIT_BUSY", "Another Git operation is running.");
	active.add(key);
	try {
		return await run();
	} finally {
		active.delete(key);
	}
}
