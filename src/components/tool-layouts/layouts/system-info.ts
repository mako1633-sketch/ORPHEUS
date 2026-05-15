import { registerToolLayout } from "../registry";
import type { ToolLayoutConfig } from "../types";

export const systemInfoLayout: ToolLayoutConfig = {
	abbreviation: "sys",
};

registerToolLayout("getSystemInfo", systemInfoLayout);
