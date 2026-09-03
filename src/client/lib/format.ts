export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 MB"
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(2)} GB`
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(0)} MB`
  return `${(bytes / 1e3).toFixed(0)} KB`
}

export function formatSpeed(bytesPerSecond: number): string {
  if (!Number.isFinite(bytesPerSecond) || bytesPerSecond <= 0) return "0 MB/s"
  if (bytesPerSecond >= 1e6) return `${(bytesPerSecond / 1e6).toFixed(1)} MB/s`
  return `${(bytesPerSecond / 1e3).toFixed(0)} KB/s`
}

export function formatRuntime(minutes: number | null | undefined): string {
  const total = Number(minutes)
  if (!Number.isFinite(total) || total < 1) return ""
  const hours = Math.floor(total / 60)
  const rest = Math.round(total % 60)
  if (!hours) return `${rest}m`
  return rest ? `${hours}h ${rest}m` : `${hours}h`
}

export function formatRating(rating: number | null | undefined): string {
  const value = Number(rating)
  if (!Number.isFinite(value) || value <= 0) return ""
  return value.toFixed(1)
}

export function formatPercent(fraction: number): string {
  const value = Number(fraction)
  if (!Number.isFinite(value) || value <= 0) return "0%"
  return `${Math.min(100, Math.round(value * 100))}%`
}

export function formatElapsed(milliseconds: number): string {
  const total = Math.max(0, Math.round(Number(milliseconds) / 1000))
  if (!Number.isFinite(total)) return "0s"
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  return minutes ? `${minutes}m ${seconds}s` : `${seconds}s`
}
