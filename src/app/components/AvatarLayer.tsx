import { memo, useCallback, useEffect, useRef } from "react";
import type { RefObject } from "react";
import { fileURLToPath } from "node:url";
import type { DaemonAvatarRenderable } from "../../avatar/DaemonAvatarRenderable";
import { BANNER_GRADIENT, DAEMON_BANNER_LINES, useGlitchyBanner } from "../../hooks/use-glitchy-banner";
import { DaemonState } from "../../types";

const DAEMON_HOME_GIF_PATH = fileURLToPath(new URL("../../../img/daemon.gif", import.meta.url));
const DAEMON_GIF_ASPECT = 960 / 551;
const CHAT_GIF_MIN_WIDTH = 14;
const CHAT_GIF_MAX_WIDTH = 22;
const CHAT_GIF_WIDTH_RATIO = 0.12;
const CHAT_GIF_TOP = 4;
const CHAT_GIF_RIGHT = 2;

export function calculateChatGifLayout({
	viewportWidth,
	top = CHAT_GIF_TOP,
}: {
	viewportWidth: number;
	top?: number;
}): { width: number; height: number; top: number; right: number } {
	const safeViewportWidth = Math.max(1, Math.floor(viewportWidth));
	const targetWidth = Math.floor(safeViewportWidth * CHAT_GIF_WIDTH_RATIO);
	const maxWidthForViewport = Math.max(1, safeViewportWidth - CHAT_GIF_RIGHT - 2);
	const nextWidth = Math.max(
		Math.min(CHAT_GIF_MIN_WIDTH, maxWidthForViewport),
		Math.min(CHAT_GIF_MAX_WIDTH, targetWidth, maxWidthForViewport)
	);
	const nextHeight = Math.max(1, Math.floor(nextWidth / DAEMON_GIF_ASPECT / 2));

	return { width: nextWidth, height: nextHeight, top, right: CHAT_GIF_RIGHT };
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
	showCompactGif?: boolean;
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
		showCompactGif = false,
		animateBanner = false,
		startupAnimationActive = false,
	} = props;

	// Use glitchy banner animation when animateBanner is true
	const glitchyBanner = useGlitchyBanner(showBanner && animateBanner);

	// Determine which lines/colors to use
	const bannerLines = animateBanner ? glitchyBanner.lines : DAEMON_BANNER_LINES;
	const bannerColors = animateBanner ? glitchyBanner.colors : BANNER_GRADIENT;
	const bannerWidth = Math.max(...DAEMON_BANNER_LINES.map((line) => line.length));
	const chatGifLayout = calculateChatGifLayout({ viewportWidth, top: showBanner ? 9 : CHAT_GIF_TOP });
	const showChatGif = showBanner || showCompactGif;

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
			{!showBanner && (
				<>
					<box
						position="absolute"
						top={showChatGif ? viewportHeight + 1 : 0}
						left={0}
						width={showChatGif ? 1 : "100%"}
						height={showChatGif ? 1 : "100%"}
						alignItems="center"
						justifyContent="center"
						zIndex={zIndex}
					>
						<daemon-avatar
							id="daemon-avatar"
							live
							width={showChatGif ? 1 : width}
							height={showChatGif ? 1 : height}
							respectAlpha={true}
							ref={handleAvatarRef}
						/>
					</box>
					{showChatGif && (
						<box
							position="absolute"
							top={chatGifLayout.top}
							right={chatGifLayout.right}
							width={chatGifLayout.width}
							height={chatGifLayout.height}
							alignItems="center"
							justifyContent="center"
							zIndex={3}
						>
							<daemon-gif
								id="daemon-chat-gif"
								live
								width={chatGifLayout.width}
								height={chatGifLayout.height}
								respectAlpha={true}
								src={DAEMON_HOME_GIF_PATH}
								frameStride={1}
							/>
						</box>
					)}
				</>
			)}
			{showBanner && (
				<box
					position="absolute"
					top={chatGifLayout.top}
					right={chatGifLayout.right}
					width={chatGifLayout.width}
					height={chatGifLayout.height}
					alignItems="center"
					justifyContent="center"
					zIndex={1}
				>
					<daemon-gif
						id="daemon-startup-gif"
						live
						width={chatGifLayout.width}
						height={chatGifLayout.height}
						respectAlpha={true}
						src={DAEMON_HOME_GIF_PATH}
						frameStride={1}
					/>
				</box>
			)}
		</>
	);
}

export const AvatarLayer = memo(AvatarLayerImpl);
