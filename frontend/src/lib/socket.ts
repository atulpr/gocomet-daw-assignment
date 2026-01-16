'use client'

import { io, Socket } from 'socket.io-client'

const WS_URL = process.env.NEXT_PUBLIC_WS_URL || 'http://localhost:3000'

let socket: Socket | null = null

export interface SocketEvents {
  'ride:offer': (data: { offer_id: string; ride_id: string; expires_at: string }) => void
  'ride:driver_assigned': (data: { ride_id: string; driver_id: string; driver_name: string; vehicle_number: string; rating: number }) => void
  'ride:driver_en_route': (data: { ride_id: string }) => void
  'ride:driver_arrived': (data: { ride_id: string }) => void
  'trip:started': (data: { ride_id: string; trip_id: string }) => void
  'trip:completed': (data: { ride_id: string; trip_id: string; fare: number }) => void
  'payment:completed': (data: { trip_id: string; amount: number }) => void
  'payment:received': (data: { trip_id: string; amount: number }) => void
  'driver:location:update': (data: { driverId: string; latitude: number; longitude: number; heading?: number }) => void
  'driver:location:ack': (data: { timestamp: number }) => void
  'driver:location:error': (data: { message: string }) => void
}

export function getSocket(): Socket {
  if (!socket) {
    socket = io(WS_URL, {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
    })

    socket.on('connect', () => {
      console.log('Socket connected:', socket?.id)
    })

    socket.on('disconnect', (reason) => {
      console.log('Socket disconnected:', reason)
    })

    socket.on('connect_error', (error) => {
      console.error('Socket connection error:', error.message)
    })
  }

  return socket
}

export function registerUser(userId: string, userType: 'rider' | 'driver') {
  const sock = getSocket()
  sock.emit('register', { userId, userType })
  
  return new Promise<void>((resolve) => {
    sock.once('registered', () => {
      console.log(`Registered as ${userType}: ${userId}`)
      resolve()
    })
  })
}

export function subscribeToRide(rideId: string) {
  const sock = getSocket()
  sock.emit('subscribe:ride', { rideId })
}

export function unsubscribeFromRide(rideId: string) {
  const sock = getSocket()
  sock.emit('unsubscribe:ride', { rideId })
}

export function sendDriverLocation(rideId: string, latitude: number, longitude: number, heading?: number) {
  const sock = getSocket()
  sock.emit('driver:location', { rideId, latitude, longitude, heading })
}

/**
 * Send driver location update via WebSocket (replaces HTTP API)
 * This updates Redis geo-index and publishes to Kafka
 */
export function sendDriverLocationUpdate(location: {
  latitude: number
  longitude: number
  heading?: number
  speed?: number
  accuracy?: number
  rideId?: string
}) {
  const sock = getSocket()
  sock.emit('driver:location:update', location)
}

export function onEvent<K extends keyof SocketEvents>(event: K, callback: SocketEvents[K]) {
  const sock = getSocket()
  sock.on(event, callback as any)
  return () => sock.off(event, callback as any)
}

export function disconnectSocket() {
  if (socket) {
    socket.disconnect()
    socket = null
  }
}
