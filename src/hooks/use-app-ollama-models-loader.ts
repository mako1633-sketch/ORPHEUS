import { useCallback, useEffect } from "react";
import type { ModelOption } from "../types";
import { getOllamaModels } from "../utils/ollama-models";

export interface UseAppOllamaModelsLoaderParams {
	preferencesLoaded: boolean;
	enabled: boolean;
	setModels: React.Dispatch<React.SetStateAction<ModelOption[]>>;
	setLoading: React.Dispatch<React.SetStateAction<boolean>>;
	setUpdatedAt: React.Dispatch<React.SetStateAction<number | null>>;
}

export interface UseAppOllamaModelsLoaderResult {
	refresh: () => Promise<void>;
}

export function useAppOllamaModelsLoader(
	params: UseAppOllamaModelsLoaderParams
): UseAppOllamaModelsLoaderResult {
	const { preferencesLoaded, enabled, setModels, setLoading, setUpdatedAt } = params;

	const refresh = useCallback(
		async (forceRefresh = false) => {
			if (!preferencesLoaded || !enabled) return;
			setLoading(true);
			try {
				const result = await getOllamaModels({ forceRefresh });
				setModels(result.models);
				setUpdatedAt(result.timestamp);
			} finally {
				setLoading(false);
			}
		},
		[enabled, preferencesLoaded, setLoading, setModels, setUpdatedAt]
	);

	useEffect(() => {
		if (!preferencesLoaded || !enabled) return;
		void refresh(false);
	}, [enabled, preferencesLoaded, refresh]);

	return {
		refresh: () => refresh(true),
	};
}
