import {
  ApiError,
  getSync,
  isSyncConflict,
  putSync,
} from "./api"
import type { AccountUser, HawkSyncedState } from "./account-types"
import {
  clearLocalSession,
  getAuthSnapshot,
  setAuthHooks,
} from "./auth"
import {
  DEFAULT_PREFERENCES,
  extractSyncableState,
  getSyncMetadata,
  replaceSyncableState,
  saveSyncMetadata,
  subscribeStorage,
} from "./storage"
import { areSyncedStatesEqual, threeWayMerge } from "./sync-merge"

export interface SyncCoordinatorState {
  isSyncing: boolean
  lastSyncAt: number | null
  lastError: string | null
}

const BACKGROUND_ACTIVATION_COOLDOWN_MS = 30_000

let isSyncing = false
let lastSyncAt: number | null = null
let lastError: string | null = null
let lastBackgroundActivationAt = 0
let coordinatorSnapshot: SyncCoordinatorState = {
  isSyncing: false,
  lastSyncAt: null,
  lastError: null,
}

let debounceTimer: ReturnType<typeof setTimeout> | null = null
let inFlightSync: Promise<void> | null = null
let inFlightStateHash: string | null = null
let queuedSync = false

let isApplyingRemoteSync = false
let isFirstRegistrationPending = false
let lastSeenSyncableHash = ""

let coordinatorSubscribers = 0
let unsubscribeStorage: (() => void) | null = null
let removeEventListeners: (() => void) | null = null

const listeners = new Set<() => void>()

function notify(): void {
  coordinatorSnapshot = { isSyncing, lastSyncAt, lastError }
  for (const listener of listeners) {
    listener()
  }
}

function applyRemoteSyncState(state: HawkSyncedState): void {
  isApplyingRemoteSync = true
  try {
    replaceSyncableState(state)
  } finally {
    isApplyingRemoteSync = false
  }
  lastSeenSyncableHash = JSON.stringify(extractSyncableState())
  if (inFlightStateHash !== null) {
    inFlightStateHash = lastSeenSyncableHash
  }
}

export function getSyncCoordinatorSnapshot(): SyncCoordinatorState {
  return coordinatorSnapshot
}

export function subscribeSyncCoordinator(callback: () => void): () => void {
  listeners.add(callback)
  return () => {
    listeners.delete(callback)
  }
}

export function setFirstRegistrationPending(pending = true): void {
  isFirstRegistrationPending = pending
}

export function scheduleSync(delayMs = 5000): void {
  const auth = getAuthSnapshot()
  if (!auth.user) return

  if (debounceTimer !== null) {
    clearTimeout(debounceTimer)
  }

  debounceTimer = setTimeout(() => {
    debounceTimer = null
    void flushSync()
  }, delayMs)
}

export function flushSync(): Promise<void> {
  if (debounceTimer !== null) {
    clearTimeout(debounceTimer)
    debounceTimer = null
  }
  return triggerSync()
}

function triggerSync(): Promise<void> {
  const auth = getAuthSnapshot()
  if (!auth.user || (typeof navigator !== "undefined" && navigator.onLine === false)) {
    return Promise.resolve()
  }
  if (inFlightSync) {
    const currentHash = JSON.stringify(extractSyncableState())
    if (inFlightStateHash !== null && currentHash !== inFlightStateHash) {
      queuedSync = true
    }
    return inFlightSync
  }

  isSyncing = true
  lastError = null
  notify()

  inFlightStateHash = JSON.stringify(extractSyncableState())
  let succeeded = false
  inFlightSync = executeSyncInternal()
    .then(() => {
      succeeded = true
    })
    .catch((err) => {
      const isUnauthorized =
        (err instanceof ApiError && err.status === 401) ||
        (typeof err === "object" && err !== null && (err as { status?: number }).status === 401)

      if (isUnauthorized) {
        clearLocalSession()
        lastError = null
        queuedSync = false
        return
      }
      lastError = err instanceof Error ? err.message : String(err)
    })
    .finally(() => {
      inFlightSync = null
      inFlightStateHash = null
      isSyncing = false
      if (succeeded) lastSyncAt = Date.now()
      notify()

      if (queuedSync) {
        queuedSync = false
        void triggerSync()
      }
    })

  return inFlightSync
}

