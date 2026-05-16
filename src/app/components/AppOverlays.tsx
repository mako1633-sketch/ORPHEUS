import { memo } from "react";
import { CommandPalette } from "../../components/CommandPalette";
import { DeviceMenu } from "../../components/DeviceMenu";
import { GroundingMenu } from "../../components/GroundingMenu";
import { HotkeysPane } from "../../components/HotkeysPane";
import { MemoryMenu } from "../../components/MemoryMenu";
import { ModelMenu } from "../../components/ModelMenu";
import { OnboardingOverlay } from "../../components/OnboardingOverlay";
import { OrpheusMenu, type OrpheusMenuItem } from "../../components/OrpheusMenu";
import { ProviderMenu } from "../../components/ProviderMenu";
import { SessionMenu } from "../../components/SessionMenu";
import { SettingsMenu } from "../../components/SettingsMenu";
import { ToolsMenu } from "../../components/ToolsMenu";
import { UrlMenu } from "../../components/UrlMenu";
import { useUrlMenuItems } from "../../hooks/use-url-menu-items";
import { useAppContext } from "../../state/app-context";
import { getDaemonManager } from "../../state/daemon-state";
import type { ContentBlock, ConversationMessage } from "../../types";

interface AppOverlaysProps {
	conversationHistory: ConversationMessage[];
	currentContentBlocks: ContentBlock[];
}

