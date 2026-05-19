/**
 * Terminal UI components — barrel export.
 *
 * All components are pure functions that return VNodes.
 * No React/Ink dependency — these are framework-agnostic terminal
 * rendering primitives.
 */

export { Box } from './box.js';
export type { BoxProps } from './box.js';

export { Text } from './text.js';
export type { TextProps } from './text.js';

export { PermissionPrompt } from './permission-prompt.js';
export type { PermissionPromptProps, PermissionAction } from './permission-prompt.js';

export { SelectInput } from './select-input.js';
export type { SelectInputProps } from './select-input.js';

export { TextInput } from './text-input.js';
export type { TextInputProps } from './text-input.js';

export { ScrollArea } from './scroll-area.js';
export type { ScrollAreaProps } from './scroll-area.js';

export { renderMessage } from './message-renderer.js';
export type { MessageRendererOptions } from './message-renderer.js';

export { renderConversation } from './conversation-view.js';
export type { ConversationViewOptions } from './conversation-view.js';

export { renderFileTree } from './file-browser.js';
export type { FileEntry, FileBrowserOptions } from './file-browser.js';

export { renderSettings } from './settings-panel.js';
export type { SettingsField, SettingsSection } from './settings-panel.js';

export { renderSessionList } from './session-list.js';
export type { SessionSummary } from './session-list.js';

export { renderProgress, advanceSpinner } from './progress-bar.js';
export type { ProgressOptions, ProgressStep, StepStatus } from './progress-bar.js';

export { renderTokenUsage } from './token-usage.js';
