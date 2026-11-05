import { initializeApp, getApps, getApp, type FirebaseApp } from "firebase/app"
import {
  getAuth,
  GoogleAuthProvider,
  setPersistence,
  browserLocalPersistence,
  type Auth,
} from "firebase/auth"

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || "",
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "ecopantry-a7342.firebaseapp.com",
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || "ecopantry-a7342",
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || "ecopantry-a7342.appspot.com",
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "",
  appId: import.meta.env.VITE_FIREBASE_APP_ID || "",
}

let app: FirebaseApp | undefined
let authInstance: Auth | undefined

try {
  if (firebaseConfig.apiKey) {
    app = !getApps().length ? initializeApp(firebaseConfig) : getApp()
    authInstance = getAuth(app)

    if (typeof window !== "undefined") {
      void setPersistence(authInstance, browserLocalPersistence).catch((err) => {
        console.warn("Could not set browserLocalPersistence:", err)
      })
    }
  }
} catch (error) {
  console.warn("Firebase client failed to initialize:", error)
}

export const auth = authInstance as Auth
export const googleProvider = new GoogleAuthProvider()