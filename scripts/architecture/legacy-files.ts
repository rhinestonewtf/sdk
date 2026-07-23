// The staged rewrite is complete: the legacy implementation tree has been
// removed and no file is byte-pinned to the release oracle any longer. Both
// sets are intentionally empty; the architecture check now holds every source
// file to the rewrite rules.
export const facadeCutoverFiles = new Set<string>([])

export const transitionalLegacyFiles = new Set<string>([])
