import { readFileSync } from "node:fs";

const GENERATED = readFileSync(
	new URL("../../apps/web/src/styles/generated/typography.css", import.meta.url),
	"utf8",
);

function preferredFace(id: string): string {
	const match = GENERATED.match(new RegExp(`--tr-font-family-${id}:\\s*([^,;]+)`));
	if (!match) throw new Error(`--tr-font-family-${id} is not in the generated typography CSS`);
	return (match[1] as string).trim().replace(/^"|"$/g, "");
}

export const INTERFACE_FACE = preferredFace("interface");
export const CODE_FACE = preferredFace("code");
export const BRAND_FACE = preferredFace("brand");

export const TERMINAL_FACE = preferredFace("terminal");
