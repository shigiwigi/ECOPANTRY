/**
 * Google sign-in through Firebase Auth. Firebase is large, so nothing here is
 * imported statically: the SDK is fetched only when a staff member uses Google
 * sign-in (or returns from its redirect), and sign-out only touches it if it
 * was loaded. Public pages never download it.
 *
 * Firebase only proves who the Google account is. The backend verifies the ID
 * token (`POST /auth/google`) and issues its own session cookie.
 */
import type { Auth } from "firebase/auth"

const REDIRECT_FLAG = "ecopantry-google-redirect"

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || "",
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "ecopantry-a7342.firebaseapp.com",
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || "ecopantry-a7342",
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || "ecopantry-a7342.appspot.com",
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "",
  appId: import.meta.env.VITE_FIREBASE_APP_ID || "",
}

/** Set once the SDK has been loaded; sign-out uses it to avoid loading Firebase just to sign out. */
let loadedAuth: Auth | null = null

export class GoogleSignInUnavailable extends Error {
  constructor() {
    super("Google sign-in isn't set up in this build.")
    this.name = "GoogleSignInUnavailable"
  }
}

async function loadAuth() {
  if (!firebaseConfig.apiKey) throw new GoogleSignInUnavailable()
  const [{ getApp, getApps, initializeApp }, firebaseAuth] = await Promise.all([
    import("firebase/app"),
    import("firebase/auth"),
  ])
  const app = getApps().length ? getApp() : initializeApp(firebaseConfig)
  const auth = firebaseAuth.getAuth(app)
  loadedAuth = auth
  return { auth, firebaseAuth }
}

/** The Firebase error code (`auth/popup-closed-by-user`, ...) of a thrown value, if it has one. */
export function firebaseErrorCode(error: unknown): string | null {
  if (error && typeof error === "object" && "code" in error) {
    const { code } = error as { code: unknown }
    if (typeof code === "string" && code.startsWith("auth/")) return code
  }
  return null
}

/**
 * Opens the Google account chooser and returns a Firebase ID token for the
 * backend. Returns null when the browser blocked the popup and the page is
 * about to redirect instead; `completeGoogleRedirect` picks the result up.
 */
export async function signInWithGoogle(): Promise<string | null> {
  const { auth, firebaseAuth } = await loadAuth()
  const provider = new firebaseAuth.GoogleAuthProvider()
  provider.setCustomParameters({ prompt: "select_account" })
  try {
    const result = await firebaseAuth.signInWithPopup(auth, provider)
    return await result.user.getIdToken()
  } catch (error) {
    const code = firebaseErrorCode(error)
    if (code === "auth/popup-blocked" || code === "auth/cancelled-popup-request") {
      try {
        window.sessionStorage.setItem(REDIRECT_FLAG, "1")
      } catch {
        // Without the flag the redirect result is simply not picked up.
      }
      await firebaseAuth.signInWithRedirect(auth, provider)
      return null
    }
    throw error
  }
}

/** True when this page load is the return from a Google redirect started by `signInWithGoogle`. */
export function returningFromGoogleRedirect(): boolean {
  try {
    return window.sessionStorage.getItem(REDIRECT_FLAG) === "1"
  } catch {
    return false
  }
}

/** The ID token from a finished Google redirect, or null if there isn't one. */
export async function completeGoogleRedirect(): Promise<string | null> {
  try {
    window.sessionStorage.removeItem(REDIRECT_FLAG)
  } catch {
    // Nothing to clear.
  }
  const { auth, firebaseAuth } = await loadAuth()
  const result = await firebaseAuth.getRedirectResult(auth)
  return result ? await result.user.getIdToken() : null
}

/** Ends the Firebase client session, if Firebase was ever loaded in this page. Never throws. */
export async function signOutOfGoogle(): Promise<void> {
  if (!loadedAuth?.currentUser) return
  try {
    await loadedAuth.signOut()
  } catch {
    // The backend session is what matters; the Firebase one holds no access.
  }
}
