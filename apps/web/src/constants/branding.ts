export const PRODUCT_NAME = "KCode";
export const APP_SLUG = "thinkrail";
export const STORAGE_PREFIX = `${APP_SLUG}-`;
export const DND_FILE_MIME = `application/x-${APP_SLUG}-file`;
export const EVENT_PREFIX = `${APP_SLUG}:`;

export const BRAND_MARK_SEGMENTS = {
	stem: "M112 128H176V384H112Z",
	upper: "M192 240L320 128H400L272 256Z",
	lower: "M192 272L272 256L400 384H320Z",
} as const;

export const BRAND_MARK_PATH = Object.values(BRAND_MARK_SEGMENTS).join("");
