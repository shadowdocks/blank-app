import type { PlaybackRecord } from "../../shared/playback"
import type { MediaBookmark, PlaybackProgress, UserPreferences } from "./storage"

export interface AccountUser {
  id: string
  username: string
  publicProfile: boolean
  createdAt: number
}

export interface AccountSession {
  id: string
  deviceName: string
  createdAt: number
  lastSeenAt: number
  isCurrent?: boolean
}

export interface AuthResponse {
  user: AccountUser
  session: AccountSession
}

export interface RegisterInput {
  username: string
  password: string
  deviceName?: string
}

export interface LoginInput {
  username: string
  password: string
  deviceName?: string
}

export interface HawkSyncedState {
  bookmarks: MediaBookmark[]
  history: PlaybackRecord[]
  progress: Record<string, PlaybackProgress>
  preferences: UserPreferences
}

export interface SyncMetadata {
  userId: string
  serverRevision: number
  baseState: HawkSyncedState
}

export interface SyncSuccessResponse {
  revision: number
  state: HawkSyncedState
}

export interface SyncConflictResponse {
  error: string
  code: "CONFLICT"
  serverRevision: number
  serverState: HawkSyncedState
}

export type SyncResponse = SyncSuccessResponse | SyncConflictResponse

export interface PublicUserProfile {
  user: {
    username: string
    createdAt: number
  }
  bookmarks: MediaBookmark[]
}

export interface UserProfileResponse {
  username: string
  publicProfile: boolean
}
