import { useEffect, useId, useState } from "react"

import { AppLink } from "@/components/app-link"
import { PageContainer, PageHeading } from "@/components/page-state"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { useAccountSync, useAuth, useLibrary } from "@/hooks"
import type { AccountSession } from "@/lib/account-types"
import { getSessions } from "@/lib/auth"
import { errorMessage } from "@/lib/api"
import { navigate } from "@/lib/router"
import {
  checkForUpdate,
  applyUpdate,
  formatBytes,
  getInstallabilityState,
  inspectStorage,
  isStandalone,
  promptInstall,
  requestPersistence,
  subscribeToInstallability,
  subscribeToServiceWorkerUpdates,
  type InstallabilityState,
  type StorageInspection,
} from "@/offline"
import type { VideoQuality } from "../../shared/playback"

const QUALITIES: { value: VideoQuality; label: string }[] = [
  { value: "2160p", label: "2160p (4K)" },
  { value: "1440p", label: "1440p" },
  { value: "1080p", label: "1080p" },
  { value: "720p", label: "720p" },
  { value: "480p", label: "480p" },
  { value: "unknown", label: "Best available" },
]

const SUBTITLE_LANGUAGES = ["en", "da", "sv", "no", "fi", "de", "fr", "es", "it", "pt", "nl", "pl", "tr", "ja", "ko", "zh", "ar"]

/**
 * Every control here is wired to something that already works: playback
 * preferences read by the watch page, the PWA/offline APIs, and the account
 * foundations. Nothing decorative.
 */
