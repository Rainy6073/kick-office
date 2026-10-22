// Who has the app open, and on which page. Each device keeps one presence record
// fresh while it is visible; anyone seen in the last minute counts as here.
import { useEffect, useState } from 'react'
import type { Session } from './session'
import { put, useCollection } from './sync/store'
import { newId } from './types'

const DEVICE_KEY = 'kickoff.device'
const BEAT = 20_000
const FRESH = 60_000

let device: string | null = null
/** A random id for this device, kept across visits. */
export function deviceId() {
  if (device) return device
  // In development, ?device=… lets two tabs act as two devices.
  const override = import.meta.env.DEV && new URLSearchParams(location.search).get('device')
  if (override) return (device = override)
  try {
    device = localStorage.getItem(DEVICE_KEY)
    if (!device) localStorage.setItem(DEVICE_KEY, (device = newId()))
  } catch {
    device = newId()
  }
  return device
}

/** Keeps this device's presence record up to date. */
export function usePresenceBeat(session: Session | null, page: string) {
  const name = session?.name
  const role = session?.role
  useEffect(() => {
    if (!name || !role) return
    const beat = () => {
      if (document.visibilityState === 'visible') put('presence', { id: deviceId(), name, role, page, seenAt: Date.now() })
    }
    beat()
    const timer = setInterval(beat, BEAT)
    document.addEventListener('visibilitychange', beat)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', beat)
    }
  }, [name, role, page])
}

/** Devices seen recently on `page`, rechecked as time passes. */
export function useOnline(page: string) {
  const all = useCollection('presence')
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), BEAT / 2)
    return () => clearInterval(timer)
  }, [])
  return all.filter((p) => p.page === page && now - p.seenAt < FRESH).sort((a, b) => a.name.localeCompare(b.name))
}
