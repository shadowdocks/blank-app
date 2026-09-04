import { useRoute as useRouteFromRouter, navigate, toPath, type Route } from "@/lib/router"

export { useRouteFromRouter as useRoute, navigate, toPath }
export type { Route }

export function useNavigate() {
  return navigate
}
