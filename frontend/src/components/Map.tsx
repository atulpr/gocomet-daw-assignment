'use client'

import { useEffect, useRef } from 'react'
import L from 'leaflet'

interface MapViewProps {
  center?: [number, number]
  zoom?: number
  markers?: Array<{
    id: string
    position: [number, number]
    type: 'pickup' | 'dropoff' | 'driver' | 'rider'
    label?: string
  }>
  onMapClick?: (lat: number, lng: number) => void
  driverPath?: Array<[number, number]>
}

// Custom marker icons
const createIcon = (type: string) => {
  const colors: Record<string, string> = {
    pickup: '#22c55e',
    dropoff: '#ef4444',
    driver: '#3b82f6',
    rider: '#8b5cf6',
  }
  
  const color = colors[type] || '#6b7280'
  
  return L.divIcon({
    className: 'custom-marker',
    html: `
      <div style="
        width: 32px;
        height: 32px;
        background: ${color};
        border: 3px solid white;
        border-radius: 50%;
        box-shadow: 0 2px 8px rgba(0,0,0,0.3);
        display: flex;
        align-items: center;
        justify-content: center;
      ">
        <div style="
          width: 10px;
          height: 10px;
          background: white;
          border-radius: 50%;
        "></div>
      </div>
    `,
    iconSize: [32, 32],
    iconAnchor: [16, 16],
  })
}

// Default center (Bangalore)
const DEFAULT_CENTER: [number, number] = [12.9716, 77.5946]

// Use a simple object to store markers instead of Map to avoid naming collision
type MarkerStore = { [key: string]: L.Marker }

export default function MapView(props: MapViewProps) {
  // Handle undefined props gracefully
  const center = props?.center || DEFAULT_CENTER
  const zoom = props?.zoom ?? 13
  const markers = props?.markers || []
  const onMapClick = props?.onMapClick
  const driverPath = props?.driverPath

  const mapRef = useRef<L.Map | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const markersRef = useRef<MarkerStore>({})
  const pathRef = useRef<L.Polyline | null>(null)
  const onMapClickRef = useRef(onMapClick)

  // Keep the callback ref up to date
  useEffect(() => {
    onMapClickRef.current = onMapClick
  }, [onMapClick])

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return

    // Initialize map with validated center
    const validCenter: [number, number] = Array.isArray(center) && center.length === 2 
      ? center 
      : DEFAULT_CENTER
    mapRef.current = L.map(containerRef.current).setView(validCenter, zoom)

    // Add tile layer (OpenStreetMap)
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors',
    }).addTo(mapRef.current)

    // Add click handler - use ref to always get latest callback
    mapRef.current.on('click', (e) => {
      if (onMapClickRef.current) {
        onMapClickRef.current(e.latlng.lat, e.latlng.lng)
      }
    })

    return () => {
      mapRef.current?.remove()
      mapRef.current = null
    }
  }, [])

  // Update center when it changes
  useEffect(() => {
    if (mapRef.current && center) {
      const validCenter: [number, number] = Array.isArray(center) && center.length === 2 
        ? center 
        : DEFAULT_CENTER
      mapRef.current.setView(validCenter, zoom)
    }
  }, [center, zoom])

  // Update markers - use JSON string for deep comparison
  const markersKey = JSON.stringify(markers)
  
  useEffect(() => {
    if (!mapRef.current) return

    // Parse the markers from the stringified version
    const currentMarkers = markers

    // Remove old markers that are no longer in the list
    const currentIds = new Set(currentMarkers.map(m => m.id))
    Object.keys(markersRef.current).forEach((id) => {
      if (!currentIds.has(id)) {
        markersRef.current[id].remove()
        delete markersRef.current[id]
      }
    })

    // Add or update markers
    currentMarkers.forEach(({ id, position, type, label }) => {
      const existingMarker = markersRef.current[id]
      
      if (existingMarker) {
        existingMarker.setLatLng(position)
      } else {
        const marker = L.marker(position, { icon: createIcon(type) })
          .addTo(mapRef.current!)
        
        if (label) {
          marker.bindTooltip(label, { permanent: false, direction: 'top' })
        }
        
        markersRef.current[id] = marker
      }
    })
  }, [markersKey])

  // Update driver path
  useEffect(() => {
    if (!mapRef.current) return

    if (pathRef.current) {
      pathRef.current.remove()
      pathRef.current = null
    }

    if (driverPath && driverPath.length > 1) {
      pathRef.current = L.polyline(driverPath, {
        color: '#3b82f6',
        weight: 4,
        opacity: 0.7,
        dashArray: '10, 10',
      }).addTo(mapRef.current)
    }
  }, [driverPath])

  return (
    <div 
      ref={containerRef} 
      className="w-full h-full min-h-[400px] rounded-xl overflow-hidden"
    />
  )
}
