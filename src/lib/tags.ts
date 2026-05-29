// Expressive performance tags like [laugh], [chuckle], [cough], [sigh] that some
// TTS engines (Chatterbox, ElevenLabs) interpret natively. For engines that don't,
// the tags must be removed so they aren't read aloud literally.

const TAG_RE = /\[[a-z][a-z _-]*\]/gi;

export function stripTags(text: string): string {
  return text
    .replace(TAG_RE, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+([.,!?;:])/g, "$1")
    .replace(/\n[ \t]+/g, "\n")
    .trim();
}
