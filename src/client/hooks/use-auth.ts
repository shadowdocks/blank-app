import { useSyncExternalStore } from "react"
import {
  getAuthSnapshot,
  login,
  logout,
  refresh,
  register,
  revokeSession,
  subscribeAuth,
  updateProfileVisibility,
  type AuthState,
} from "@/lib/auth"
import type { LoginInput, RegisterInput } from "@/lib/account-types"

export function useAuth(): AuthState & {
  register: (input: RegisterInput) => Promise<void>
  login: (input: LoginInput) => Promise<void>
  logout: () => Promise<void>
  refresh: () => Promise<void>
  revokeSession: (sessionId: string) => Promise<boolean>
  setPublicProfile: (publicProfile: boolean) => Promise<boolean>
} {
  const state = useSyncExternalStore(subscribeAuth, getAuthSnapshot, getAuthSnapshot)

  return {
    ...state,
    register: async (input: RegisterInput) => {
      await register(input)
    },
    login: async (input: LoginInput) => {
      await login(input)
    },
    logout: async () => {
      await logout()
    },
    refresh: async () => {
      await refresh()
    },
    revokeSession,
    setPublicProfile: updateProfileVisibility,
  }
}
