import type { MediaType, TimeBucket } from "@/lib/types"

export interface Option<T extends string> {
  id: T
  name: string
  note: string
}

/** Mood ids mirror the server's MOODS map in src/config.ts. */
export const MOODS: Option<string>[] = [
  { id: "cozy", name: "Cozy", note: "Warm, low stakes" },
  { id: "thrilling", name: "Thrilling", note: "Tension and pace" },
  { id: "mindbending", name: "Mindbending", note: "Puzzles and twists" },
  { id: "laugh", name: "Laugh", note: "Comedy first" },
  { id: "cry", name: "Cry", note: "Emotional weight" },
  { id: "spooky", name: "Spooky", note: "Dread and horror" },
  { id: "romantic", name: "Romantic", note: "Love at the center" },
  { id: "epic", name: "Epic", note: "Scale and spectacle" },
]

export const TYPES: Option<MediaType>[] = [
  { id: "movie", name: "Movie", note: "One sitting" },
  { id: "tv", name: "TV", note: "Series" },
]

export const TIMES: Option<TimeBucket>[] = [
  { id: "quick", name: "Quick", note: "Under 100 min" },
  { id: "standard", name: "Standard", note: "Around 2 hours" },
  { id: "epic", name: "Epic", note: "Settle in" },
]

export const MOOD_IDS = new Set(MOODS.map((mood) => mood.id))
export const TYPE_IDS = new Set<string>(TYPES.map((type) => type.id))
export const TIME_IDS = new Set<string>(TIMES.map((time) => time.id))

export function moodName(id: string): string {
  return MOODS.find((mood) => mood.id === id)?.name ?? "Mood"
}

export function typeName(id: MediaType): string {
  return TYPES.find((type) => type.id === id)?.name ?? "Movie"
}

export function timeName(id: TimeBucket): string {
  return TIMES.find((time) => time.id === id)?.name ?? "Standard"
}
