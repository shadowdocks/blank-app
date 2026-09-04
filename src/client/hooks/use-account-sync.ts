import { useEffect, useSyncExternalStore } from "react"
import {
  flushSync,
  getSyncCoordinatorSnapshot,
  scheduleSync,
  startSyncCoordinator,
  subscribeSyncCoordinator,
  type SyncCoordinatorState,
} from "@/lib/sync"

export function useAccountSync(): SyncCoordinatorState & {
  syncNow: () => Promise<void>
  scheduleSync: (delayMs?: number) => void
} {
  useEffect(() => {
    return startSyncCoordinator()
  }, [])

  const state = useSyncExternalStore(
    subscribeSyncCoordinator,
    getSyncCoordinatorSnapshot,
    getSyncCoordinatorSnapshot
  )

  return {
    ...state,
    syncNow: flushSync,
    scheduleSync,
  }
}
