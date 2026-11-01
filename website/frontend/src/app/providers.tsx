import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { useState, type ReactNode } from "react"
import { AuthProvider } from "@/features/auth/AuthProvider"
import { ThemeProvider } from "@/features/theme/ThemeProvider"
import { ApiError } from "@/lib/api/client"

function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        refetchOnWindowFocus: false,
        // Retrying won't fix a 4xx; only retry network and server errors.
        retry: (failureCount, error) =>
          failureCount < 2 && !(error instanceof ApiError && error.status !== null && error.status < 500),
      },
    },
  })
}

export function AppProviders({ children }: { children: ReactNode }) {
  const [queryClient] = useState(createQueryClient)

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <AuthProvider>{children}</AuthProvider>
      </ThemeProvider>
    </QueryClientProvider>
  )
}