function AppOverlaysImpl({ conversationHistory, currentContentBlocks }: AppOverlaysProps) {
	const ctx = useAppContext();
	const { menus, device, settings, model, session, grounding, onboarding } = ctx;

	const urlMenuItems = useUrlMenuItems({
		conversationHistory,
		currentContentBlocks,
		latestGroundingMap: grounding.latestGroundingMap,
	});
	const {
		deviceCallbacks,
		settingsCallbacks,
		modelCallbacks,
		sessionCallbacks,
		groundingCallbacks,
		onboardingCallbacks,
	} = ctx;

	const handleOrpheusAction = (item: OrpheusMenuItem) => {
		const prompts: Record<string, string> = {
			startup:
				"Run the ORPHEUS startup protocol: check local health, git state, configuration, provider route, and summarize any issues with fixes.",
			security:
				"Run an ORPHEUS security scan for this local project and summarize actionable findings.",
			project:
				"Inspect the current ORPHEUS project setup and explain what is wired correctly or incorrectly.",
			task: "List active ORPHEUS tasks and identify any stale or incomplete work.",
			suggest:
				"Suggest the next best ORPHEUS maintenance or coding action based on the current repo state.",
			diff: "Review the current ORPHEUS git diff and call out risks, incomplete wiring, and missing tests.",
			ci: "Run local ORPHEUS CI checks (pre-push gate): typecheck, lint, format-check, and tests. Summarize failures and suggest fixes.",
			"github-triage":
				"Run ORPHEUS GitHub triage: check recent workflow failures, open issues, and PRs. Summarize actionable items.",
			shell: "Review ORPHEUS shell and CLI startup behavior for macOS compatibility issues.",
			status:
				"Show an ORPHEUS status dashboard with app health, tools, model provider, memory, and repo state.",
			briefing:
				"Show the ORPHEUS launch briefing: health, active coding task, executive items, memory state, and next suggested action.",
			"context-budget":
				"Check ORPHEUS context budget risk and tell me whether we should compact or persist task state before continuing.",
			"project-doctor":
				"Run the ORPHEUS project doctor for this repo: scripts, dependencies, git state, docs, validation, startup risks, and concrete fixes.",
			"github-publish":
				"Prepare a GitHub publish plan for this ORPHEUS repo with secret checks, README checks, commit/push approval gates, and verification steps.",
			"memory-control":
				"Open the ORPHEUS memory control center: show persistent context summary, editable actions, export option, and any stale memory risks.",
			scan: "Scan available ORPHEUS capabilities and local developer tools.",
			"scan-files":
				"Scan the ORPHEUS project files for anomalies, missing imports, stale artifacts, and incomplete wiring.",
			remediate:
				"Plan safe auto-remediation for the current ORPHEUS repo issues, asking before destructive changes.",
			diagnostics:
				"Run ORPHEUS runtime diagnostics: probe keyboard state, Ollama connectivity, app context, and system health. Report findings with fixes.",
		};
		const prompt = prompts[item.id] ?? item.description ?? item.label;
		menus.setShowOrpheusMenu(false);
		void getDaemonManager().submitText(prompt);
	};

	return (
		<>
			{menus.showDeviceMenu && (
				<DeviceMenu
					devices={device.devices}
					currentDevice={device.currentDevice}
					currentOutputDevice={device.currentOutputDevice}
					soxAvailable={device.soxAvailable}
					soxInstallHint={device.soxInstallHint}
					onClose={() => menus.setShowDeviceMenu(false)}
					onSelect={deviceCallbacks.onDeviceSelect}
					onOutputSelect={deviceCallbacks.onOutputDeviceSelect}
				/>
			)}

			{menus.showSettingsMenu && (
				<SettingsMenu
					interactionMode={settings.interactionMode}
					voiceInteractionType={settings.voiceInteractionType}
					speechSpeed={settings.speechSpeed}
					reasoningEffort={settings.reasoningEffort}
					bashApprovalLevel={settings.bashApprovalLevel}
					supportsReasoning={settings.supportsReasoning}
					supportsReasoningXHigh={settings.supportsReasoningXHigh}
					modelProvider={model.currentModelProvider}
					copilotAvailable={onboarding.copilotAuthenticated}
					canEnableVoiceOutput={settings.canEnableVoiceOutput}
					showFullReasoning={settings.showFullReasoning}
					showToolOutput={settings.showToolOutput}
					memoryEnabled={settings.memoryEnabled}
					onClose={() => menus.setShowSettingsMenu(false)}
					toggleInteractionMode={settingsCallbacks.onToggleInteractionMode}
					cycleModelProvider={settingsCallbacks.onCycleModelProvider}
					setVoiceInteractionType={settingsCallbacks.onSetVoiceInteractionType}
					setSpeechSpeed={settingsCallbacks.onSetSpeechSpeed}
					setReasoningEffort={settingsCallbacks.onSetReasoningEffort}
					setBashApprovalLevel={settingsCallbacks.onSetBashApprovalLevel}
					setShowFullReasoning={settings.setShowFullReasoning}
					setShowToolOutput={settings.setShowToolOutput}
					setMemoryEnabled={settings.setMemoryEnabled}
					persistPreferences={settings.persistPreferences}
				/>
			)}

			{menus.showModelMenu && (
				<ModelMenu
					curatedModels={model.curatedModels}
					allModels={model.openRouterModels}
					modelProvider={model.currentModelProvider}
					allModelsLoading={model.openRouterModelsLoading}
					allModelsUpdatedAt={model.openRouterModelsUpdatedAt}
					currentModelId={model.currentModelId}
					onClose={() => menus.setShowModelMenu(false)}
					onSelect={modelCallbacks.onModelSelect}
					onRefreshAllModels={modelCallbacks.onModelRefresh}
				/>
			)}

			{menus.showProviderMenu && model.currentModelProvider === "openrouter" && (
				<ProviderMenu
					items={model.providerMenuItems}
					currentProviderTag={model.currentOpenRouterProviderTag}
					modelId={model.currentModelId}
					onClose={() => menus.setShowProviderMenu(false)}
					onSelect={modelCallbacks.onProviderSelect}
				/>
			)}

			{menus.showSessionMenu && (
				<SessionMenu
					items={session.sessionMenuItems}
					currentSessionId={session.currentSessionId}
					onClose={() => menus.setShowSessionMenu(false)}
					onSelect={sessionCallbacks.onSessionSelect}
					onDelete={sessionCallbacks.onSessionDelete}
				/>
			)}

			{menus.showHotkeysPane && <HotkeysPane onClose={() => menus.setShowHotkeysPane(false)} />}

			{menus.showGroundingMenu && grounding.latestGroundingMap && (
				<GroundingMenu
					groundingMap={grounding.latestGroundingMap}
					initialIndex={grounding.groundingInitialIndex}
					onClose={() => menus.setShowGroundingMenu(false)}
					onSelect={groundingCallbacks.onGroundingSelect}
					onSelectedIndexChange={groundingCallbacks.onGroundingIndexChange}
				/>
			)}

			{menus.showUrlMenu && (
				<UrlMenu items={urlMenuItems} onClose={() => menus.setShowUrlMenu(false)} />
			)}

			{menus.showToolsMenu && (
				<ToolsMenu
					onClose={() => menus.setShowToolsMenu(false)}
					persistPreferences={(updates) => settings.persistPreferences(updates)}
				/>
			)}

			{menus.showMemoryMenu && <MemoryMenu onClose={() => menus.setShowMemoryMenu(false)} />}

			{menus.showCommandPalette && (
				<CommandPalette
					onClose={() => menus.setShowCommandPalette(false)}
					items={[
						{
							id: "device",
							label: "Devices",
							shortcut: "D",
							action: () => {
								menus.setShowCommandPalette(false);
								menus.setShowDeviceMenu(true);
							},
						},
						{
							id: "settings",
							label: "Settings",
							shortcut: "S",
							action: () => {
								menus.setShowCommandPalette(false);
								menus.setShowSettingsMenu(true);
							},
						},
						{
							id: "model",
							label: "Models",
							shortcut: "M",
							action: () => {
								menus.setShowCommandPalette(false);
								menus.setShowModelMenu(true);
							},
						},
						{
							id: "provider",
							label: "Providers",
							shortcut: "P",
							action: () => {
								menus.setShowCommandPalette(false);
								menus.setShowProviderMenu(true);
							},
						},
						{
							id: "session",
							label: "Sessions",
							shortcut: "L",
							action: () => {
								menus.setShowCommandPalette(false);
								menus.setShowSessionMenu(true);
							},
						},
						{
							id: "memory",
							label: "Memories",
							shortcut: "B",
							action: () => {
								menus.setShowCommandPalette(false);
								menus.setShowMemoryMenu(true);
							},
						},
						{
							id: "tools",
							label: "Tools",
							shortcut: "T",
							action: () => {
								menus.setShowCommandPalette(false);
								menus.setShowToolsMenu(true);
							},
						},
						{
							id: "url",
							label: "URL Menu",
							shortcut: "U",
							action: () => {
								menus.setShowCommandPalette(false);
								menus.setShowUrlMenu(true);
							},
						},
						{
							id: "grounding",
							label: "Grounding",
							shortcut: "G",
							action: () => {
								menus.setShowCommandPalette(false);
								menus.setShowGroundingMenu(true);
							},
						},
						{
							id: "hotkeys",
							label: "Hotkeys",
							shortcut: "?",
							action: () => {
								menus.setShowCommandPalette(false);
								menus.setShowHotkeysPane(true);
							},
						},
						{
							id: "newSession",
							label: "New Session",
							shortcut: "N",
							action: () => {
								menus.setShowCommandPalette(false);
							},
						},
						{
							id: "orpheus",
							label: "ORPHEUS Quick Actions",
							shortcut: "Ctrl+Shift+O",
							action: () => {
								menus.setShowCommandPalette(false);
								menus.setShowOrpheusMenu(true);
							},
						},
					]}
				/>
			)}

			{menus.showOrpheusMenu && (
				<OrpheusMenu
					onClose={() => menus.setShowOrpheusMenu(false)}
					onSelect={handleOrpheusAction}
				/>
			)}

			{onboarding.onboardingActive && (
				<OnboardingOverlay
					step={onboarding.onboardingStep}
					preferences={onboarding.onboardingPreferences}
					devices={device.devices}
					currentDevice={device.currentDevice}
					currentOutputDevice={device.currentOutputDevice}
					models={model.curatedModels}
					currentModelProvider={model.currentModelProvider}
					copilotAuthenticated={onboarding.copilotAuthenticated}
					currentModelId={model.currentModelId}
					deviceLoadTimedOut={device.deviceLoadTimedOut}
					soxAvailable={device.soxAvailable}
					soxInstallHint={device.soxInstallHint}
					setCurrentModelProvider={model.setCurrentModelProvider}
					setCurrentDevice={device.setCurrentDevice}
					setCurrentOutputDevice={device.setCurrentOutputDevice}
					setCurrentModelId={model.setCurrentModelId}
					setOnboardingStep={onboarding.setOnboardingStep}
					completeOnboarding={onboardingCallbacks.completeOnboarding}
					persistPreferences={settings.persistPreferences}
					onKeySubmit={onboardingCallbacks.onKeySubmit}
					apiKeyTextareaRef={onboarding.apiKeyTextareaRef}
				/>
			)}
		</>
	);
}

export const AppOverlays = memo(AppOverlaysImpl);
