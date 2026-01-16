'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { getStoredAuth, User } from '@/lib/auth'
import { Loader2 } from 'lucide-react'

interface AuthGuardProps {
  children: React.ReactNode
  requiredType?: 'rider' | 'driver'
}

export default function AuthGuard({ children, requiredType }: AuthGuardProps) {
  const router = useRouter()
  const [isLoading, setIsLoading] = useState(true)
  const [user, setUser] = useState<User | null>(null)

  useEffect(() => {
    // Get auth for the required user type (if specified)
    const auth = getStoredAuth(requiredType)

    if (!auth.isAuthenticated) {
      router.push(`/login${requiredType ? `?type=${requiredType}` : ''}`)
      return
    }

    if (requiredType && auth.user?.type !== requiredType) {
      router.push(`/${auth.user?.type || 'login'}`)
      return
    }

    setUser(auth.user)
    setIsLoading(false)
  }, [router, requiredType])

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-100">
        <div className="text-center">
          <Loader2 className="w-8 h-8 animate-spin text-primary-600 mx-auto" />
          <p className="mt-2 text-slate-600">Loading...</p>
        </div>
      </div>
    )
  }

  return <>{children}</>
}

// Hook to get current user
export function useAuth(userType?: 'rider' | 'driver') {
  const [auth, setAuth] = useState(getStoredAuth(userType))

  useEffect(() => {
    setAuth(getStoredAuth(userType))
  }, [userType])

  return auth
}
