import { CircleAlert, Inbox, RotateCcw } from "lucide-react"

import { EmptyState } from "@/components/empty-state"
import { Button } from "@/components/ui/button"

export function PageContainer({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`page-container ${className}`}>{children}</div>
}

export function PageSkeleton({ variant = "grid" }: { variant?: "grid" | "title" | "watch" }) {
  if (variant === "watch") return <PageContainer className="py-6"><div className="skeleton aspect-video rounded-xl" /><div className="mt-5 h-8 w-2/5 skeleton rounded" /></PageContainer>
  if (variant === "title") return <><div className="skeleton h-[55svh] min-h-105 w-full" /><PageContainer className="-mt-24 relative grid gap-5 sm:grid-cols-[12rem_1fr]"><div className="skeleton aspect-2/3 rounded-lg" /><div className="space-y-4 pt-8"><div className="skeleton h-10 w-2/3 rounded" /><div className="skeleton h-4 w-full rounded" /><div className="skeleton h-4 w-4/5 rounded" /></div></PageContainer></>
  return <PageContainer className="py-8"><div className="skeleton h-8 w-48 rounded" /><div className="mt-6 media-grid">{Array.from({ length: 10 }, (_, index) => <div key={index}><div className="skeleton aspect-2/3 rounded-lg" /><div className="mt-3 skeleton h-4 w-4/5 rounded" /></div>)}</div></PageContainer>
}

export function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return <PageContainer className="py-12"><EmptyState icon={CircleAlert} title="We couldn’t load this" description={message}><Button onClick={onRetry}><RotateCcw aria-hidden="true" />Try again</Button></EmptyState></PageContainer>
}

export function CollectionEmpty({ title, description }: { title: string; description: string }) {
  return <EmptyState icon={Inbox} title={title} description={description} />
}
