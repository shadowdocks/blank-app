import { CircleAlert, Inbox, RotateCcw } from "lucide-react"

import { EmptyState } from "@/components/empty-state"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

export function PageContainer({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`page-container ${className}`}>{children}</div>
}

/** Standard header block for non-scene pages, sitting below the fixed chrome. */
export function PageHeading({ eyebrow, title, children, className }: { eyebrow?: string; title: string; children?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-wrap items-end justify-between gap-4", className)}>
      <div>{eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}<h1 className="page-title">{title}</h1></div>
      {children}
    </div>
  )
}

export function PageSkeleton({ variant = "grid" }: { variant?: "grid" | "title" | "watch" | "stage" }) {
  if (variant === "watch") return <div className="watch-route" aria-busy="true"><div className="skeleton h-full w-full bg-black" /></div>
  if (variant === "title") return <div className="animate-fade"><div className="skeleton h-[42svh] min-h-64 w-full" /><div className="space-y-4 p-5 sm:p-8"><div className="skeleton h-9 w-2/3 rounded" /><div className="skeleton h-4 w-full rounded" /><div className="skeleton h-4 w-4/5 rounded" /><div className="skeleton mt-6 h-11 w-40 rounded-lg" /></div></div>
  if (variant === "stage") return (
    <div className="animate-fade" aria-busy="true">
      <div className="lg:pt-20"><div className="stage-frame skeleton min-h-[64svh] sm:min-h-[60svh] lg:min-h-[34rem]" /></div>
      <PageContainer className="py-8"><div className="skeleton h-7 w-48 rounded" /><div className="mt-4 media-rail" data-inset="true">{Array.from({ length: 8 }, (_, index) => <div key={index} className="rail-card skeleton aspect-2/3 rounded-lg" />)}</div></PageContainer>
    </div>
  )
  return <PageContainer className="pt-24"><div className="skeleton h-8 w-48 rounded" /><div className="mt-6 media-grid">{Array.from({ length: 10 }, (_, index) => <div key={index}><div className="skeleton aspect-2/3 rounded-lg" /><div className="mt-3 skeleton h-4 w-4/5 rounded" /></div>)}</div></PageContainer>
}

export function ErrorState({ message, onRetry, compact = false }: { message: string; onRetry: () => void; compact?: boolean }) {
  const body = <EmptyState icon={CircleAlert} title="We couldn’t load this" description={message}><Button onClick={onRetry}><RotateCcw aria-hidden="true" />Try again</Button></EmptyState>
  return compact ? body : <PageContainer className="py-24">{body}</PageContainer>
}

export function CollectionEmpty({ title, description }: { title: string; description: string }) {
  return <EmptyState icon={Inbox} title={title} description={description} />
}
