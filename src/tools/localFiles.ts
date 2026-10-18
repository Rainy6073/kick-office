// Per-device file storage for tools (e.g. each screen's own field image).
import { useEffect, useState } from 'react'

const DB = 'kickoff-tool-files'

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1)
    req.onupgradeneeded = () => req.result.createObjectStore('files')
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open()
  return new Promise((resolve, reject) => {
    const req = fn(db.transaction('files', mode).objectStore('files'))
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export const saveLocalFile = (key: string, blob: Blob) => run('readwrite', (s) => s.put(blob, key))
export const loadLocalFile = (key: string) => run<Blob | undefined>('readonly', (s) => s.get(key))
export const removeLocalFile = (key: string) => run('readwrite', (s) => s.delete(key))

/** An object URL for a locally stored file. */
export function useLocalFileUrl(key: string | undefined) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    if (!key) {
      setUrl(null)
      return
    }
    let objectUrl: string | null = null
    let cancelled = false
    loadLocalFile(key).then((blob) => {
      if (cancelled || !blob) return
      objectUrl = URL.createObjectURL(blob)
      setUrl(objectUrl)
    })
    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [key])
  return url
}
