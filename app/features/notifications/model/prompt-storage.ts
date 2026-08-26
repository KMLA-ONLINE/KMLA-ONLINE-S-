const KEY_PREFIX = "kmla-online:notification-prompt:v1";

export function hasHandledNotificationPrompt(profileId: number): boolean {
  try {
    return window.localStorage.getItem(`${KEY_PREFIX}:${profileId}`) !== null;
  } catch {
    return false;
  }
}

export function recordNotificationPromptHandled(profileId: number): void {
  try {
    window.localStorage.setItem(
      `${KEY_PREFIX}:${profileId}`,
      JSON.stringify({ handled: true }),
    );
  } catch {
    // The prompt remains dismissible for the current page without persistence.
  }
}
