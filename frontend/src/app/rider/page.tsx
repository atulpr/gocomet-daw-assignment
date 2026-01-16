'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import dynamic from 'next/dynamic'
import { api } from '@/lib/api'
import { getStoredAuth, logout, User } from '@/lib/auth'
import { registerUser, subscribeToRide, onEvent, unsubscribeFromRide } from '@/lib/socket'
import { MapPin, Navigation, Car, Clock, IndianRupee, X, CheckCircle, LogOut, User as UserIcon, CreditCard, Wallet, Banknote, Loader2, Star } from 'lucide-react'

// Dynamic import for Map to avoid SSR issues with Leaflet
const MapView = dynamic(() => import('@/components/Map'), { ssr: false })

// Bangalore coordinates for demo
const BANGALORE_CENTER: [number, number] = [12.9716, 77.5946]

interface RideStatus {
  id: string
  status: string
  pickup_lat: number
  pickup_lng: number
  dropoff_lat: number
  dropoff_lng: number
  driver_name?: string
  driver_phone?: string
  vehicle_number?: string
  driver_rating?: number
  estimated_fare?: number
  tier: string
}

interface DriverLocation {
  latitude: number
  longitude: number
  heading?: number
}

export default function RiderPage() {
  const router = useRouter()
  const [user, setUser] = useState<User | null>(null)
  const [pickup, setPickup] = useState<[number, number] | null>(null)
  const [dropoff, setDropoff] = useState<[number, number] | null>(null)
  const [selectingLocation, setSelectingLocation] = useState<'pickup' | 'dropoff' | null>('pickup')
  const [tier, setTier] = useState('economy')
  const [paymentMethod, setPaymentMethod] = useState('cash')
  const [currentRide, setCurrentRide] = useState<RideStatus | null>(null)
  const [driverLocation, setDriverLocation] = useState<DriverLocation | null>(null)
  const [driverDistance, setDriverDistance] = useState<number | null>(null)
  const [driverEta, setDriverEta] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isConnected, setIsConnected] = useState(false)
  
  // Payment states
  const [showPayment, setShowPayment] = useState(false)
  const [tripId, setTripId] = useState<string | null>(null)
  const [tripFare, setTripFare] = useState<number>(0)
  const [paymentProcessing, setPaymentProcessing] = useState(false)
  const [paymentComplete, setPaymentComplete] = useState(false)
  const [rating, setRating] = useState(5)

  // Check authentication
  useEffect(() => {
    const auth = getStoredAuth('rider') // Get rider-specific session
    if (!auth.isAuthenticated || auth.user?.type !== 'rider') {
      router.push('/login?type=rider')
      return
    }
    setUser(auth.user)
  }, [router])

  // Initialize socket connection and fetch current ride
  useEffect(() => {
    if (!user) return
    
    const init = async () => {
      // Clear any stale errors
      setError(null)
      
      try {
        await registerUser(user.id, 'rider')
        setIsConnected(true)
        
        // Fetch current ride if any
        const response = await api.getRiderCurrentRide(user.id)
        if (response.success && response.data) {
          const ride = response.data as any
          setCurrentRide({
            id: ride.id,
            status: ride.status,
            pickup_lat: ride.pickup_lat,
            pickup_lng: ride.pickup_lng,
            dropoff_lat: ride.dropoff_lat,
            dropoff_lng: ride.dropoff_lng,
            driver_name: ride.driver_name,
            driver_phone: ride.driver_phone,
            vehicle_number: ride.vehicle_number,
            driver_rating: ride.driver_rating,
            estimated_fare: ride.estimated_fare,
            tier: ride.tier,
          })
          
          // If trip is completed but not paid, show payment modal
          if (ride.status === 'COMPLETED' && ride.payment_status !== 'completed') {
            setTripId(ride.trip_id)
            setTripFare(Number(ride.total_fare || ride.estimated_fare || 0))
            setShowPayment(true)
          }
        }
      } catch (err) {
        console.error('Initialization failed:', err)
      }
    }
    init()
  }, [user])

  // Subscribe to ride events when we have a current ride
  useEffect(() => {
    if (!currentRide?.id) return

    subscribeToRide(currentRide.id)

    const unsubDriverAssigned = onEvent('ride:driver_assigned', (data) => {
      setCurrentRide(prev => prev ? {
        ...prev,
        status: 'DRIVER_ASSIGNED',
        driver_name: data.driver_name,
        vehicle_number: data.vehicle_number,
        driver_rating: data.rating,
      } : null)
    })

    const unsubDriverEnRoute = onEvent('ride:driver_en_route', () => {
      setCurrentRide(prev => prev ? { ...prev, status: 'DRIVER_EN_ROUTE' } : null)
    })

    const unsubDriverArrived = onEvent('ride:driver_arrived', () => {
      setCurrentRide(prev => prev ? { ...prev, status: 'DRIVER_ARRIVED' } : null)
    })

    const unsubTripStarted = onEvent('trip:started', () => {
      setCurrentRide(prev => prev ? { ...prev, status: 'IN_PROGRESS' } : null)
      // Clear distance/ETA when trip starts (driver has arrived, trip in progress)
      setDriverDistance(null)
      setDriverEta(null)
    })

    const unsubTripCompleted = onEvent('trip:completed', (data: any) => {
      console.log('Trip completed:', data)
      setCurrentRide(prev => prev ? { ...prev, status: 'COMPLETED' } : null)
      // Show payment modal
      setTripId(data.trip_id)
      // fare can be a number or an object with 'total' property
      const fareAmount = typeof data.fare === 'number' 
        ? data.fare 
        : (data.fare?.total || currentRide?.estimated_fare || 0)
      setTripFare(Number(fareAmount) || 0)
      setShowPayment(true)
    })

    const unsubDriverLocation = onEvent('driver:location:update', (data) => {
      console.log('📍 Driver location update:', data)
      setDriverLocation({
        latitude: data.latitude,
        longitude: data.longitude,
        heading: data.heading,
      })
      // Only show distance/ETA when driver is coming to pickup (TO_PICKUP phase)
      // When trip is IN_PROGRESS (TO_DROPOFF phase), we don't show distance
      if (data.phase === 'TO_PICKUP' && data.distance !== undefined) {
        setDriverDistance(data.distance)
        setDriverEta(data.eta_minutes)
      } else if (data.phase === 'TO_DROPOFF') {
        // Clear distance/ETA when driver is going to dropoff (trip in progress)
        setDriverDistance(null)
        setDriverEta(null)
      }
      // Check if driver arrived
      if (data.arrived) {
        console.log('🎉 Driver arrived!')
        // Clear distance/ETA when driver arrives
        setDriverDistance(null)
        setDriverEta(null)
      }
    })

    return () => {
      unsubDriverAssigned()
      unsubDriverEnRoute()
      unsubDriverArrived()
      unsubTripStarted()
      unsubTripCompleted()
      unsubDriverLocation()
      unsubscribeFromRide(currentRide.id)
    }
  }, [currentRide?.id])

  // Handle map click for location selection
  const handleMapClick = useCallback((lat: number, lng: number) => {
    if (selectingLocation === 'pickup') {
      setPickup([lat, lng])
      setSelectingLocation('dropoff')
    } else if (selectingLocation === 'dropoff') {
      setDropoff([lat, lng])
      setSelectingLocation(null)
    }
  }, [selectingLocation])

  // Request a ride
  const requestRide = async () => {
    if (!pickup || !dropoff || !user) {
      setError('Please select pickup and dropoff locations')
      return
    }

    setLoading(true)
    setError(null)

    try {
      const response = await api.createRide({
        tenant_id: user.tenantId,
        rider_id: user.id,
        pickup_lat: pickup[0],
        pickup_lng: pickup[1],
        dropoff_lat: dropoff[0],
        dropoff_lng: dropoff[1],
        tier,
        payment_method: paymentMethod,
      })

      if (response.success && response.data) {
        setCurrentRide(response.data as RideStatus)
      } else {
        setError(response.error?.message || 'Failed to create ride')
      }
    } catch (err) {
      setError('Failed to request ride')
    } finally {
      setLoading(false)
    }
  }

  // Cancel ride
  const cancelRide = async () => {
    if (!currentRide) return

    setLoading(true)
    try {
      await api.cancelRide(currentRide.id, 'Cancelled by rider')
      setCurrentRide(null)
      setDriverLocation(null)
      setDriverDistance(null)
      setDriverEta(null)
    } catch (err) {
      setError('Failed to cancel ride')
    } finally {
      setLoading(false)
    }
  }

  // Process payment
  const processPayment = async () => {
    if (!tripId) return
    
    setPaymentProcessing(true)
    try {
      const response = await api.processPayment(tripId, paymentMethod)
      if (response.success) {
        setPaymentComplete(true)
        // Wait a moment then reset
        setTimeout(() => {
          setShowPayment(false)
          setPaymentComplete(false)
          setCurrentRide(null)
          setDriverLocation(null)
          setDriverDistance(null)
          setDriverEta(null)
          setPickup(null)
          setDropoff(null)
          setSelectingLocation('pickup')
        }, 2000)
      } else {
        setError(response.error?.message || 'Payment failed')
      }
    } catch (err) {
      setError('Payment failed')
    } finally {
      setPaymentProcessing(false)
    }
  }

  // Logout
  const handleLogout = async () => {
    await logout('rider')
    router.push('/login?type=rider')
  }

  // Build markers for the map
  const markers: Array<{
    id: string
    position: [number, number]
    type: 'pickup' | 'dropoff' | 'driver' | 'rider'
    label: string
  }> = []
  
  // Use currentRide coordinates if available, otherwise use local state
  const pickupCoords = currentRide 
    ? [parseFloat(String(currentRide.pickup_lat)), parseFloat(String(currentRide.pickup_lng))] as [number, number]
    : pickup
  const dropoffCoords = currentRide
    ? [parseFloat(String(currentRide.dropoff_lat)), parseFloat(String(currentRide.dropoff_lng))] as [number, number]
    : dropoff

  if (pickupCoords) {
    markers.push({ id: 'pickup', position: pickupCoords, type: 'pickup' as const, label: 'Pickup' })
  }
  if (dropoffCoords) {
    markers.push({ id: 'dropoff', position: dropoffCoords, type: 'dropoff' as const, label: 'Dropoff' })
  }
  if (driverLocation && currentRide) {
    markers.push({
      id: 'driver',
      position: [driverLocation.latitude, driverLocation.longitude] as [number, number],
      type: 'driver' as const,
      label: currentRide.driver_name || 'Driver',
    })
  }

  const getStatusColor = (status: string) => {
    const colors: Record<string, string> = {
      REQUESTED: 'bg-yellow-100 text-yellow-800',
      MATCHING: 'bg-blue-100 text-blue-800',
      DRIVER_ASSIGNED: 'bg-indigo-100 text-indigo-800',
      DRIVER_EN_ROUTE: 'bg-purple-100 text-purple-800',
      DRIVER_ARRIVED: 'bg-pink-100 text-pink-800',
      IN_PROGRESS: 'bg-green-100 text-green-800',
      COMPLETED: 'bg-emerald-100 text-emerald-800',
      CANCELLED: 'bg-red-100 text-red-800',
    }
    return colors[status] || 'bg-gray-100 text-gray-800'
  }

  if (!user) {
    return null
  }

  return (
    <div className="min-h-screen bg-slate-100">
      {/* Payment Modal - Full Screen Overlay */}
      {showPayment && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[9999] p-4" style={{ backdropFilter: 'blur(4px)' }}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto animate-slide-up">
            {paymentComplete ? (
              <div className="p-8 text-center">
                <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <CheckCircle className="w-10 h-10 text-green-600" />
                </div>
                <h2 className="text-2xl font-bold text-slate-800 mb-2">Payment Successful!</h2>
                <p className="text-slate-600">Thank you for riding with GoComet</p>
              </div>
            ) : (
              <>
                <div className="bg-gradient-to-r from-primary-600 to-primary-700 p-6 text-white">
                  <h2 className="text-xl font-bold mb-1">Trip Completed!</h2>
                  <p className="text-primary-100 text-sm">Please complete your payment</p>
                </div>
                
                <div className="p-6">
                  {/* Fare Summary */}
                  <div className="bg-slate-50 rounded-xl p-4 mb-6">
                    <div className="flex items-center justify-between mb-3">
                      <span className="text-slate-600">Trip Fare</span>
                      <span className="text-2xl font-bold text-slate-800 flex items-center">
                        <IndianRupee className="w-5 h-5" />
                        {Number(tripFare || 0).toFixed(2)}
                      </span>
                    </div>
                    <div className="text-xs text-slate-500">
                      Includes base fare + distance + time charges
                    </div>
                  </div>

                  {/* Payment Methods */}
                  <div className="mb-6">
                    <label className="block text-sm font-medium text-slate-700 mb-3">
                      Select Payment Method
                    </label>
                    <div className="grid grid-cols-3 gap-3">
                      <button
                        onClick={() => setPaymentMethod('cash')}
                        className={`p-4 rounded-xl border-2 transition-all ${
                          paymentMethod === 'cash'
                            ? 'border-primary-500 bg-primary-50'
                            : 'border-slate-200 hover:border-slate-300'
                        }`}
                      >
                        <Banknote className={`w-6 h-6 mx-auto mb-1 ${paymentMethod === 'cash' ? 'text-primary-600' : 'text-slate-400'}`} />
                        <span className={`text-xs font-medium ${paymentMethod === 'cash' ? 'text-primary-600' : 'text-slate-600'}`}>Cash</span>
                      </button>
                      <button
                        onClick={() => setPaymentMethod('card')}
                        className={`p-4 rounded-xl border-2 transition-all ${
                          paymentMethod === 'card'
                            ? 'border-primary-500 bg-primary-50'
                            : 'border-slate-200 hover:border-slate-300'
                        }`}
                      >
                        <CreditCard className={`w-6 h-6 mx-auto mb-1 ${paymentMethod === 'card' ? 'text-primary-600' : 'text-slate-400'}`} />
                        <span className={`text-xs font-medium ${paymentMethod === 'card' ? 'text-primary-600' : 'text-slate-600'}`}>Card</span>
                      </button>
                      <button
                        onClick={() => setPaymentMethod('wallet')}
                        className={`p-4 rounded-xl border-2 transition-all ${
                          paymentMethod === 'wallet'
                            ? 'border-primary-500 bg-primary-50'
                            : 'border-slate-200 hover:border-slate-300'
                        }`}
                      >
                        <Wallet className={`w-6 h-6 mx-auto mb-1 ${paymentMethod === 'wallet' ? 'text-primary-600' : 'text-slate-400'}`} />
                        <span className={`text-xs font-medium ${paymentMethod === 'wallet' ? 'text-primary-600' : 'text-slate-600'}`}>Wallet</span>
                      </button>
                    </div>
                  </div>

                  {/* Rating */}
                  <div className="mb-6">
                    <label className="block text-sm font-medium text-slate-700 mb-3">
                      Rate your driver
                    </label>
                    <div className="flex justify-center gap-2">
                      {[1, 2, 3, 4, 5].map((star) => (
                        <button
                          key={star}
                          onClick={() => setRating(star)}
                          className="p-1 transition-transform hover:scale-110"
                        >
                          <Star
                            className={`w-8 h-8 ${
                              star <= rating ? 'text-yellow-400 fill-yellow-400' : 'text-slate-300'
                            }`}
                          />
                        </button>
                      ))}
                    </div>
                  </div>

                  {error && (
                    <div className="mb-4 p-3 bg-red-50 text-red-700 rounded-lg text-sm">
                      {error}
                    </div>
                  )}

                  {/* Pay Button */}
                  <button
                    onClick={processPayment}
                    disabled={paymentProcessing}
                    className="btn btn-primary w-full py-4 text-lg flex items-center justify-center gap-2"
                  >
                    {paymentProcessing ? (
                      <Loader2 className="w-5 h-5 animate-spin" />
                    ) : (
                      <>
                        Pay ₹{Number(tripFare || 0).toFixed(2)}
                      </>
                    )}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Header */}
      <header className="bg-gradient-to-r from-blue-900 via-indigo-800 to-purple-900 shadow-lg">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-white rounded-lg flex items-center justify-center">
              <span className="text-blue-600 font-bold">G</span>
            </div>
            <h1 className="text-xl font-bold text-white">GoComet Rider</h1>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full ${isConnected ? 'bg-green-400' : 'bg-red-400'}`} />
              <span className="text-sm text-blue-100">{isConnected ? 'Connected' : 'Disconnected'}</span>
            </div>
            <div className="flex items-center gap-2 text-sm text-blue-100">
              <UserIcon className="w-4 h-4" />
              <span>{user.name || user.phone}</span>
            </div>
            <button
              onClick={handleLogout}
              className="p-2 text-blue-200 hover:text-white hover:bg-white/10 rounded-lg transition-all"
              title="Logout"
            >
              <LogOut className="w-5 h-5" />
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-6">
        <div className="grid lg:grid-cols-3 gap-6">
          {/* Map */}
          <div className="lg:col-span-2">
            <div className="card p-4 h-[500px]">
              <MapView
                center={pickup || BANGALORE_CENTER}
                markers={markers}
                onMapClick={!currentRide ? handleMapClick : undefined}
              />
            </div>
            
            {selectingLocation && !currentRide && (
              <div className="mt-4 p-4 bg-primary-50 rounded-lg border border-primary-200">
                <p className="text-primary-800 font-medium">
                  Click on the map to select your {selectingLocation === 'pickup' ? 'pickup' : 'dropoff'} location
                </p>
              </div>
            )}
          </div>

          {/* Sidebar */}
          <div className="space-y-4">
            {/* Current Ride Status */}
            {currentRide ? (
              <div className="card p-6 animate-slide-up">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-lg font-semibold">Your Ride</h2>
                  <span className={`badge ${getStatusColor(currentRide.status)}`}>
                    {currentRide.status.replace(/_/g, ' ')}
                  </span>
                </div>

                {/* Driver Info */}
                {currentRide.driver_name && (
                  <div className="bg-slate-50 rounded-lg p-4 mb-4">
                    <div className="flex items-center gap-3">
                      <div className="w-12 h-12 bg-primary-100 rounded-full flex items-center justify-center">
                        <Car className="w-6 h-6 text-primary-600" />
                      </div>
                      <div className="flex-1">
                        <p className="font-semibold">{currentRide.driver_name}</p>
                        <p className="text-sm text-slate-600">{currentRide.vehicle_number}</p>
                        {currentRide.driver_rating && (
                          <p className="text-sm text-yellow-600">★ {currentRide.driver_rating}</p>
                        )}
                      </div>
                      {/* Live Distance & ETA - Only show when driver is en route to pickup */}
                      {driverDistance !== null && currentRide.status === 'DRIVER_EN_ROUTE' && (
                        <div className="text-right bg-primary-50 rounded-lg px-3 py-2">
                          <p className="text-lg font-bold text-primary-600">
                            {driverDistance < 1 
                              ? `${Math.round(driverDistance * 1000)}m` 
                              : `${driverDistance.toFixed(1)}km`}
                          </p>
                          <p className="text-xs text-primary-500">
                            {driverEta !== null && driverEta > 0 
                              ? `~${driverEta} min away` 
                              : 'Arriving soon!'}
                          </p>
                        </div>
                      )}
                      {/* Show trip in progress message when trip has started */}
                      {currentRide.status === 'IN_PROGRESS' && (
                        <div className="text-right bg-green-50 rounded-lg px-3 py-2">
                          <p className="text-sm font-semibold text-green-700">
                            Trip in progress
                          </p>
                          <p className="text-xs text-green-600">
                            En route to destination
                          </p>
                        </div>
                      )}
                    </div>
                    {/* Progress bar for driver approach */}
                    {driverDistance !== null && currentRide.status === 'DRIVER_EN_ROUTE' && (
                      <div className="mt-3">
                        <div className="h-1.5 bg-slate-200 rounded-full overflow-hidden">
                          <div 
                            className="h-full bg-primary-500 rounded-full transition-all duration-1000"
                            style={{ 
                              width: `${Math.max(5, Math.min(95, (1 - driverDistance / 5) * 100))}%` 
                            }}
                          />
                        </div>
                        <p className="text-xs text-slate-500 mt-1 text-center">
                          Driver is on the way
                        </p>
                      </div>
                    )}
                  </div>
                )}

                {/* Fare Info */}
                {currentRide.estimated_fare && (
                  <div className="flex items-center justify-between py-3 border-t">
                    <span className="text-slate-600">Estimated Fare</span>
                    <span className="font-semibold flex items-center">
                      <IndianRupee className="w-4 h-4" />
                      {currentRide.estimated_fare}
                    </span>
                  </div>
                )}

                {/* Cancel Button */}
                {!['COMPLETED', 'CANCELLED', 'IN_PROGRESS'].includes(currentRide.status) && (
                  <button
                    onClick={cancelRide}
                    disabled={loading}
                    className="btn btn-danger w-full mt-4"
                  >
                    <X className="w-4 h-4 mr-2" />
                    Cancel Ride
                  </button>
                )}

                {currentRide.status === 'COMPLETED' && (
                  <div className="flex items-center justify-center gap-2 text-green-600 mt-4">
                    <CheckCircle className="w-5 h-5" />
                    <span className="font-medium">Ride Completed</span>
                  </div>
                )}
              </div>
            ) : (
              /* Booking Form */
              <div className="card p-6">
                <h2 className="text-lg font-semibold mb-4">Book a Ride</h2>

                {/* Location Inputs */}
                <div className="space-y-3 mb-4">
                  <button
                    onClick={() => setSelectingLocation('pickup')}
                    className={`w-full flex items-center gap-3 p-3 rounded-lg border ${
                      selectingLocation === 'pickup' ? 'border-primary-500 bg-primary-50' : 'border-slate-200'
                    }`}
                  >
                    <MapPin className="w-5 h-5 text-green-500" />
                    <span className={pickup ? 'text-slate-800' : 'text-slate-400'}>
                      {pickup ? `${pickup[0].toFixed(4)}, ${pickup[1].toFixed(4)}` : 'Select pickup location'}
                    </span>
                  </button>

                  <button
                    onClick={() => setSelectingLocation('dropoff')}
                    className={`w-full flex items-center gap-3 p-3 rounded-lg border ${
                      selectingLocation === 'dropoff' ? 'border-primary-500 bg-primary-50' : 'border-slate-200'
                    }`}
                  >
                    <Navigation className="w-5 h-5 text-red-500" />
                    <span className={dropoff ? 'text-slate-800' : 'text-slate-400'}>
                      {dropoff ? `${dropoff[0].toFixed(4)}, ${dropoff[1].toFixed(4)}` : 'Select dropoff location'}
                    </span>
                  </button>
                </div>

                {/* Vehicle Type */}
                <div className="mb-4">
                  <label className="block text-sm font-medium text-slate-700 mb-2">Vehicle Type</label>
                  <div className="grid grid-cols-3 gap-2">
                    {['economy', 'premium', 'xl'].map((t) => (
                      <button
                        key={t}
                        onClick={() => setTier(t)}
                        className={`py-2 px-3 rounded-lg text-sm font-medium capitalize ${
                          tier === t
                            ? 'bg-primary-600 text-white'
                            : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                        }`}
                      >
                        {t}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Payment Method */}
                <div className="mb-6">
                  <label className="block text-sm font-medium text-slate-700 mb-2">Payment</label>
                  <select
                    value={paymentMethod}
                    onChange={(e) => setPaymentMethod(e.target.value)}
                    className="input"
                  >
                    <option value="cash">Cash</option>
                    <option value="card">Card</option>
                    <option value="wallet">Wallet</option>
                  </select>
                </div>

                {/* Error Message */}
                {error && (
                  <div className="mb-4 p-3 bg-red-50 text-red-700 rounded-lg text-sm">
                    {error}
                  </div>
                )}

                {/* Request Button */}
                <button
                  onClick={requestRide}
                  disabled={loading || !pickup || !dropoff}
                  className="btn btn-primary w-full disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {loading ? (
                    <span className="flex items-center justify-center">
                      <Clock className="w-4 h-4 mr-2 animate-spin" />
                      Requesting...
                    </span>
                  ) : (
                    'Request Ride'
                  )}
                </button>
              </div>
            )}

            {/* Tips */}
            <div className="card p-4 bg-slate-50">
              <h3 className="font-medium text-slate-700 mb-2">Tips</h3>
              <ul className="text-sm text-slate-600 space-y-1">
                <li>• Click on the map to set locations</li>
                <li>• Green marker = Pickup</li>
                <li>• Red marker = Dropoff</li>
                <li>• Blue marker = Driver location</li>
              </ul>
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}