export function SettingsPage() {
  const library = useLibrary()
  const auth = useAuth()
  return (
    <PageContainer className="animate-fade pb-8 pt-24 sm:pt-28">
      <PageHeading title="Settings" />
      <div className="mt-8 grid gap-12 lg:grid-cols-[14rem_1fr] lg:gap-x-16">
        <Section title="Playback" description="Applied the next time a title starts.">
          <Row id="quality" label="Preferred quality" hint="Falls back to the closest resolution the source list offers.">
            <Select value={library.preferences.defaultQuality} onValueChange={(value) => library.updatePreferences({ defaultQuality: value as VideoQuality })}>
              <SelectTrigger id="quality" aria-label="Preferred quality"><SelectValue /></SelectTrigger>
              <SelectContent>{QUALITIES.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent>
            </Select>
          </Row>
          <Row id="autoplay" label="Autoplay" hint="Start playing as soon as the stream is ready.">
            <Switch id="autoplay" checked={library.preferences.autoplay} onCheckedChange={(checked) => library.updatePreferences({ autoplay: checked })} />
          </Row>
          <Row id="resume" label="Resume where you left off" hint="Jump back to your last position instead of the beginning.">
            <Switch id="resume" checked={library.preferences.autoResume} onCheckedChange={(checked) => library.updatePreferences({ autoResume: checked })} />
          </Row>
          <Row id="subtitles" label="Subtitles" hint="Turn on a matching subtitle track automatically.">
            <Switch id="subtitles" checked={library.preferences.subtitlesEnabled} onCheckedChange={(checked) => library.updatePreferences({ subtitlesEnabled: checked })} />
          </Row>
          <Row id="subtitle-language" label="Subtitle language">
            <Select value={library.preferences.subtitleLanguage} onValueChange={(value) => library.updatePreferences({ subtitleLanguage: value })}>
              <SelectTrigger id="subtitle-language" aria-label="Subtitle language" disabled={!library.preferences.subtitlesEnabled}><SelectValue /></SelectTrigger>
              <SelectContent>
                {languageOptions(library.preferences.subtitleLanguage).map((code) => <SelectItem key={code} value={code}>{languageName(code)}</SelectItem>)}
              </SelectContent>
            </Select>
          </Row>
        </Section>

        <AppSection />

        <Section title="Account" description={auth.user ? "Your library syncs to this account." : "Sign in to keep your library on every device."}>
          {auth.user ? <AccountRows /> : (
            <Row id="login" label="Not signed in" hint="Saved titles, history and settings stay on this device until you sign in.">
              <Button asChild variant="outline"><AppLink route={{ name: "login" }}>Login or register</AppLink></Button>
            </Row>
          )}
        </Section>
      </div>
    </PageContainer>
  )
}

function Section({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  const id = useId()
  return (
    <section aria-labelledby={id} className="contents">
      <div className="lg:pt-4">
        <h2 id={id} className="section-title">{title}</h2>
        {description ? <p className="mt-1 text-sm text-muted-foreground">{description}</p> : null}
      </div>
      <div className="surface px-4 sm:px-5">{children}</div>
    </section>
  )
}

function Row({ id, label, hint, children }: { id: string; label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="setting-row">
      <div className="min-w-0">
        <label htmlFor={id} className="block text-sm font-medium">{label}</label>
        {hint ? <p className="mt-0.5 text-sm text-muted-foreground">{hint}</p> : null}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}

function AppSection() {
  const [install, setInstall] = useState<InstallabilityState>(() => getInstallabilityState())
  const [updateState, setUpdateState] = useState<"idle" | "checking" | "current" | "ready">("idle")
  const [storage, setStorage] = useState<StorageInspection | null>(null)
  const [persistState, setPersistState] = useState<"idle" | "pending" | "denied">("idle")
  const supported = typeof navigator !== "undefined" && "serviceWorker" in navigator

  useEffect(() => subscribeToInstallability(setInstall), [])
  useEffect(() => subscribeToServiceWorkerUpdates((event) => {
    if (event.type === "waiting") setUpdateState("ready")
    if (event.type === "controlling") window.location.reload()
  }), [])
  useEffect(() => {
    let active = true
    void inspectStorage().then((result) => { if (active) setStorage(result) })
    return () => { active = false }
  }, [persistState])

  const check = async () => {
    setUpdateState("checking")
    setUpdateState((await checkForUpdate()) ? "ready" : "current")
  }
  const persist = async () => {
    setPersistState("pending")
    setPersistState((await requestPersistence()) ? "idle" : "denied")
  }
  const installed = install.isInstalled || isStandalone()

  return (
    <Section title="App" description="Install Hawk, keep it current, and protect downloads from eviction.">
      {installed || install.canPrompt ? (
        <Row id="install" label="Install" hint={installed ? "Hawk is installed on this device." : "Add Hawk to your home screen or dock."}>
          {installed ? <span className="text-sm text-muted-foreground">Installed</span> : <Button id="install" variant="outline" onClick={() => void promptInstall()}>Install</Button>}
        </Row>
      ) : null}
      {supported ? (
        <Row id="update" label="Updates" hint={updateState === "ready" ? "A new version is ready; applying reloads the app." : updateState === "current" ? "You have the latest version." : "Check for a newer version of Hawk."}>
          {updateState === "ready"
            ? <Button id="update" onClick={() => void applyUpdate()}>Update now</Button>
            : <Button id="update" variant="outline" disabled={updateState === "checking"} onClick={() => void check()}>{updateState === "checking" ? "Checking…" : "Check for updates"}</Button>}
        </Row>
      ) : null}
      {storage && (storage.supportsIDB || storage.supportsOPFS) ? (
        <>
          <Row id="storage" label="Storage" hint={storage.quota ? `${formatBytes(storage.usage)} used of ${formatBytes(storage.quota)}` : `${formatBytes(storage.usage)} used`}>
            <span className="text-sm tabular-nums text-muted-foreground">{storage.quota ? `${Math.round(storage.percentUsed)}%` : ""}</span>
          </Row>
          <Row id="persist" label="Persistent storage" hint={storage.isPersistent ? "The browser will not evict your downloads under storage pressure." : persistState === "denied" ? "The browser declined. Installing the app usually grants this." : "Ask the browser to keep downloads even when space is tight."}>
            {storage.isPersistent ? <span className="text-sm text-muted-foreground">Granted</span> : <Button id="persist" variant="outline" disabled={persistState === "pending"} onClick={() => void persist()}>Request</Button>}
          </Row>
        </>
      ) : null}
      {!supported && !installed && !install.canPrompt && !storage ? <p className="py-4 text-sm text-muted-foreground">Offline features are unavailable in this browser.</p> : null}
    </Section>
  )
}

function AccountRows() {
  const auth = useAuth()
  const sync = useAccountSync()
  const [sessions, setSessions] = useState<AccountSession[] | null>(null)
  const [sessionsError, setSessionsError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const user = auth.user!

  const loadSessions = async () => {
    try { setSessions(await getSessions()); setSessionsError(null) } catch (caught) { setSessionsError(errorMessage(caught)) }
  }
  useEffect(() => { void loadSessions() }, [user.id])

  const run = async (key: string, task: () => Promise<unknown>) => {
    setBusy(key); setMessage(null)
    try { await task() } catch (caught) { setMessage(errorMessage(caught)) } finally { setBusy(null) }
  }

  return (
    <>
      <Row id="username" label="Signed in as" hint={`Member since ${new Date(user.createdAt).toLocaleDateString()}`}>
        <span id="username" className="text-sm font-medium">{user.username}</span>
      </Row>
      <Row id="public-profile" label="Public profile" hint={user.publicProfile ? `Anyone can see your saved titles at /u/${user.username}.` : "Your saved titles are private."}>
        <div className="flex items-center gap-3">
          {user.publicProfile ? <Button asChild variant="ghost" size="sm"><AppLink route={{ name: "profile", username: user.username }}>View</AppLink></Button> : null}
          <Switch id="public-profile" checked={user.publicProfile} disabled={busy === "visibility"} onCheckedChange={(checked) => void run("visibility", () => auth.setPublicProfile(checked))} />
        </div>
      </Row>
      <Row id="sync" label="Sync" hint={sync.lastError ? `Last attempt failed: ${sync.lastError}` : sync.lastSyncAt ? `Last synced ${relativeTime(sync.lastSyncAt)}` : "Not synced yet on this device."}>
        <Button id="sync" variant="outline" disabled={sync.isSyncing} onClick={() => void sync.syncNow()}>{sync.isSyncing ? "Syncing…" : "Sync now"}</Button>
      </Row>
      <div className="setting-row flex-col items-stretch sm:flex-col sm:items-stretch">
        <div>
          <p className="text-sm font-medium">Sessions</p>
          <p className="mt-0.5 text-sm text-muted-foreground">Devices signed in to this account.</p>
        </div>
        {sessionsError ? (
          <p className="flex items-center justify-between gap-3 text-sm text-destructive">{sessionsError}<Button size="sm" variant="ghost" onClick={() => void loadSessions()}>Retry</Button></p>
        ) : sessions === null ? (
          <ul className="space-y-2" aria-busy="true">{[0, 1].map((index) => <li key={index} className="skeleton h-11 rounded-md" />)}</ul>
        ) : (
          <ul className="divide-y divide-border/60">
            {sessions.map((session) => {
              const current = session.isCurrent || session.id === auth.session?.id
              return (
                <li key={session.id} className="flex min-h-11 items-center justify-between gap-3 py-2">
                  <span className="min-w-0">
                    <span className="block truncate text-sm">{session.deviceName || "Unknown device"}{current ? <span className="ml-2 text-xs text-muted-foreground">This device</span> : null}</span>
                    <span className="block text-xs text-muted-foreground">Active {relativeTime(session.lastSeenAt)}</span>
                  </span>
                  <Button size="sm" variant="ghost" disabled={busy === session.id} onClick={() => void run(session.id, async () => { await auth.revokeSession(session.id); await loadSessions() })}>{current ? "Sign out" : "Revoke"}</Button>
                </li>
              )
            })}
          </ul>
        )}
      </div>
      <Row id="logout" label="Sign out" hint="Synced items are removed from this device; your preferences stay.">
        <Button id="logout" variant="outline" disabled={busy === "logout"} onClick={() => void run("logout", async () => { await auth.logout(); navigate({ name: "home" }) })}>Sign out</Button>
      </Row>
      {message ? <p role="alert" className="pb-4 text-sm text-destructive">{message}</p> : null}
    </>
  )
}

function languageOptions(current: string): string[] {
  return SUBTITLE_LANGUAGES.includes(current) ? SUBTITLE_LANGUAGES : [current, ...SUBTITLE_LANGUAGES]
}

function languageName(code: string): string {
  try {
    return new Intl.DisplayNames(["en"], { type: "language" }).of(code) ?? code
  } catch {
    return code
  }
}

function relativeTime(timestamp: number): string {
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000))
  if (seconds < 10) return "just now"
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}