async function executeSyncInternal(): Promise<void> {
  const auth = getAuthSnapshot()
  if (!auth.user) {
    return
  }

  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return
  }

  const meta = getSyncMetadata()
  const hasMatchingMeta = meta !== null && meta.userId === auth.user.id

  if (!hasMatchingMeta) {
    if (isFirstRegistrationPending) {
      isFirstRegistrationPending = false
      const guestState = extractSyncableState()

      try {
        const putRes = await putSync(0, guestState)
        saveSyncMetadata({
          userId: auth.user.id,
          serverRevision: putRes.revision,
          baseState: putRes.state,
        })
        applyRemoteSyncState(putRes.state)
      } catch (err) {
        if (isSyncConflict(err)) {
          const serverRevision = err.details.serverRevision
          const serverState = err.details.serverState
          const emptyBase: HawkSyncedState = {
            bookmarks: [],
            history: [],
            progress: {},
            preferences: { ...DEFAULT_PREFERENCES },
          }
          const merged = threeWayMerge(emptyBase, guestState, serverState)
          applyRemoteSyncState(merged)
          const retryRes = await putSync(serverRevision, merged)
          saveSyncMetadata({
            userId: auth.user.id,
            serverRevision: retryRes.revision,
            baseState: retryRes.state,
          })
          applyRemoteSyncState(retryRes.state)
        } else {
          throw err
        }
      }
      return
    }

    // Login to an account with no matching local sync metadata:
    // Import existing guest state by merging with remote
    const remote = await getSync()
    const guestState = extractSyncableState()
    const emptyBase: HawkSyncedState = {
      bookmarks: [],
      history: [],
      progress: {},
      preferences: { ...DEFAULT_PREFERENCES },
    }
    const merged = threeWayMerge(emptyBase, guestState, remote.state)

    applyRemoteSyncState(merged)

    const hasNewLocalData = !areSyncedStatesEqual(merged, remote.state)

    if (hasNewLocalData) {
      try {
        const putRes = await putSync(remote.revision, merged)
        saveSyncMetadata({
          userId: auth.user.id,
          serverRevision: putRes.revision,
          baseState: putRes.state,
        })
        applyRemoteSyncState(putRes.state)
      } catch (err) {
        if (isSyncConflict(err)) {
          const serverRevision = err.details.serverRevision
          const serverState = err.details.serverState
          const reMerged = threeWayMerge(remote.state, merged, serverState)
          applyRemoteSyncState(reMerged)
          const retryRes = await putSync(serverRevision, reMerged)
          saveSyncMetadata({
            userId: auth.user.id,
            serverRevision: retryRes.revision,
            baseState: retryRes.state,
          })
          applyRemoteSyncState(retryRes.state)
        } else {
          throw err
        }
      }
    } else {
      saveSyncMetadata({
        userId: auth.user.id,
        serverRevision: remote.revision,
        baseState: remote.state,
      })
    }
    return
  }

  // Normal sync with matching local metadata
  const localState = extractSyncableState()
  const isDirty = !areSyncedStatesEqual(localState, meta.baseState)

  if (isDirty) {
    try {
      const putRes = await putSync(meta.serverRevision, localState)
      saveSyncMetadata({
        userId: auth.user.id,
        serverRevision: putRes.revision,
        baseState: putRes.state,
      })
      applyRemoteSyncState(putRes.state)
    } catch (err) {
      if (isSyncConflict(err)) {
        // Deterministic 3-way merge on HTTP 409
        const serverRevision = err.details.serverRevision
        const serverState = err.details.serverState

        const merged = threeWayMerge(meta.baseState, localState, serverState)

        applyRemoteSyncState(merged)

        // Retry exactly once against serverRevision
        const retryRes = await putSync(serverRevision, merged)
        saveSyncMetadata({
          userId: auth.user.id,
          serverRevision: retryRes.revision,
          baseState: retryRes.state,
        })
        applyRemoteSyncState(retryRes.state)
      } else {
        throw err
      }
    }
  } else {
    // Local is clean, check server for updates
    const remote = await getSync()
    if (remote.revision !== meta.serverRevision) {
      const merged = threeWayMerge(meta.baseState, localState, remote.state)
      applyRemoteSyncState(merged)
      saveSyncMetadata({
        userId: auth.user.id,
        serverRevision: remote.revision,
        baseState: remote.state,
      })
    }
  }
}

