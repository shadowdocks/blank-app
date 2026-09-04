import { StrictMode } from "react"
import { createRoot } from "react-dom/client"

import App from "@/App"
import "@/index.css"
import { ensureManifestLink, registerServiceWorker } from "@/offline"

ensureManifestLink()
if (import.meta.env.PROD) void registerServiceWorker()

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
