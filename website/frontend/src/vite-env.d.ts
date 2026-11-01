/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string
  readonly VITE_PORTAL_PREVIEW?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
