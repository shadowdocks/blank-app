import type { Phase, Session } from "@/lib/types"

export const PHASES: Phase[] = ["pick", "title", "sources", "watch"]

export const PHASE_LABELS: Record<Phase, string> = {
  pick: "Mood",
  title: "Title",
  sources: "Sources",
  watch: "Watch",
}

export function phaseFromHash(hash: string): Phase | null {
  const value = hash.replace(/^#/, "")
  return PHASES.includes(value as Phase) ? (value as Phase) : null
}

export function writeHash(phase: Phase): void {
  if (phaseFromHash(window.location.hash) === phase) return
  window.location.hash = phase
}

/**
 * Clamps a requested phase to the furthest one the stored session can actually
 * render, so a stale hash or a cleared torrent never lands on an empty screen.
 */
export function reachablePhase(session: Session, phase: Phase): Phase {
  const hasTitle = Boolean(session.titles[session.titleIndex])
  if (!hasTitle) return "pick"
  if (phase === "watch") return session.torrent ? "watch" : "sources"
  return phase
}
