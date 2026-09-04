import { useEffect, useId, useState } from "react"

import { PageContainer } from "@/components/page-state"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useAuth } from "@/hooks"
import { errorMessage } from "@/lib/api"
import { navigate } from "@/lib/router"

type Mode = "login" | "register"

/** One form, two modes. Signing in merges whatever is saved locally into the account. */
export function LoginPage() {
  const auth = useAuth()
  const [mode, setMode] = useState<Mode>("login")
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const errorId = useId()

  useEffect(() => {
    if (auth.user) navigate({ name: "settings" }, { replace: true })
  }, [auth.user])

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (pending) return
    setPending(true); setError(null)
    const input = { username: username.trim(), password, deviceName: deviceName() }
    try {
      if (mode === "register") await auth.register(input)
      else await auth.login(input)
      navigate({ name: "settings" }, { replace: true })
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setPending(false)
    }
  }

  return (
    <PageContainer className="animate-fade flex min-h-svh flex-col justify-center py-24">
      <div className="mx-auto w-full max-w-sm">
        <h1 className="page-title">{mode === "login" ? "Welcome back" : "Create an account"}</h1>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          Your saved titles, history and settings on this device will merge into the account and sync everywhere you sign in.
        </p>

        <Tabs value={mode} onValueChange={(value) => { setMode(value as Mode); setError(null) }} className="mt-8">
          <TabsList aria-label="Sign in or register">
            <TabsTrigger value="login">Login</TabsTrigger>
            <TabsTrigger value="register">Register</TabsTrigger>
          </TabsList>
          <TabsContent value="login" />
          <TabsContent value="register" className="pt-0" />
        </Tabs>

        <form onSubmit={submit} className="space-y-4" aria-describedby={error ? errorId : undefined}>
          <div className="space-y-1.5">
            <label htmlFor="username" className="text-sm font-medium">Username</label>
            <Input id="username" name="username" autoComplete="username" autoCapitalize="none" spellCheck={false} required minLength={3} value={username} onChange={(event) => setUsername(event.target.value)} className="h-12" />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="password" className="text-sm font-medium">Password</label>
            <Input id="password" name="password" type="password" autoComplete={mode === "login" ? "current-password" : "new-password"} required minLength={10} maxLength={128} value={password} onChange={(event) => setPassword(event.target.value)} className="h-12" />
            {mode === "register" ? <p className="text-xs text-muted-foreground">At least 10 characters.</p> : null}
          </div>
          {error ? <p id={errorId} role="alert" className="text-sm text-destructive">{error}</p> : null}
          <Button type="submit" size="lg" className="w-full" disabled={pending}>
            {pending ? (mode === "login" ? "Signing in…" : "Creating account…") : mode === "login" ? "Login" : "Register"}
          </Button>
        </form>
      </div>
    </PageContainer>
  )
}

function deviceName(): string | undefined {
  if (typeof navigator === "undefined") return undefined
  const ua = navigator.userAgent
  const platform = /iPhone|iPad/.test(ua) ? "iOS" : /Android/.test(ua) ? "Android" : /Mac/.test(ua) ? "Mac" : /Windows/.test(ua) ? "Windows" : /Linux/.test(ua) ? "Linux" : null
  const browser = /Edg\//.test(ua) ? "Edge" : /OPR\//.test(ua) ? "Opera" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : null
  return [browser, platform].filter(Boolean).join(" on ") || undefined
}
