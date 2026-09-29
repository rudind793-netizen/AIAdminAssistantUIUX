/// <reference types="vite/client" />
 
interface ImportMetaEnv {
  readonly VITE_REGISTER_URL: string
  readonly VITE_LOGIN_URL: string
  readonly VITE_CHAT_URL: string
  readonly VITE_UPLOAD_URL: string
  readonly VITE_UPLOAD_SOP_URL: string
  readonly VITE_GET_SOP_DOCS_URL: string
  readonly VITE_DELETE_SOP_URL: string
  readonly VITE_GET_SIGNED_URL: string
  readonly VITE_ADMIN_DOMAIN: string
  readonly VITE_USER_DOMAIN: string
}
 
interface ImportMeta {
  readonly env: ImportMetaEnv
}
 