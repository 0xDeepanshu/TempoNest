// electron-vite loads MAIN_VITE_* variables from .env files or the build shell
// and replaces import.meta.env.* in the main-process bundle at build time.
interface ImportMetaEnv {
  readonly MAIN_VITE_TEMPO_API_BASE_URL?: string
  readonly MAIN_VITE_TEMPO_WS_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