export async function syncAfterRegister(_user?: AccountUser): Promise<void> {
  setFirstRegistrationPending(true)
  await flushSync()
}

export async function syncAfterLogin(_user?: AccountUser): Promise<void> {
  setFirstRegistrationPending(false)
  await flushSync()
}

function handleBackgroundActivation(): void {
  const now = Date.now()
  if (lastSyncAt !== null && now - lastSyncAt < BACKGROUND_ACTIVATION_COOLDOWN_MS) {
    return
  }
  if (now - lastBackgroundActivationAt < BACKGROUND_ACTIVATION_COOLDOWN_MS) {
    return
  }
  lastBackgroundActivationAt = now
  void flushSync()
}

function flushPendingDebouncedSync(): void {
  if (debounceTimer !== null) {
    void flushSync()
  }
}

function setupCoordinatorListeners(): void {
  lastSeenSyncableHash = JSON.stringify(extractSyncableState())

  unsubscribeStorage = subscribeStorage(() => {
    if (isApplyingRemoteSync) return
    const current = extractSyncableState()
    const serialized = JSON.stringify(current)
    if (serialized === lastSeenSyncableHash) return
    lastSeenSyncableHash = serialized
    if (inFlightSync) {
      if (inFlightStateHash !== null && serialized !== inFlightStateHash) {
        queuedSync = true
      }
    } else {
      scheduleSync(5000)
    }
  })

  const onOnline = () => {
    void flushSync()
  }

  const onVisibilityChange = () => {
    if (typeof document === "undefined") return
    if (document.visibilityState === "visible") {
      handleBackgroundActivation()
    } else if (document.visibilityState === "hidden") {
      flushPendingDebouncedSync()
    }
  }

  const onPageHide = () => {
    flushPendingDebouncedSync()
  }

  if (typeof window !== "undefined") {
    window.addEventListener("online", onOnline)
    window.addEventListener("pagehide", onPageHide)
  }

  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", onVisibilityChange)
  }

  removeEventListeners = () => {
    if (typeof window !== "undefined") {
      window.removeEventListener("online", onOnline)
      window.removeEventListener("pagehide", onPageHide)
    }
    if (typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", onVisibilityChange)
    }
  }
}

function teardownCoordinatorListeners(): void {
  if (debounceTimer !== null) {
    clearTimeout(debounceTimer)
    debounceTimer = null
  }

  if (unsubscribeStorage) {
    unsubscribeStorage()
    unsubscribeStorage = null
  }

  if (removeEventListeners) {
    removeEventListeners()
    removeEventListeners = null
  }
}

export function startSyncCoordinator(): () => void {
  coordinatorSubscribers++
  if (coordinatorSubscribers === 1) {
    setupCoordinatorListeners()
  }

  let stopped = false
  return () => {
    if (stopped) return
    stopped = true
    coordinatorSubscribers = Math.max(0, coordinatorSubscribers - 1)
    if (coordinatorSubscribers === 0) {
      teardownCoordinatorListeners()
    }
  }
}

export function stopSyncCoordinator(): void {
  coordinatorSubscribers = 0
  teardownCoordinatorListeners()
  lastBackgroundActivationAt = 0
}

// Hook into auth lifecycle
export function setupAuthSyncHooks(): void {
  setAuthHooks({
    onRegister: async (user) => {
      await syncAfterRegister(user)
    },
    onLogin: async (user) => {
      await syncAfterLogin(user)
    },
    onLogout: async () => {
      await flushSync()
    },
  })
}

// Auto-wire hooks
setupAuthSyncHooks()
