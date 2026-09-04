import * as React from "react"
import { Switch as SwitchPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

/** Neutral toggle with a 44px hit area. */
function Switch({ className, ...props }: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        "group/switch relative inline-flex h-11 w-14 shrink-0 items-center justify-center outline-none",
        "disabled:cursor-default disabled:opacity-50",
        className
      )}
      {...props}
    >
      <span
        aria-hidden="true"
        className="relative block h-7 w-12 rounded-full bg-input transition-colors group-data-[state=checked]/switch:bg-primary group-focus-visible/switch:ring-3 group-focus-visible/switch:ring-ring/50"
      >
        <SwitchPrimitive.Thumb className="absolute left-0.5 top-0.5 block size-6 rounded-full bg-white shadow-[0_1px_3px_rgb(0_0_0/0.4)] transition-transform data-[state=checked]:translate-x-5 data-[state=checked]:bg-primary-foreground" />
      </span>
    </SwitchPrimitive.Root>
  )
}

export { Switch }
