import * as React from "react"
import { Check, ChevronDown } from "lucide-react"
import { Select as SelectPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

export const Select = SelectPrimitive.Root
export const SelectValue = SelectPrimitive.Value

export function SelectTrigger({ className, children, ...props }: React.ComponentProps<typeof SelectPrimitive.Trigger>) {
  return <SelectPrimitive.Trigger className={cn("inline-flex h-11 min-w-36 items-center justify-between gap-3 rounded-lg border border-input bg-card px-3 text-sm outline-none transition-colors hover:bg-accent focus-visible:ring-3 focus-visible:ring-ring/50", className)} {...props}>{children}<SelectPrimitive.Icon><ChevronDown className="size-4 text-muted-foreground" /></SelectPrimitive.Icon></SelectPrimitive.Trigger>
}

export function SelectContent({ children, ...props }: React.ComponentProps<typeof SelectPrimitive.Content>) {
  return <SelectPrimitive.Portal><SelectPrimitive.Content position="popper" sideOffset={6} className="z-60 min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-2xl" {...props}><SelectPrimitive.Viewport className="max-h-[min(24rem,var(--radix-select-content-available-height))] overflow-y-auto">{children}</SelectPrimitive.Viewport></SelectPrimitive.Content></SelectPrimitive.Portal>
}

export function SelectItem({ children, className, ...props }: React.ComponentProps<typeof SelectPrimitive.Item>) {
  return <SelectPrimitive.Item className={cn("relative flex min-h-11 select-none items-center rounded-md py-2 pl-8 pr-3 text-sm outline-none data-[highlighted]:bg-accent data-[disabled]:opacity-50", className)} {...props}><span className="absolute left-2"><SelectPrimitive.ItemIndicator><Check className="size-4 text-primary" /></SelectPrimitive.ItemIndicator></span><SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText></SelectPrimitive.Item>
}
