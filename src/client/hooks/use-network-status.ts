import { useEffect, useState } from "react"

export interface NetworkStatus {
  isOnline: boolean
  wasOffline: boolean
}

function getInitialOnlineStatus(): boolean {
  if (typeof navigator !== "undefined" && typeof navigator.onLine === "boolean") {
    return navigator.onLine
  }
  return true
}

export function useNetworkStatus(): NetworkStatus {
  const [isOnline, setIsOnline] = useState<boolean>(getInitialOnlineStatus)
  const [wasOffline, setWasOffline] = useState(false)

  useEffect(() => {
    if (typeof window === "undefined") return

    const handleOnline = () => {
      setIsOnline(true)
    }

    const handleOffline = () => {
      setIsOnline(false)
      setWasOffline(true)
    }

    window.addEventListener("online", handleOnline)
    window.addEventListener("offline", handleOffline)

    return () => {
      window.removeEventListener("online", handleOnline)
      window.removeEventListener("offline", handleOffline)
    }
  }, [])

  return { isOnline, wasOffline }
}
