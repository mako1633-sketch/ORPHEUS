import { memo, useCallback, useEffect, useRef } from "react";
import type { RefObject } from "react";
import { fileURLToPath } from "node:url";
import type { DaemonAvatarRenderable } from "../../avatar/DaemonAvatarRenderable";
import { BANNER_GRADIENT, DAEMON_BANNER_LINES, useGlitchyBanner } from "../../hooks/use-glitchy-banner";
import { DaemonState } from "../../types";

const DAEMON_HOME_GIF_PATH = fileURLToPath(new URL("../../../img/daemon.gif", import.meta.url));
const DAEMON_GIF_ASPECT = 960 / 551;
const HOME_GIF_MIN_WIDTH = 72;
const HOME_GIF_MAX_WIDTH = 168;
const HOME_GIF_WIDTH_RATIO = 0.82;
const HOME_GIF_TOP_RESERVE_RATIO = 0.18;
const HOME_GIF_BOTTOM_RESERVE = 4;

export function calculateHomeGifLayout({
	viewportWidth,
	viewportHeight,
	showBanner,
}: {
	viewportWidth: number;
	viewportHeight: number;
	showBanner: boolean;
}): { width: number; height: number; top: number } {
	const safeViewportWidth = Math.max(1, Math.floor(viewportWidth));
	const safeViewportHeight = Math.max(1, Math.floor(viewportHeight));
	const topReserve = showBanner
		? Math.min(9, Math.floor(safeViewportHeight * HOME_GIF_TOP_RESERVE_RATIO))
		: 0;
	const availableHeight = Math.max(1, safeViewportHeight - topReserve - HOME_GIF_BOTTOM_RESERVE);
	const targetWidth = Math.floor(safeViewportWidth * HOME_GIF_WIDTH_RATIO);
	const maxWidthForViewport = Math.max(1, safeViewportWidth - 4);
	let nextWidth = Math.max(
		Math.min(HOME_GIF_MIN_WIDTH, maxWidthForViewport),
		Math.min(HOME_GIF_MAX_WIDTH, targetWidth, maxWidthForViewport)
	);
	let nextHeight = Math.max(1, Math.floor(nextWidth / DAEMON_GIF_ASPECT / 2));

	if (nextHeight > availableHeight) {
		nextHeight = availableHeight;
		nextWidth = Math.max(1, Math.min(maxWidthForViewport, Math.floor(nextHeight * 2 * DAEMON_GIF_ASPECT)));
	}

	const top = Math.max(0, topReserve + Math.floor((availableHeight - nextHeight) / 2));

	return { width: nextWidth, height: nextHeight, top };
}

export interface AvatarLayerProps {
	avatarRef: RefObject<DaemonAvatarRenderable | null>;
	daemonState: DaemonState;
	applyAvatarForState: (state: DaemonState) => void;
	width: number;
	height: number;
	viewportWidth?: number;
	viewportHeight?: number;
	zIndex?: number;
	showBanner?: boolean;
	animateBanner?: boolean;
	startupAnimationActive?: boolean;
}

function AvatarLayerImpl(props: AvatarLayerProps) {
	const {
		avatarRef,
		daemonState,
		applyAvatarForState,
		width,
		height,
		viewportWidth = width,
		viewportHeight = height,
		zIndex = 0,
		showBanner = false,
		animateBanner = false,
		startupAnimationActive = false,
	} = props;

	// Use glitchy banner animation when animateBanner is true
	const glitchyBanner = useGlitchyBanner(showBanner && animateBanner);

	// Determine which lines/colors to use
	const bannerLines = animateBanner ? glitchyBanner.lines : DAEMON_BANNER_LINES;
	const bannerColors = animateBanner ? glitchyBanner.colors : BANNER_GRADIENT;
	const bannerWidth = Math.max(...DAEMON_BANNER_LINES.map((line) => line.length));
	const showHomeGif = showBanner;
	const gifLayout = calculateHomeGifLayout({ viewportWidth, viewportHeight, showBanner });

	// Keep a stable callback ref so we don't detach/reattach on daemonState changes.
	const daemonStateRef = useRef(daemonState);
	const applyAvatarForStateRef = useRef(applyAvatarForState);
	const startupAnimationActiveRef = useRef(startupAnimationActive);

	useEffect(() => {
		daemonStateRef.current = daemonState;
	}, [daemonState]);
	useEffect(() => {
		applyAvatarForStateRef.current = applyAvatarForState;
	}, [applyAvatarForState]);
	useEffect(() => {
		startupAnimationActiveRef.current = startupAnimationActive;
	}, [startupAnimationActive]);

	const handleAvatarRef = useCallback(
		(ref: DaemonAvatarRenderable | null) => {
			if (ref === avatarRef.current) return;
			avatarRef.current = ref;
			if (!ref) return;

			applyAvatarForStateRef.current(daemonStateRef.current);
			if (startupAnimationActiveRef.current) {
				ref.resetSpawn();
			} else {
				ref.skipSpawn();
			}
		},
		[avatarRef]
	);

	useEffect(() => {
		const ref = avatarRef.current;
		if (!ref) return;
		if (startupAnimationActive) {
			ref.resetSpawn();
		} else {
			ref.skipSpawn();
		}
	}, [avatarRef, startupAnimationActive]);

	return (
		<>
			{showBanner && (
				<box
					position="absolute"
					top={5}
					left={0}
					width="100%"
					height={DAEMON_BANNER_LINES.length + 1}
					alignItems="center"
					justifyContent="center"
					zIndex={10}
				>
					<box flexDirection="column" width={bannerWidth}>
						{bannerLines.map((line, i) => (
							<text key={i}>
								<span fg={bannerColors[i]}>{line}</span>
							</text>
						))}
					</box>
				</box>
			)}
			{showHomeGif ? (
				<box
					position="absolute"
					top={gifLayout.top}
					left={0}
					width="100%"
					height={gifLayout.height}
					alignItems="center"
					justifyContent="center"
					zIndex={1}
				>
					<daemon-gif
						id="daemon-home-gif"
						live
						width={gifLayout.width}
						height={gifLayout.height}
						respectAlpha={true}
						src={DAEMON_HOME_GIF_PATH}
						frameStride={1}
					/>
				</box>
			) : (
				<box
					position="absolute"
					top={0}
					left={0}
					width="100%"
					height="100%"
					alignItems="center"
					justifyContent="center"
					zIndex={zIndex}
				>
					<daemon-avatar
						id="daemon-avatar"
						live
						width={width}
						height={height}
						respectAlpha={true}
						ref={handleAvatarRef}
					/>
				</box>
			)}
		</>
	);
}

export const AvatarLayer = memo(AvatarLayerImpl);
