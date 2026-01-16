'use client'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000'

export interface User {
  id: string
  phone: string
  name: string | null
  type: 'rider' | 'driver'
  tenantId: string
  isNewUser?: boolean
}

export interface AuthState {
  user: User | null
  token: string | null
  isAuthenticated: boolean
}

// Store auth state in localStorage - separate keys for rider and driver
// This allows side-by-side sessions in the same browser
const AUTH_STORAGE_KEY = (userType?: 'rider' | 'driver') => 
  userType ? `gocomet_auth_${userType}` : 'gocomet_auth'

export function getStoredAuth(userType?: 'rider' | 'driver'): AuthState {
  if (typeof window === 'undefined') {
    return { user: null, token: null, isAuthenticated: false }
  }
  
  try {
    // If specific user type requested, only check that key
    if (userType) {
      const stored = localStorage.getItem(AUTH_STORAGE_KEY(userType))
      if (stored) {
        const parsed = JSON.parse(stored)
        return {
          user: parsed.user,
          token: parsed.token,
          isAuthenticated: !!parsed.token,
        }
      }
      // Not found in type-specific key, return empty
      return { user: null, token: null, isAuthenticated: false }
    }
    
    // No user type specified - check both keys (for api.ts compatibility)
    // Try rider first, then driver, then generic key
    const riderStored = localStorage.getItem(AUTH_STORAGE_KEY('rider'))
    if (riderStored) {
      const parsed = JSON.parse(riderStored)
      return {
        user: parsed.user,
        token: parsed.token,
        isAuthenticated: !!parsed.token,
      }
    }
    
    const driverStored = localStorage.getItem(AUTH_STORAGE_KEY('driver'))
    if (driverStored) {
      const parsed = JSON.parse(driverStored)
      return {
        user: parsed.user,
        token: parsed.token,
        isAuthenticated: !!parsed.token,
      }
    }
    
    // Fallback to generic key (for backward compatibility)
    const stored = localStorage.getItem(AUTH_STORAGE_KEY())
    if (stored) {
      const parsed = JSON.parse(stored)
      return {
        user: parsed.user,
        token: parsed.token,
        isAuthenticated: !!parsed.token,
      }
    }
  } catch (error) {
    console.error('Failed to parse stored auth:', error)
  }
  
  return { user: null, token: null, isAuthenticated: false }
}

export function setStoredAuth(user: User, token: string): void {
  if (typeof window === 'undefined') return
  
  // Store in user-type-specific key
  const key = AUTH_STORAGE_KEY(user.type)
  localStorage.setItem(key, JSON.stringify({ user, token }))
  
  // Also store in generic key for backward compatibility
  localStorage.setItem(AUTH_STORAGE_KEY(), JSON.stringify({ user, token }))
}

export function clearStoredAuth(userType?: 'rider' | 'driver'): void {
  if (typeof window === 'undefined') return
  
  if (userType) {
    // Clear user-type-specific key
    localStorage.removeItem(AUTH_STORAGE_KEY(userType))
  } else {
    // Clear all auth keys
    localStorage.removeItem(AUTH_STORAGE_KEY('rider'))
    localStorage.removeItem(AUTH_STORAGE_KEY('driver'))
    localStorage.removeItem(AUTH_STORAGE_KEY())
  }
}

export interface Tenant {
  id: string
  name: string
  region: string
}

// API functions

export async function getTenants(): Promise<Tenant[]> {
  try {
    const response = await fetch(`${API_URL}/v1/auth/tenants`)
    const data = await response.json()
    return data.success ? data.data : []
  } catch (error) {
    console.error('Failed to fetch tenants:', error)
    return []
  }
}

export async function sendOtp(phone: string, userType: 'rider' | 'driver'): Promise<{
  success: boolean
  message?: string
  otp?: string // Only in development
  error?: string
}> {
  try {
    const response = await fetch(`${API_URL}/v1/auth/send-otp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone, user_type: userType }),
    })
    
    const data = await response.json()
    
    if (data.success) {
      return {
        success: true,
        message: data.data.message,
        otp: data.data.otp, // Available in development
      }
    }
    
    return {
      success: false,
      error: data.error?.message || 'Failed to send OTP',
    }
  } catch (error) {
    return {
      success: false,
      error: 'Network error. Please try again.',
    }
  }
}

export async function verifyOtp(
  phone: string,
  otp: string,
  userType: 'rider' | 'driver',
  tenantId: string
): Promise<{
  success: boolean
  user?: User
  token?: string
  message?: string
  error?: string
}> {
  try {
    const response = await fetch(`${API_URL}/v1/auth/verify-otp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        phone,
        otp,
        user_type: userType,
        tenant_id: tenantId,
      }),
    })
    
    const data = await response.json()
    
    if (data.success) {
      const user = data.data.user
      const token = data.data.token
      
      // Store auth
      setStoredAuth(user, token)
      
      return {
        success: true,
        user,
        token,
        message: data.message,
      }
    }
    
    return {
      success: false,
      error: data.error?.message || 'Invalid OTP',
    }
  } catch (error) {
    return {
      success: false,
      error: 'Network error. Please try again.',
    }
  }
}

export async function logout(userType?: 'rider' | 'driver'): Promise<void> {
  const auth = getStoredAuth(userType)
  
  if (auth.token) {
    try {
      await fetch(`${API_URL}/v1/auth/logout`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${auth.token}`,
        },
      })
    } catch (error) {
      // Ignore errors
    }
  }
  
  clearStoredAuth(userType)
}

export async function updateProfile(data: { name?: string; email?: string }): Promise<{
  success: boolean
  user?: User
  error?: string
}> {
  const auth = getStoredAuth()
  
  if (!auth.token) {
    return { success: false, error: 'Not authenticated' }
  }
  
  try {
    const response = await fetch(`${API_URL}/v1/auth/profile`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${auth.token}`,
      },
      body: JSON.stringify(data),
    })
    
    const result = await response.json()
    
    if (result.success) {
      // Update stored user
      const updatedUser = { ...auth.user!, ...result.data }
      setStoredAuth(updatedUser, auth.token)
      
      return { success: true, user: updatedUser }
    }
    
    return { success: false, error: result.error?.message }
  } catch (error) {
    return { success: false, error: 'Network error' }
  }
}
