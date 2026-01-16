'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import dynamic from 'next/dynamic'
import { api } from '@/lib/api'
import { getStoredAuth, logout, User } from '@/lib/auth'
import { registerUser, subscribeToRide, onEvent, sendDriverLocation, sendDriverLocationUpdate, getSocket } from '@/lib/socket'
import { 
  MapPin, Navigation, Car, Clock, IndianRupee, Check, X, 
  Power, PowerOff, Play, Square, AlertCircle, LogOut, User as UserIcon 
} from 'lucide-react'

const MapView = dynamic(() => import('@/components/Map'), { ssr: false })

// Bangalore coordinates for demo
const BANGALORE_CENTER: [number, number] = [12.9716, 77.5946]

interface RideOffer {
  offer_id: string
  ride_id: string
  expires_at: string
  pickup?: { lat: number; lng: number }
  dropoff?: { lat: number; lng: number }
}

interface CurrentRide {
  id: string
  status: string
  pickup_lat: number
  pickup_lng: number
  dropoff_lat: number
  dropoff_lng: number
  rider_name?: string
  rider_phone?: string
  tier: string
  estimated_fare?: number
  trip_id?: string
}

export default function DriverPage() {
  const router = useRouter()
  const [user, setUser] = useState<User | null>(null)
  const [isOnline, setIsOnline] = useState(false)
  const [currentLocation, setCurrentLocation] = useState<[number, number]>(BANGALORE_CENTER)
  const [rideOffer, setRideOffer] = useState<RideOffer | null>(null)
  const [currentRide, setCurrentRide] = useState<CurrentRide | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isConnected, setIsConnected] = useState(false)
  const [earnings, setEarnings] = useState(0)
  const [waitingForPayment, setWaitingForPayment] = useState(false)
  const [lastTripEarnings, setLastTripEarnings] = useState(0)
  const locationIntervalRef = useRef<NodeJS.Timeout | null>(null)
  const offerTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  // Load earnings from localStorage on mount
  useEffect(() => {
    const today = new Date().toDateString()
    const stored = localStorage.getItem('driver_earnings')
    if (stored) {
      try {
        const data = JSON.parse(stored)
        if (data.date === today) {
          setEarnings(data.amount || 0)
        } else {
          // New day, reset earnings
          localStorage.setItem('driver_earnings', JSON.stringify({ date: today, amount: 0 }))
        }
      } catch {
        localStorage.setItem('driver_earnings', JSON.stringify({ date: today, amount: 0 }))
      }
    }
  }, [])

  // Save earnings to localStorage when it changes
  useEffect(() => {
    if (earnings > 0) {
      const today = new Date().toDateString()
      localStorage.setItem('driver_earnings', JSON.stringify({ date: today, amount: earnings }))
    }
  }, [earnings])

  // Check authentication
  useEffect(() => {
    const auth = getStoredAuth('driver') // Get driver-specific session
    if (!auth.isAuthenticated || auth.user?.type !== 'driver') {
      router.push('/login?type=driver')
      return
    }
    setUser(auth.user)
  }, [router])

  // Initialize socket connection and listen for ride offers
  useEffect(() => {
    if (!user) return
    
    let unsubRideOffer: (() => void) | null = null
    
    const init = async () => {
      try {
        // Register user first
        await registerUser(user.id, 'driver')
        setIsConnected(true)
        console.log('Driver registered on socket:', user.id)
        
        // Now subscribe to ride offers AFTER registration
        unsubRideOffer = onEvent('ride:offer', (data) => {
          console.log('🚗 Received ride offer via WS:', data)
          setRideOffer(data)
          
          // Auto-expire offer after timeout
          if (offerTimeoutRef.current) {
            clearTimeout(offerTimeoutRef.current)
          }
          offerTimeoutRef.current = setTimeout(() => {
            setRideOffer(null)
          }, 15000)
        })
        
        // Try to get current ride if any
        const response = await api.getDriverCurrentRide(user.id)
        console.log('Current ride response:', response)
        if (response.success && response.data) {
          const ride = response.data as any
          
          // If payment is already completed, don't show the ride
          if (ride.payment_status === 'completed') {
            console.log('Payment already completed, clearing ride')
            setCurrentRide(null)
            setWaitingForPayment(false)
          } else {
            setCurrentRide({
              ...ride,
              trip_id: ride.trip_id,
            } as CurrentRide)
            setIsOnline(true)
            
            // If ride is completed but payment not received, show waiting state
            if (ride.status === 'COMPLETED') {
              setWaitingForPayment(true)
              setLastTripEarnings(Number(ride.total_fare || 0) * 0.8)
            }
          }
        } else {
          // No active ride, clear state
          setCurrentRide(null)
          setWaitingForPayment(false)
        }
      } catch (err) {
        console.error('Initialization failed:', err)
        setIsConnected(false)
      }
    }
    init()
    
    return () => {
      if (unsubRideOffer) unsubRideOffer()
      if (offerTimeoutRef.current) {
        clearTimeout(offerTimeoutRef.current)
      }
    }
  }, [user])

  // Poll for pending offers (runs when online and no current ride/offer)
  useEffect(() => {
    // Poll when: user exists, is online, no current ride, no current offer
    if (!user || !isOnline || currentRide || rideOffer) return

    const pollOffers = async () => {
      try {
        const response = await api.getDriverPendingOffers(user.id)
        if (response.success && response.data && Array.isArray(response.data) && response.data.length > 0) {
          const offer = response.data[0] as any
          console.log('📬 Found pending offer via polling:', offer)
          setRideOffer({
            offer_id: offer.offer_id,
            ride_id: offer.ride_id,
            expires_at: offer.expires_at,
            pickup: { lat: parseFloat(offer.pickup_lat), lng: parseFloat(offer.pickup_lng) },
            dropoff: { lat: parseFloat(offer.dropoff_lat), lng: parseFloat(offer.dropoff_lng) },
          })
        }
      } catch (err) {
        console.error('Failed to poll offers:', err)
      }
    }

    // Poll immediately and then every 5 seconds (WebSocket is primary)
    pollOffers()
    const interval = setInterval(pollOffers, 5000)

    console.log('🔄 Started offer polling (5s interval)')
    return () => {
      clearInterval(interval)
      console.log('🛑 Stopped offer polling')
    }
  }, [user, isOnline, currentRide, rideOffer])

  // Subscribe to ride events when we have a current ride
  useEffect(() => {
    if (!currentRide?.id) return

    subscribeToRide(currentRide.id)

    return () => {
      // Cleanup if needed
    }
  }, [currentRide?.id])

  // Listen for payment completion
  useEffect(() => {
    if (!waitingForPayment) return

    const unsubPayment = onEvent('payment:received', (data) => {
      console.log('💰 Payment received:', data)
      setEarnings(prev => prev + lastTripEarnings)
      setWaitingForPayment(false)
      setCurrentRide(null)
      setLastTripEarnings(0)
    })

    // Also auto-clear after 60 seconds if no payment event (fallback)
    const timeout = setTimeout(() => {
      if (waitingForPayment) {
        setEarnings(prev => prev + lastTripEarnings)
        setWaitingForPayment(false)
        setCurrentRide(null)
        setLastTripEarnings(0)
      }
    }, 60000)

    return () => {
      unsubPayment()
      clearTimeout(timeout)
    }
  }, [waitingForPayment, lastTripEarnings])

  // Simulate location updates when online
  useEffect(() => {
    if (!user) return
    
    if (isOnline && !locationIntervalRef.current) {
      // Send location updates via WebSocket (every 5 seconds)
      // WebSocket → Backend → Kafka → Consumer (no HTTP overhead!)
      locationIntervalRef.current = setInterval(() => {
        // Simulate small movement
        setCurrentLocation(prev => {
          const newLat = prev[0] + (Math.random() - 0.5) * 0.001
          const newLng = prev[1] + (Math.random() - 0.5) * 0.001
          const speed = Math.random() * 40
          const heading = Math.random() * 360
          
          // Check if WebSocket is connected
          const socket = getSocket()
          const isSocketConnected = socket && socket.connected
          
          if (isSocketConnected) {
            // Primary: Send via WebSocket (updates Redis + Kafka)
            sendDriverLocationUpdate({
              latitude: newLat,
              longitude: newLng,
              speed,
              heading,
              rideId: currentRide?.id,
            })
          } else {
            // Fallback: Use HTTP API if WebSocket is not connected
            console.warn('WebSocket not connected, falling back to HTTP API')
            api.updateDriverLocation(user.id, {
              latitude: newLat,
              longitude: newLng,
              speed,
              heading,
            }).catch(err => console.error('HTTP location update failed:', err))
          }

          // Also broadcast to ride room for rider tracking (if active ride)
          if (currentRide?.id && isSocketConnected) {
            sendDriverLocation(currentRide.id, newLat, newLng, heading)
          }

          return [newLat, newLng]
        })
      }, 5000) // 5 seconds - WebSocket is persistent, no HTTP overhead
    } else if (!isOnline && locationIntervalRef.current) {
      clearInterval(locationIntervalRef.current)
      locationIntervalRef.current = null
    }

    return () => {
      if (locationIntervalRef.current) {
        clearInterval(locationIntervalRef.current)
        locationIntervalRef.current = null
      }
    }
  }, [isOnline, currentRide?.id, user])

  // Toggle online status
  const toggleOnline = async () => {
    if (!user) return
    
    setLoading(true)
    setError(null)

    try {
      const newStatus = isOnline ? 'offline' : 'online'
      const response = await api.updateDriverStatus(user.id, newStatus)
      
      if (response.success) {
        setIsOnline(!isOnline)
        if (!isOnline) {
          // Send initial location when going online
          await api.updateDriverLocation(user.id, {
            latitude: currentLocation[0],
            longitude: currentLocation[1],
          })
        }
      } else {
        setError(response.error?.message || 'Failed to update status')
      }
    } catch (err) {
      setError('Failed to update status')
    } finally {
      setLoading(false)
    }
  }

  // Accept ride offer
  const acceptRide = async () => {
    if (!rideOffer || !user) return

    setLoading(true)
    setError(null)

    try {
      const response = await api.acceptRide(user.id, rideOffer.ride_id)
      
      if (response.success && response.data) {
        setCurrentRide(response.data as CurrentRide)
        setRideOffer(null)
        if (offerTimeoutRef.current) {
          clearTimeout(offerTimeoutRef.current)
        }
      } else {
        setError(response.error?.message || 'Failed to accept ride')
      }
    } catch (err) {
      setError('Failed to accept ride')
    } finally {
      setLoading(false)
    }
  }

  // Decline ride offer
  const declineRide = async () => {
    if (!rideOffer || !user) return

    try {
      await api.declineRide(user.id, rideOffer.ride_id, 'Declined by driver')
    } catch (err) {
      console.error('Failed to decline ride:', err)
    }
    
    setRideOffer(null)
    if (offerTimeoutRef.current) {
      clearTimeout(offerTimeoutRef.current)
    }
  }

  // Update ride status (en route, arrived)
  const updateRideStatus = async (status: string) => {
    if (!currentRide) return

    setLoading(true)
    try {
      const response = await api.updateRideStatus(currentRide.id, status)
      if (response.success) {
        setCurrentRide(prev => prev ? { ...prev, status } : null)
      }
    } catch (err) {
      setError('Failed to update status')
    } finally {
      setLoading(false)
    }
  }

  // Start trip
  const startTrip = async () => {
    if (!currentRide) return

    setLoading(true)
    try {
      const response = await api.startTrip(currentRide.id)
      if (response.success && response.data) {
        setCurrentRide(prev => prev ? { 
          ...prev, 
          status: 'IN_PROGRESS',
          trip_id: (response.data as any).trip_id,
        } : null)
      }
    } catch (err) {
      setError('Failed to start trip')
    } finally {
      setLoading(false)
    }
  }

  // End trip
  const endTrip = async () => {
    if (!currentRide?.trip_id) return

    setLoading(true)
    try {
      const response = await api.endTrip(currentRide.trip_id)
      if (response.success && response.data) {
        const fare = (response.data as any).fare?.total || 0
        setLastTripEarnings(fare * 0.8) // Driver gets 80%
        setCurrentRide(prev => prev ? { ...prev, status: 'COMPLETED' } : null)
        setWaitingForPayment(true)
      }
    } catch (err) {
      setError('Failed to end trip')
    } finally {
      setLoading(false)
    }
  }

  // Logout
  const handleLogout = async () => {
    await logout('driver')
    router.push('/login?type=driver')
  }

  // Build markers for the map
  const markers = [
    { id: 'driver', position: currentLocation, type: 'driver' as const, label: 'You' },
  ]
  
  if (currentRide) {
    markers.push({ 
      id: 'pickup', 
      position: [parseFloat(String(currentRide.pickup_lat)), parseFloat(String(currentRide.pickup_lng))] as [number, number], 
      type: 'pickup' as const, 
      label: currentRide.rider_name || 'Pickup' 
    })
    markers.push({ 
      id: 'dropoff', 
      position: [parseFloat(String(currentRide.dropoff_lat)), parseFloat(String(currentRide.dropoff_lng))] as [number, number], 
      type: 'dropoff' as const, 
      label: 'Dropoff' 
    })
  }

  // Cancel current ride
  const cancelCurrentRide = async () => {
    if (!currentRide || !user) return
    
    setLoading(true)
    try {
      await api.cancelRide(currentRide.id, 'Cancelled by driver')
      setCurrentRide(null)
      setError(null)
    } catch (err) {
      setError('Failed to cancel ride')
    } finally {
      setLoading(false)
    }
  }

  const getActionButton = () => {
    if (!currentRide) return null

    switch (currentRide.status) {
      case 'DRIVER_ASSIGNED':
        return (
          <div className="space-y-2">
            <button
              onClick={() => updateRideStatus('DRIVER_EN_ROUTE')}
              className="btn btn-primary w-full"
              disabled={loading}
            >
              <Navigation className="w-4 h-4 mr-2" />
              Start Navigation
            </button>
            <button
              onClick={cancelCurrentRide}
              className="btn btn-secondary w-full text-red-600"
              disabled={loading}
            >
              <X className="w-4 h-4 mr-2" />
              Cancel Ride
            </button>
          </div>
        )
      case 'DRIVER_EN_ROUTE':
        return (
          <button
            onClick={() => updateRideStatus('DRIVER_ARRIVED')}
            className="btn btn-primary w-full"
            disabled={loading}
          >
            <MapPin className="w-4 h-4 mr-2" />
            I've Arrived
          </button>
        )
      case 'DRIVER_ARRIVED':
        return (
          <button
            onClick={startTrip}
            className="btn btn-primary w-full"
            disabled={loading}
          >
            <Play className="w-4 h-4 mr-2" />
            Start Trip
          </button>
        )
      case 'IN_PROGRESS':
        return (
          <button
            onClick={endTrip}
            className="btn bg-red-600 text-white hover:bg-red-700 w-full"
            disabled={loading}
          >
            <Square className="w-4 h-4 mr-2" />
            End Trip
          </button>
        )
      case 'COMPLETED':
        return (
          <div className="text-center py-4">
            <div className="animate-pulse mb-3">
              <Clock className="w-8 h-8 text-primary-600 mx-auto" />
            </div>
            <p className="text-lg font-medium text-slate-800">Waiting for Payment</p>
            <p className="text-sm text-slate-500">Rider is completing payment...</p>
            <p className="text-lg font-bold text-green-600 mt-2">
              +₹{lastTripEarnings.toFixed(0)} earnings
            </p>
          </div>
        )
      default:
        return null
    }
  }

  if (!user) {
    return null
  }

  return (
    <div className="min-h-screen bg-slate-100">
      {/* Header */}
      <header className="bg-gradient-to-r from-blue-900 via-indigo-800 to-purple-900 shadow-lg">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-white rounded-lg flex items-center justify-center">
              <span className="text-blue-600 font-bold">G</span>
            </div>
            <h1 className="text-xl font-bold text-white">GoComet Driver</h1>
          </div>
          <div className="flex items-center gap-4">
            <div className="text-right">
              <p className="text-sm text-blue-200">Today's Earnings</p>
              <p className="font-semibold text-green-400 flex items-center">
                <IndianRupee className="w-4 h-4" />
                {earnings.toFixed(0)}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full ${isConnected ? 'bg-green-400' : 'bg-red-400'}`} />
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
                center={currentRide 
                  ? [parseFloat(String(currentRide.pickup_lat)), parseFloat(String(currentRide.pickup_lng))] 
                  : currentLocation
                } 
                markers={markers} 
                zoom={14} 
              />
            </div>
          </div>

          {/* Sidebar */}
          <div className="space-y-4">
            {/* Online/Offline Toggle */}
            <div className="card p-6">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="text-lg font-semibold">Status</h2>
                  <p className={`text-sm ${isOnline ? 'text-green-600' : 'text-slate-500'}`}>
                    {isOnline ? 'Accepting rides' : 'Offline'}
                  </p>
                </div>
                <button
                  onClick={toggleOnline}
                  disabled={loading || !!currentRide}
                  className={`p-4 rounded-full transition-all ${
                    isOnline 
                      ? 'bg-green-500 text-white hover:bg-green-600' 
                      : 'bg-slate-200 text-slate-600 hover:bg-slate-300'
                  } ${currentRide ? 'opacity-50 cursor-not-allowed' : ''}`}
                >
                  {isOnline ? <Power className="w-6 h-6" /> : <PowerOff className="w-6 h-6" />}
                </button>
              </div>

              {isOnline && !currentRide && !rideOffer && (
                <div className="flex items-center gap-2 text-blue-600 animate-pulse-soft">
                  <Clock className="w-4 h-4" />
                  <span className="text-sm">Waiting for ride requests...</span>
                </div>
              )}
            </div>

            {/* Ride Offer */}
            {rideOffer && (
              <div className="card p-6 border-2 border-yellow-400 bg-yellow-50 animate-slide-up">
                <div className="flex items-center gap-2 mb-4">
                  <AlertCircle className="w-5 h-5 text-yellow-600" />
                  <h2 className="text-lg font-semibold text-yellow-800">New Ride Request!</h2>
                </div>

                <p className="text-sm text-yellow-700 mb-4">
                  A rider is requesting a ride nearby
                </p>

                <div className="flex gap-3">
                  <button
                    onClick={acceptRide}
                    disabled={loading}
                    className="btn bg-green-600 text-white hover:bg-green-700 flex-1"
                  >
                    <Check className="w-4 h-4 mr-1" />
                    Accept
                  </button>
                  <button
                    onClick={declineRide}
                    disabled={loading}
                    className="btn bg-red-600 text-white hover:bg-red-700 flex-1"
                  >
                    <X className="w-4 h-4 mr-1" />
                    Decline
                  </button>
                </div>
              </div>
            )}

            {/* Current Ride */}
            {currentRide && (
              <div className="card p-6 animate-slide-up">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-lg font-semibold">Current Ride</h2>
                  <span className={`badge ${getStatusColor(currentRide.status)}`}>
                    {currentRide.status.replace(/_/g, ' ')}
                  </span>
                </div>

                {/* Rider Info */}
                {currentRide.rider_name && (
                  <div className="bg-slate-50 rounded-lg p-4 mb-4">
                    <p className="font-medium">{currentRide.rider_name}</p>
                    <p className="text-sm text-slate-600">{currentRide.rider_phone}</p>
                  </div>
                )}

                {/* Locations */}
                <div className="space-y-3 mb-4">
                  <div className="flex items-start gap-3">
                    <MapPin className="w-5 h-5 text-green-500 mt-0.5" />
                    <div>
                      <p className="text-xs text-slate-500">PICKUP</p>
                      <p className="text-sm">{parseFloat(String(currentRide.pickup_lat)).toFixed(4)}, {parseFloat(String(currentRide.pickup_lng)).toFixed(4)}</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <Navigation className="w-5 h-5 text-red-500 mt-0.5" />
                    <div>
                      <p className="text-xs text-slate-500">DROPOFF</p>
                      <p className="text-sm">{parseFloat(String(currentRide.dropoff_lat)).toFixed(4)}, {parseFloat(String(currentRide.dropoff_lng)).toFixed(4)}</p>
                    </div>
                  </div>
                </div>

                {/* Fare */}
                {currentRide.estimated_fare && (
                  <div className="flex items-center justify-between py-3 border-t mb-4">
                    <span className="text-slate-600">Estimated Fare</span>
                    <span className="font-semibold flex items-center">
                      <IndianRupee className="w-4 h-4" />
                      {currentRide.estimated_fare}
                    </span>
                  </div>
                )}

                {/* Action Button */}
                {getActionButton()}

                {/* Error */}
                {error && (
                  <div className="mt-4 p-3 bg-red-50 text-red-700 rounded-lg text-sm">
                    {error}
                  </div>
                )}
              </div>
            )}

            {/* Instructions */}
            <div className="card p-4 bg-slate-50">
              <h3 className="font-medium text-slate-700 mb-2">Driver Guide</h3>
              <ul className="text-sm text-slate-600 space-y-1">
                <li>• Toggle status to go online/offline</li>
                <li>• Accept ride offers within 15 seconds</li>
                <li>• Blue marker shows your location</li>
                <li>• Location updates every 2 seconds</li>
              </ul>
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}

function getStatusColor(status: string) {
  const colors: Record<string, string> = {
    DRIVER_ASSIGNED: 'bg-indigo-100 text-indigo-800',
    DRIVER_EN_ROUTE: 'bg-purple-100 text-purple-800',
    DRIVER_ARRIVED: 'bg-pink-100 text-pink-800',
    IN_PROGRESS: 'bg-green-100 text-green-800',
  }
  return colors[status] || 'bg-gray-100 text-gray-800'
}
