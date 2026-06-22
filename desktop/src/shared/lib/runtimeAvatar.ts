const RUNTIME_AVATAR_URLS = new Set([
  "https://goose-docs.ai/img/logo_dark.png",
  "https://anthropic.gallerycdn.vsassets.io/extensions/anthropic/claude-code/2.1.77/1773707456892/Microsoft.VisualStudio.Services.Icons.Default",
  "https://openai.gallerycdn.vsassets.io/extensions/openai/chatgpt/26.5313.41514/1773706730621/Microsoft.VisualStudio.Services.Icons.Default",
  "https://raw.githubusercontent.com/block/buzz/refs/heads/main/crates/buzz-agent/buzz-agent.png",
]);

export function isKnownRuntimeAvatarUrl(
  avatarUrl: string | null | undefined,
): boolean {
  const trimmed = avatarUrl?.trim();
  return trimmed ? RUNTIME_AVATAR_URLS.has(trimmed) : false;
}
