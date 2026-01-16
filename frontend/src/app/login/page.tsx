'use client'

import { useState, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { Phone, ArrowRight, Loader2, User, Car, MapPin } from 'lucide-react'
import { getTenants, sendOtp, verifyOtp, getStoredAuth, Tenant } from '@/lib/auth'

type Step = 'phone' | 'otp'
type UserType = 'rider' | 'driver'

export default function LoginPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const typeParam = searchParams.get('type') as UserType | null

  const [step, setStep] = useState<Step>('phone')
  const [userType, setUserType] = useState<UserType>(typeParam || 'rider')
  const [phone, setPhone] = useState('')
  const [otp, setOtp] = useState('')
  const [tenants, setTenants] = useState<Tenant[]>([])
  const [selectedTenant, setSelectedTenant] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [devOtp, setDevOtp] = useState<string | null>(null)
  const [phoneError, setPhoneError] = useState('')

  // Sync userType with URL parameter
  useEffect(() => {
    if (typeParam && typeParam !== userType) {
      setUserType(typeParam)
      setStep('phone') // Reset to phone step when switching types
      setPhone('')
      setOtp('')
      setError('')
    }
  }, [typeParam, userType])

  // Extract only digits from phone for validation
  const getDigitsOnly = (value: string) => value.replace(/\D/g, '')
  
  // Validate phone number (10 digits)
  const isValidPhone = (value: string) => {
    const digits = getDigitsOnly(value)
    // Allow 10 digits or 12 digits (with country code like 91)
    return digits.length === 10 || (digits.length === 12 && digits.startsWith('91'))
  }

  // Format phone number as user types
  const handlePhoneChange = (value: string) => {
    // Remove any non-digit except + at start
    let formatted = value.replace(/[^\d+]/g, '')
    
    // If starts with +91, keep it
    if (formatted.startsWith('+91')) {
      const rest = formatted.slice(3).replace(/\D/g, '').slice(0, 10)
      formatted = '+91 ' + rest
    } else if (formatted.startsWith('91') && formatted.length > 2) {
      const rest = formatted.slice(2).slice(0, 10)
      formatted = '+91 ' + rest
    } else {
      // Just digits, max 10
      formatted = formatted.replace(/\D/g, '').slice(0, 10)
    }
    
    setPhone(formatted)
    
    // Clear error when user starts typing
    if (phoneError) setPhoneError('')
  }

  // Check if already logged in for the specific user type
  useEffect(() => {
    const auth = getStoredAuth(userType) // Check auth for the selected user type
    if (auth.isAuthenticated && auth.user?.type === userType) {
      router.push(userType === 'driver' ? '/driver' : '/rider')
    }
  }, [router, userType])

  // Fetch tenants
  useEffect(() => {
    getTenants().then((data) => {
      setTenants(data)
      if (data.length > 0) {
        setSelectedTenant(data[0].id)
      }
    })
  }, [])

  const handleSendOtp = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setPhoneError('')

    // Validate phone number
    if (!isValidPhone(phone)) {
      setPhoneError('Please enter a valid 10-digit phone number')
      return
    }

    setLoading(true)

    // Format phone for API (ensure it has country code)
    const digits = getDigitsOnly(phone)
    const formattedPhone = digits.length === 10 ? `+91${digits}` : `+${digits}`

    const result = await sendOtp(formattedPhone, userType)

    if (result.success) {
      setStep('otp')
      if (result.otp) {
        setDevOtp(result.otp) // Show OTP in development
      }
    } else {
      setError(result.error || 'Failed to send OTP')
    }

    setLoading(false)
  }

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    // Format phone for API
    const digits = getDigitsOnly(phone)
    const formattedPhone = digits.length === 10 ? `+91${digits}` : `+${digits}`

    const result = await verifyOtp(formattedPhone, otp, userType, selectedTenant)

    if (result.success) {
      // Redirect based on user type
      router.push(userType === 'driver' ? '/driver' : '/rider')
    } else {
      setError(result.error || 'Invalid OTP')
    }

    setLoading(false)
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-900 via-indigo-800 to-purple-900 flex items-center justify-center p-4">
      {/* Background decorations */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-20 right-20 w-64 h-64 bg-purple-500/20 rounded-3xl transform rotate-12 blur-xl" />
        <div className="absolute bottom-20 left-20 w-48 h-48 bg-blue-500/20 rounded-3xl transform -rotate-6 blur-xl" />
      </div>
      
      <div className="w-full max-w-md relative z-10">
        {/* Logo */}
        <div className="text-center mb-8">
          <Link href="/" className="inline-flex items-center justify-center gap-2">
            <div className="w-10 h-10 bg-white rounded-xl flex items-center justify-center shadow-lg">
              <span className="text-blue-600 font-bold text-xl">G</span>
            </div>
            <h1 className="text-4xl font-bold text-white">GoComet</h1>
          </Link>
          <p className="text-blue-200 mt-2">Ride Hailing Platform</p>
        </div>

        {/* Login Card */}
        <div className="card p-8">
          {/* User Type Toggle */}
          <div className="flex gap-2 mb-6">
            <button
              onClick={() => setUserType('rider')}
              className={`flex-1 py-3 px-4 rounded-lg font-medium flex items-center justify-center gap-2 transition-all ${
                userType === 'rider'
                  ? 'bg-primary-600 text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              <User className="w-5 h-5" />
              Rider
            </button>
            <button
              onClick={() => setUserType('driver')}
              className={`flex-1 py-3 px-4 rounded-lg font-medium flex items-center justify-center gap-2 transition-all ${
                userType === 'driver'
                  ? 'bg-primary-600 text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              <Car className="w-5 h-5" />
              Driver
            </button>
          </div>

          <h2 className="text-xl font-semibold text-slate-800 mb-2">
            {step === 'phone' ? 'Login / Register' : 'Enter OTP'}
          </h2>
          <p className="text-slate-600 text-sm mb-6">
            {step === 'phone'
              ? `Enter your phone number to continue as a ${userType}`
              : `We sent a code to +91 ${getDigitsOnly(phone).slice(-10)}`}
          </p>

          {step === 'phone' ? (
            <form onSubmit={handleSendOtp}>
              {/* Tenant Selection */}
              <div className="mb-4">
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  <MapPin className="w-4 h-4 inline mr-1" />
                  City
                </label>
                <select
                  value={selectedTenant}
                  onChange={(e) => setSelectedTenant(e.target.value)}
                  className="input"
                  required
                >
                  {tenants.map((tenant) => (
                    <option key={tenant.id} value={tenant.id}>
                      {tenant.name} ({tenant.region})
                    </option>
                  ))}
                </select>
              </div>

              {/* Phone Input */}
              <div className="mb-6">
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  <Phone className="w-4 h-4 inline mr-1" />
                  Phone Number
                </label>
                <div className="flex gap-2">
                  <div className="flex items-center px-3 bg-slate-100 border border-slate-300 rounded-lg text-slate-600 text-sm">
                    +91
                  </div>
                  <input
                    type="tel"
                    value={phone.replace(/^\+91\s?/, '')}
                    onChange={(e) => handlePhoneChange(e.target.value)}
                    placeholder="9876543210"
                    className={`input flex-1 ${phoneError ? 'border-red-500 focus:border-red-500 focus:ring-red-500' : ''}`}
                    maxLength={10}
                    required
                  />
                </div>
                {phoneError && (
                  <p className="mt-1 text-sm text-red-600">{phoneError}</p>
                )}
                <p className="mt-1 text-xs text-slate-500">Enter 10-digit mobile number</p>
              </div>

              {error && (
                <div className="mb-4 p-3 bg-red-50 text-red-700 rounded-lg text-sm">
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={loading || !isValidPhone(phone)}
                className="btn btn-primary w-full flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? (
                  <Loader2 className="w-5 h-5 animate-spin" />
                ) : (
                  <>
                    Send OTP
                    <ArrowRight className="w-5 h-5" />
                  </>
                )}
              </button>
            </form>
          ) : (
            <form onSubmit={handleVerifyOtp}>
              {/* OTP Input */}
              <div className="mb-6">
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  Enter 6-digit OTP
                </label>
                <input
                  type="text"
                  value={otp}
                  onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="123456"
                  className="input text-center text-2xl tracking-widest"
                  maxLength={6}
                  required
                  autoFocus
                />
              </div>

              {/* Dev OTP Display */}
              {devOtp && (
                <div className="mb-4 p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
                  <p className="text-xs text-yellow-600 font-medium">Development Mode</p>
                  <p className="text-lg font-mono font-bold text-yellow-800">{devOtp}</p>
                </div>
              )}

              {error && (
                <div className="mb-4 p-3 bg-red-50 text-red-700 rounded-lg text-sm">
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={loading || otp.length !== 6}
                className="btn btn-primary w-full flex items-center justify-center gap-2"
              >
                {loading ? (
                  <Loader2 className="w-5 h-5 animate-spin" />
                ) : (
                  <>
                    Verify & Continue
                    <ArrowRight className="w-5 h-5" />
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={() => {
                  setStep('phone')
                  setOtp('')
                  setDevOtp(null)
                }}
                className="w-full mt-3 text-sm text-primary-600 hover:text-primary-700"
              >
                Change phone number
              </button>
            </form>
          )}

          {/* Demo Hint */}
          <div className="mt-6 pt-6 border-t border-slate-200 text-center">
            <p className="text-xs text-slate-500">
              Demo: Use OTP <span className="font-mono font-bold">123456</span> to login
            </p>
          </div>
        </div>

        {/* Footer */}
        <p className="text-center text-primary-200 text-sm mt-6">
          By continuing, you agree to our Terms of Service
        </p>
      </div>
    </div>
  )
}
