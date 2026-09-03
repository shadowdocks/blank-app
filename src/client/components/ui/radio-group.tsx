import * as React from "react"
import { Check } from "lucide-react"
import { RadioGroup as RadioGroupPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

function RadioGroup({
  className,
  ...props
}: React.ComponentProps<typeof RadioGroupPrimitive.Root>) {
  return (
    <RadioGroupPrimitive.Root
      data-slot="radio-group"
      className={cn("grid gap-2", className)}
      {...props}
    />
  )
}

/**
 * A radio rendered as a selectable card. Roving focus, arrow-key movement and
 * type-ahead come from the Radix primitive; only the surface is ours.
 */
function RadioGroupCard({
  className,
  children,
  ...props
}: React.ComponentProps<typeof RadioGroupPrimitive.Item>) {
  return (
    <RadioGroupPrimitive.Item
      data-slot="radio-group-card"
      className={cn(
        "group/card relative flex w-full flex-col items-start gap-0.5 rounded-md border border-border bg-card px-3 py-2.5 pr-9 text-left transition-colors outline-none",
        "hover:border-input hover:bg-accent",
        "focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40",
        "data-[state=checked]:border-primary/70 data-[state=checked]:bg-primary/10",
        "disabled:pointer-events-none disabled:opacity-50",
        className
      )}
      {...props}
    >
      {children}
      <span
        aria-hidden="true"
        className="absolute top-1/2 right-3 flex size-4 -translate-y-1/2 items-center justify-center rounded-full border border-input transition-colors group-data-[state=checked]/card:border-primary group-data-[state=checked]/card:bg-primary"
      >
        <RadioGroupPrimitive.Indicator data-slot="radio-group-indicator" asChild>
          <Check className="size-3 text-primary-foreground" strokeWidth={3} />
        </RadioGroupPrimitive.Indicator>
      </span>
    </RadioGroupPrimitive.Item>
  )
}

export { RadioGroup, RadioGroupCard }
