import * as React from "react"

import { navigate, toPath, type Route } from "@/lib/router"

/**
 * A real anchor, so links can be copied, opened in a new tab and reached by
 * keyboard, with plain left clicks handed to the History API instead.
 */
export function AppLink({
  route,
  replace = false,
  onClick,
  ...props
}: Omit<React.ComponentProps<"a">, "href"> & { route: Route; replace?: boolean }) {
  return (
    <a
      href={toPath(route)}
      onClick={(event) => {
        onClick?.(event)
        if (event.defaultPrevented) return
        if (event.button !== 0) return
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
        event.preventDefault()
        navigate(route, { replace })
      }}
      {...props}
    />
  )
}
