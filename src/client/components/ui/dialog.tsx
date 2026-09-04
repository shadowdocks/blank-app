import * as React from "react"
import { X } from "lucide-react"
import { Dialog as DialogPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

const Dialog = DialogPrimitive.Root
const DialogTrigger = DialogPrimitive.Trigger
const DialogPortal = DialogPrimitive.Portal
const DialogClose = DialogPrimitive.Close
const DialogTitle = DialogPrimitive.Title
const DialogDescription = DialogPrimitive.Description

function DialogOverlay({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      data-slot="dialog-overlay"
      className={cn(
        "fixed inset-0 z-70 bg-black/70 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:duration-200 data-[state=closed]:duration-150",
        className
      )}
      {...props}
    />
  )
}

/**
 * Content is a full-screen sheet on phones and a centred panel from `sm` up.
 * `size` picks the panel width; `immersive` removes the padding so scenes can
 * bleed to the panel edge. `container` portals into an element that stays
 * visible in native fullscreen (for example the media player).
 */
function DialogContent({
  className,
  children,
  size = "md",
  immersive = false,
  showClose = true,
  closeLabel = "Close",
  container,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
  size?: "md" | "lg" | "xl"
  immersive?: boolean
  showClose?: boolean
  closeLabel?: string
  container?: HTMLElement | null
}) {
  const width = size === "xl" ? "sm:max-w-5xl" : size === "lg" ? "sm:max-w-3xl" : "sm:max-w-xl"
  return (
    <DialogPortal container={container ?? undefined}>
      <DialogOverlay />
      <DialogPrimitive.Content
        data-slot="dialog-content"
        className={cn(
          "fixed inset-0 z-80 flex flex-col overflow-hidden bg-card text-card-foreground outline-none",
          "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:duration-250 data-[state=closed]:duration-150",
          "data-[state=open]:slide-in-from-bottom-4 data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0",
          "sm:inset-auto sm:left-1/2 sm:top-1/2 sm:w-[calc(100%-2rem)] sm:max-h-[92svh] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl sm:border sm:border-white/8 sm:shadow-[0_30px_80px_rgb(0_0_0/0.6)]",
          "sm:data-[state=open]:zoom-in-95 sm:data-[state=closed]:zoom-out-95 sm:data-[state=open]:slide-in-from-bottom-0",
          width,
          immersive ? "" : "p-5 sm:p-6",
          className
        )}
        {...props}
      >
        {children}
        {showClose ? (
          <DialogPrimitive.Close
            className="absolute right-3 top-3 z-20 grid size-11 place-items-center rounded-full bg-black/55 text-white outline-none transition-colors hover:bg-black/75 focus-visible:ring-3 focus-visible:ring-white/60 sm:right-4 sm:top-4"
            aria-label={closeLabel}
          >
            <X className="size-5" aria-hidden="true" />
          </DialogPrimitive.Close>
        ) : null}
      </DialogPrimitive.Content>
    </DialogPortal>
  )
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="dialog-header" className={cn("flex flex-col gap-1.5", className)} {...props} />
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
}
