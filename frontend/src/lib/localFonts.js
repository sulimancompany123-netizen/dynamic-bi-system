// Fonts that are self-hosted (bundled in /public/fonts and declared via @font-face
// in index.css). These must NOT be fetched from Google Fonts — they aren't there
// (they're paid), so the request would 404 and leak the font name to Google.
// Match against the font's `name` (case-insensitive). Add future local fonts here.
export const LOCAL_FONT_NAMES = ['itf qomra arabic'];

export function isLocalFont(name) {
  return LOCAL_FONT_NAMES.includes((name || '').trim().toLowerCase());
}
