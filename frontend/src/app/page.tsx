'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Car, User, Shield, Zap, LogIn, MapPin, CreditCard } from 'lucide-react'

export default function Home() {
  const [isLoggedIn, setIsLoggedIn] = useState(false)
  const [userType, setUserType] = useState<string | null>(null)

  useEffect(() => {
    if (typeof window !== 'undefined') {
      try {
        const stored = localStorage.getItem('gocomet_auth')
        if (stored) {
          const parsed = JSON.parse(stored)
          if (parsed.token) {
            setIsLoggedIn(true)
            setUserType(parsed.user?.type || 'rider')
          }
        }
      } catch (e) {
        // ignore
      }
    }
  }, [])

  return (
    <main className="min-h-screen">
      {/* Hero Section with GoComet Gradient */}
      <div className="relative overflow-hidden">
        {/* Gradient Background */}
        <div className="absolute inset-0 bg-gradient-to-br from-blue-900 via-indigo-800 to-purple-900" />
        
        {/* Geometric Pattern Overlay */}
        <div className="absolute inset-0 opacity-20">
          <div className="absolute top-20 right-20 w-64 h-64 bg-purple-500/30 rounded-3xl transform rotate-12" />
          <div className="absolute top-40 right-40 w-48 h-48 bg-blue-500/30 rounded-3xl transform -rotate-6" />
          <div className="absolute bottom-20 right-60 w-32 h-32 bg-fuchsia-500/30 rounded-3xl transform rotate-45" />
          <div className="absolute top-60 right-80 w-40 h-40 bg-indigo-500/30 rounded-3xl transform -rotate-12" />
        </div>
        
        {/* Header */}
        <header className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 flex justify-between items-center">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-white rounded-lg flex items-center justify-center">
              <span className="text-blue-600 font-bold text-lg">G</span>
            </div>
            <h1 className="text-2xl font-bold text-white tracking-tight">GoComet</h1>
          </div>
          <div className="flex items-center gap-4">
            {isLoggedIn ? (
              <Link 
                href={userType === 'driver' ? '/driver' : '/rider'}
                className="inline-flex items-center justify-center px-5 py-2.5 text-sm font-semibold text-white bg-primary-600 rounded-lg hover:bg-primary-700 transition-all shadow-lg"
              >
                Go to Dashboard
              </Link>
            ) : (
              <>
                <Link 
                  href="/login"
                  className="text-white/80 hover:text-white text-sm font-medium transition-colors"
                >
                  Sign in
                </Link>
                <Link 
                  href="/login?type=rider"
                  className="inline-flex items-center justify-center px-5 py-2.5 text-sm font-semibold text-white bg-primary-600 rounded-lg hover:bg-primary-700 transition-all shadow-lg"
                >
                  Get a Demo
                </Link>
              </>
            )}
          </div>
        </header>
        
        {/* Hero Content */}
        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-24 lg:py-32">
          <div className="max-w-2xl">
            <p className="text-primary-300 text-sm font-semibold tracking-wider uppercase mb-4">
              AI-FIRST RIDE HAILING
            </p>
            <h2 className="text-5xl md:text-6xl font-bold text-white mb-6 leading-tight">
              Future-ready your
              <span className="block">mobility</span>
            </h2>
            <p className="text-xl text-blue-100/80 mb-10 leading-relaxed">
              Combine intelligent matching with real-time tracking - and watch 
              the magic happen. Speed goes up. Wait times go down.
            </p>
            
            <div className="flex flex-col sm:flex-row gap-4">
              {isLoggedIn ? (
                <Link 
                  href={userType === 'driver' ? '/driver' : '/rider'}
                  className="inline-flex items-center justify-center px-8 py-4 text-lg font-semibold text-blue-900 bg-white rounded-xl hover:bg-blue-50 transition-all shadow-lg hover:shadow-xl"
                >
                  {userType === 'driver' ? (
                    <>
                      <Car className="w-5 h-5 mr-2" />
                      Driver Dashboard
                    </>
                  ) : (
                    <>
                      <User className="w-5 h-5 mr-2" />
                      Book a Ride
                    </>
                  )}
                </Link>
              ) : (
                <>
                  <Link 
                    href="/login?type=rider"
                    className="inline-flex items-center justify-center px-8 py-4 text-lg font-semibold text-blue-900 bg-white rounded-xl hover:bg-blue-50 transition-all shadow-lg hover:shadow-xl"
                  >
                    <User className="w-5 h-5 mr-2" />
                    Book a Ride
                  </Link>
                  <Link 
                    href="/login?type=driver"
                    className="inline-flex items-center justify-center px-8 py-4 text-lg font-semibold text-white bg-white/10 backdrop-blur rounded-xl hover:bg-white/20 transition-all border border-white/20"
                  >
                    <Car className="w-5 h-5 mr-2" />
                    Drive with Us
                  </Link>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Features Section */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-24">
        <div className="text-center mb-16">
          <h2 className="text-3xl md:text-4xl font-bold text-slate-800 mb-4">
            Why Choose GoComet?
          </h2>
          <p className="text-slate-600 max-w-2xl mx-auto text-lg">
            Experience the future of ride-hailing with our cutting-edge platform
          </p>
        </div>

        <div className="grid md:grid-cols-3 gap-8">
          <FeatureCard 
            icon={<Zap className="w-8 h-8" />}
            title="Lightning Fast Matching"
            description="Our intelligent algorithm matches you with the nearest driver in under a second"
            color="text-amber-500"
            bgColor="bg-amber-50"
          />
          <FeatureCard 
            icon={<MapPin className="w-8 h-8" />}
            title="Real-Time Tracking"
            description="Track your ride in real-time with live driver location updates"
            color="text-blue-600"
            bgColor="bg-blue-50"
          />
          <FeatureCard 
            icon={<CreditCard className="w-8 h-8" />}
            title="Seamless Payments"
            description="Pay with cash, card, or wallet - whatever works best for you"
            color="text-purple-600"
            bgColor="bg-purple-50"
          />
        </div>

        <div className="grid md:grid-cols-3 gap-8 mt-8">
          <FeatureCard 
            icon={<Shield className="w-8 h-8" />}
            title="Safe & Secure"
            description="All drivers are verified and rides are tracked for your safety"
            color="text-indigo-600"
            bgColor="bg-indigo-50"
          />
          <FeatureCard 
            icon={<Car className="w-8 h-8" />}
            title="Multiple Options"
            description="Choose from Economy, Premium, or XL vehicles based on your needs"
            color="text-fuchsia-600"
            bgColor="bg-fuchsia-50"
          />
          <FeatureCard 
            icon={<User className="w-8 h-8" />}
            title="Driver Partners"
            description="Join our network of drivers and earn on your own schedule"
            color="text-blue-600"
            bgColor="bg-blue-50"
          />
        </div>
      </div>

      {/* Footer */}
      <div className="bg-gradient-to-r from-slate-900 via-blue-900 to-purple-900 text-white py-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center">
            <h3 className="text-2xl font-bold mb-4">Demo Application</h3>
            <p className="text-blue-200 mb-6 max-w-xl mx-auto">
              This is a demonstration of the GoComet Ride Hailing system built with
              Node.js, PostgreSQL, Redis, Kafka, and Next.js
            </p>
            <p className="text-blue-300 mb-8 text-sm">
              Use OTP <span className="font-mono bg-white/10 px-3 py-1 rounded-lg">123456</span> to login
            </p>
            <div className="flex flex-wrap justify-center gap-3">
              <TechBadge>Node.js</TechBadge>
              <TechBadge>PostgreSQL</TechBadge>
              <TechBadge>Redis</TechBadge>
              <TechBadge>Kafka</TechBadge>
              <TechBadge>Next.js</TechBadge>
              <TechBadge>WebSocket</TechBadge>
            </div>
          </div>
        </div>
      </div>
    </main>
  )
}

function FeatureCard({ 
  icon, 
  title, 
  description, 
  color, 
  bgColor 
}: { 
  icon: React.ReactNode
  title: string
  description: string
  color: string
  bgColor: string
}) {
  return (
    <div className="bg-white rounded-2xl shadow-md p-8 hover:shadow-xl transition-all duration-300 border border-slate-100 hover:border-blue-200 group">
      <div className={`inline-flex p-4 rounded-xl ${bgColor} ${color} mb-5 group-hover:scale-110 transition-transform duration-300`}>
        {icon}
      </div>
      <h3 className="text-xl font-semibold text-slate-800 mb-3">{title}</h3>
      <p className="text-slate-600 leading-relaxed">{description}</p>
    </div>
  )
}

function TechBadge({ children }: { children: React.ReactNode }) {
  return (
    <span className="px-4 py-2 bg-white/10 backdrop-blur rounded-full text-sm text-blue-100 border border-white/10 hover:bg-white/20 transition-colors">
      {children}
    </span>
  )
}
