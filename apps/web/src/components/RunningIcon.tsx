import { useT } from "@thinkrail/locales/react";
import { cn } from "@thinkrail/ui/utils";
import { useId } from "react";
import { BRAND_MARK_SEGMENTS } from "../constants/branding";

const FRAME_HALVES = [
	"M20 195 V110 A90 90 0 0 1 110 20 H650 A90 90 0 0 1 740 110 V552",
	"M20 225 V650 A90 90 0 0 0 110 740 H650 A90 90 0 0 0 740 650 V548",
] as const;

const STROKES: ReadonlyArray<{
	d: string;
	clip: keyof typeof BRAND_MARK_SEGMENTS;
	className: string;
}> = [
	{ d: "M144 128V384", clip: "stem", className: "motion-safe:animate-loader-t-bar" },
	{ d: "M224 256L360 128", clip: "upper", className: "motion-safe:animate-loader-t-stem" },
	{ d: "M224 256L360 384", clip: "lower", className: "motion-safe:animate-loader-r-tail" },
];

export function RunningIcon({ className }: { className?: string | undefined }) {
	const t = useT();
	const id = useId();
	const clipId = (name: string) => `${id}-${name}`;

	return (
		<span
			data-testid="running-icon"
			data-running="true"
			role="img"
			aria-label={t("components.runningIcon.label")}
			className={cn("inline-flex shrink-0 items-center justify-center", className)}
		>
			<svg aria-hidden="true" viewBox="0 0 760 760" className="size-full">
				<defs>
					{Object.entries(BRAND_MARK_SEGMENTS).map(([name, d]) => (
						<clipPath key={name} id={clipId(name)}>
							<path d={d} />
						</clipPath>
					))}
				</defs>
				{FRAME_HALVES.map((d) => (
					<path
						key={d}
						data-testid="running-icon-frame"
						d={d}
						fill="none"
						stroke="currentColor"
						strokeWidth="40"
						strokeLinejoin="round"
						strokeDasharray="1000 1000"
						pathLength="1000"
						className="motion-safe:animate-loader-frame"
					/>
				))}
				<g transform="translate(-126.7 -126.7) scale(1.98)">
					{STROKES.map((stroke) => (
						<path
							key={stroke.d}
							d={stroke.d}
							fill="none"
							stroke="currentColor"
							strokeWidth="80"
							strokeLinejoin="miter"
							strokeDasharray="1000 1000"
							pathLength="1000"
							clipPath={`url(#${clipId(stroke.clip)})`}
							className={stroke.className}
						/>
					))}
				</g>
			</svg>
		</span>
	);
}
