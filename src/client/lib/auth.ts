import {
  ApiError,
  errorMessage,
  getMe as apiGetMe,
  getSessions as apiGetSessions,
  login as apiLogin,
  logout as apiLogout,
  register as apiRegister,
  revokeSession as apiRevokeSession,
  updateUserProfile as apiUpdateUserProfile,
} from "./api"
import type {
  AccountSession,
  AccountUser,
  AuthResponse,
  LoginInput,
  RegisterInput,
} from "./account-types"
import { clearSyncMetadata, clearSyncableState } from "./storage"

export type AuthStatus = "idle" | "loading" | "authenticated" | "unauthenticated" | "error"

export interface AuthState {
  user: AccountUser | null
  session: AccountSession | null
  status: AuthStatus
  error: string | null
  isInitialized: boolean
}

export function getDeviceName(): string {
  if (typeof navigator === "undefined") return "Web Browser"

  const ua = navigator.userAgent || ""
  let os = "Web"
  if (/iPad|iPhone|iPod/.test(ua)) os = "iOS"
  else if (/Macintosh|Mac OS X/.test(ua)) os = "macOS"
  else if (/Windows NT/.test(ua)) os = "Windows"
  else if (/Android/.test(ua)) os = "Android"
  else if (/Linux/.test(ua)) os = "Linux"

  let browser = "Browser"
  if (/Edg\//.test(ua)) browser = "Edge"
  else if (/Chrome\//.test(ua)) browser = "Chrome"
  else if (/Firefox\//.test(ua)) browser = "Firefox"
  else if (/Safari\//.test(ua) && !/Chrome\//.test(ua)) browser = "Safari"

  return `${browser} on ${os}`.slice(0, 64)
}

const INITIAL_STATE: AuthState = {
  user: null,
  session: null,
  status: "idle",
  error: null,
  isInitialized: false,
}

let currentState: AuthState = { ...INITIAL_STATE }
const listeners = new Set<() => void>()
let initPromise: Promise<void> | null = null
const AUTH_HINT_KEY = "hawk.auth_hint.v1"

function hasAuthHint(): boolean {
  try {
    return typeof localStorage !== "undefined" && localStorage.getItem(AUTH_HINT_KEY) === "1"
  } catch {
    return false
  }
}

function setAuthHint(authenticated: boolean): void {
  try {
    if (typeof localStorage === "undefined") return
    if (authenticated) localStorage.setItem(AUTH_HINT_KEY, "1")
    else localStorage.removeItem(AUTH_HINT_KEY)
  } catch {
    // Authentication still works when browser storage is unavailable.
  }
}

type AuthHook = (user: AccountUser) => Promise<void> | void
let registerHook: AuthHook | null = null
let loginHook: AuthHook | null = null
let logoutHook: (() => Promise<void> | void) | null = null

export function setAuthHooks(hooks: {
  onRegister?: AuthHook
  onLogin?: AuthHook
  onLogout?: () => Promise<void> | void
}): void {
  if (hooks.onRegister !== undefined) registerHook = hooks.onRegister
  if (hooks.onLogin !== undefined) loginHook = hooks.onLogin
  if (hooks.onLogout !== undefined) logoutHook = hooks.onLogout
}

function notify(): void {
  for (const listener of listeners) {
    listener()
  }
}

export function getAuthSnapshot(): AuthState {
  return currentState
}

export function subscribeAuth(callback: () => void): () => void {
  listeners.add(callback)
  return () => {
    listeners.delete(callback)
  }
}

export function resetAuthState(): void {
  initPromise = null
  registerHook = null
  loginHook = null
  logoutHook = null
  currentState = { ...INITIAL_STATE }
  notify()
}

export async function initAuth(force = false): Promise<void> {
  if (initPromise && !force) return initPromise

  initPromise = (async () => {
    currentState = { ...currentState, status: "loading", error: null }
    notify()

    try {
      const auth = await apiGetMe()
      currentState = {
        user: auth.user,
        session: auth.session,
        status: "authenticated",
        error: null,
        isInitialized: true,
      }
      setAuthHint(true)
      if (loginHook) {
        try {
          await loginHook(auth.user)
        } catch {
          // Authentication remains valid when background synchronization fails.
        }
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setAuthHint(false)
        currentState = {
          user: null,
          session: null,
          status: "unauthenticated",
          error: null,
          isInitialized: true,
        }
      } else {
        currentState = {
          user: null,
          session: null,
          status: "error",
          error: errorMessage(err),
          isInitialized: true,
        }
      }
    } finally {
      notify()
    }
  })()

  return initPromise
}

export async function register(input: RegisterInput): Promise<AuthResponse> {
  currentState = { ...currentState, status: "loading", error: null }
  notify()

  try {
    const payload: RegisterInput = {
      username: input.username,
      password: input.password,
      deviceName: input.deviceName || getDeviceName(),
    }
    const result = await apiRegister(payload)
    currentState = {
      user: result.user,
      session: result.session,
      status: "authenticated",
      error: null,
      isInitialized: true,
    }
    setAuthHint(true)
    notify()
    if (registerHook) {
      try {
        await registerHook(result.user)
      } catch {
        // ignore
      }
    }
    return result
  } catch (err) {
    const msg = errorMessage(err)
    currentState = {
      ...currentState,
      status: "error",
      error: msg,
      isInitialized: true,
    }
    notify()
    throw err
  }
}

export async function login(input: LoginInput): Promise<AuthResponse> {
  currentState = { ...currentState, status: "loading", error: null }
  notify()

  try {
    const payload: LoginInput = {
      username: input.username,
      password: input.password,
      deviceName: input.deviceName || getDeviceName(),
    }
    const result = await apiLogin(payload)
    currentState = {
      user: result.user,
      session: result.session,
      status: "authenticated",
      error: null,
      isInitialized: true,
    }
    setAuthHint(true)
    notify()
    if (loginHook) {
      try {
        await loginHook(result.user)
      } catch {
        // ignore
      }
    }
    return result
  } catch (err) {
    const msg = errorMessage(err)
    currentState = {
      ...currentState,
      status: "error",
      error: msg,
      isInitialized: true,
    }
    notify()
    throw err
  }
}

export function clearLocalSession(): void {
  setAuthHint(false)
  clearSyncMetadata()
  clearSyncableState({ preservePreferences: true })

  currentState = {
    user: null,
    session: null,
    status: "unauthenticated",
    error: null,
    isInitialized: true,
  }
  notify()
}

export async function logout(): Promise<void> {
  // Best-effort flush before session is revoked
  if (logoutHook) {
    try {
      await logoutHook()
    } catch {
      // Best effort ignore
    }
  }

  // Revoke session cookie on server
  try {
    await apiLogout()
  } catch {
    // Best effort ignore network/server issues
  }

  clearLocalSession()
}

export async function refresh(): Promise<AuthResponse | null> {
  await initAuth(true)
  const snap = getAuthSnapshot()
  if (snap.user && snap.session) {
    return { user: snap.user, session: snap.session }
  }
  return null
}

export async function getSessions(): Promise<AccountSession[]> {
  return apiGetSessions()
}

export async function revokeSession(sessionId: string): Promise<boolean> {
  const isCurrent = currentState.session !== null && currentState.session.id === sessionId
  const res = await apiRevokeSession(sessionId)
  if (isCurrent) {
    clearLocalSession()
  }
  return res.ok
}

export async function updateProfileVisibility(publicProfile: boolean): Promise<boolean> {
  const res = await apiUpdateUserProfile({ publicProfile })
  if (currentState.user) {
    currentState = {
      ...currentState,
      user: {
        ...currentState.user,
        publicProfile: res.publicProfile,
      },
    }
    notify()
  }
  return res.publicProfile
}

// Auto-run once on browser startup if window is defined and not explicitly suppressed
if (
  typeof window !== "undefined" &&
  typeof fetch === "function" &&
  !(window as unknown as { __HAWK_TEST_ENV__?: boolean }).__HAWK_TEST_ENV__
) {
  if (hasAuthHint()) {
    void initAuth()
  } else {
    currentState = {
      user: null,
      session: null,
      status: "unauthenticated",
      error: null,
      isInitialized: true,
    }
  }
}
