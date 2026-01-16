import { getStoredAuth } from './auth'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000'

interface ApiResponse<T> {
  success: boolean
  data?: T
  error?: {
    code: string
    message: string
  }
  message?: string
}

class ApiClient {
  private baseUrl: string

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl
  }

  private getAuthHeaders(): HeadersInit {
    if (typeof window === 'undefined') return {}
    
    const auth = getStoredAuth()
    if (auth.token) {
      return { 'Authorization': `Bearer ${auth.token}` }
    }
    return {}
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<ApiResponse<T>> {
    const url = `${this.baseUrl}/v1${endpoint}`
    
    const headers: HeadersInit = {
      'Content-Type': 'application/json',
      ...this.getAuthHeaders(),
      ...options.headers,
    }

    try {
      const response = await fetch(url, {
        ...options,
        headers,
      })

      const data = await response.json()
      return data
    } catch (error) {
      console.error('API request failed:', error)
      return {
        success: false,
        error: {
          code: 'NETWORK_ERROR',
          message: 'Failed to connect to server',
        },
      }
    }
  }

  // Rides
  async createRide(rideData: {
    tenant_id: string
    rider_id: string
    pickup_lat: number
    pickup_lng: number
    pickup_address?: string
    dropoff_lat: number
    dropoff_lng: number
    dropoff_address?: string
    tier?: string
    payment_method?: string
  }) {
    return this.request('/rides', {
      method: 'POST',
      body: JSON.stringify(rideData),
      headers: {
        'Idempotency-Key': `ride-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      },
    })
  }

  async getRide(rideId: string) {
    return this.request(`/rides/${rideId}`)
  }

  async cancelRide(rideId: string, reason?: string) {
    return this.request(`/rides/${rideId}/cancel`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    })
  }

  async getRiderRides(riderId: string) {
    return this.request(`/riders/${riderId}/rides`)
  }

  async getRiderCurrentRide(riderId: string) {
    return this.request(`/riders/${riderId}/current-ride`)
  }

  // Drivers
  async getDriver(driverId: string) {
    return this.request(`/drivers/${driverId}`)
  }

  async updateDriverLocation(driverId: string, location: {
    latitude: number
    longitude: number
    heading?: number
    speed?: number
  }) {
    return this.request(`/drivers/${driverId}/location`, {
      method: 'POST',
      body: JSON.stringify(location),
    })
  }

  async updateDriverStatus(driverId: string, status: 'online' | 'offline') {
    return this.request(`/drivers/${driverId}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    })
  }

  async acceptRide(driverId: string, rideId: string) {
    return this.request(`/drivers/${driverId}/accept`, {
      method: 'POST',
      body: JSON.stringify({ ride_id: rideId }),
    })
  }

  async declineRide(driverId: string, rideId: string, reason?: string) {
    return this.request(`/drivers/${driverId}/decline`, {
      method: 'POST',
      body: JSON.stringify({ ride_id: rideId, reason }),
    })
  }

  async getDriverCurrentRide(driverId: string) {
    return this.request(`/drivers/${driverId}/current-ride`)
  }

  async getDriverPendingOffers(driverId: string) {
    return this.request(`/drivers/${driverId}/pending-offers`)
  }

  // Trips
  async startTrip(rideId: string) {
    return this.request('/trips/start', {
      method: 'POST',
      body: JSON.stringify({ ride_id: rideId }),
    })
  }

  async endTrip(tripId: string, data?: {
    actual_distance_km?: number
    actual_duration_mins?: number
  }) {
    return this.request(`/trips/${tripId}/end`, {
      method: 'POST',
      body: JSON.stringify(data || {}),
    })
  }

  async getTrip(tripId: string) {
    return this.request(`/trips/${tripId}`)
  }

  async updateRideStatus(rideId: string, status: string) {
    return this.request(`/trips/ride/${rideId}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    })
  }

  // Payments
  async processPayment(tripId: string, paymentMethod: string) {
    const idempotencyKey = `payment-${tripId}-${Date.now()}`
    return this.request('/payments', {
      method: 'POST',
      body: JSON.stringify({
        trip_id: tripId,
        payment_method: paymentMethod,
        idempotency_key: idempotencyKey,
      }),
      headers: {
        'Idempotency-Key': idempotencyKey,
      },
    })
  }

  // Health check
  async healthCheck() {
    try {
      const response = await fetch(`${this.baseUrl}/health`)
      return response.ok
    } catch {
      return false
    }
  }
}

export const api = new ApiClient(API_URL)
export type { ApiResponse }
