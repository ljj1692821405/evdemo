'use client'

import { useCallback } from 'react'
import useSWR from 'swr'

const swrOptions = { revalidateOnFocus: false, revalidateOnReconnect: false, revalidateIfStale: false }

export function useShared<T>(key: string, initial: T) {
  const { data, mutate } = useSWR<T>(key, null, { ...swrOptions, fallbackData: initial })
  const set = useCallback(
    (next: T | ((prev: T) => T)) =>
      mutate((prev) => (typeof next === 'function' ? (next as (p: T) => T)(prev ?? initial) : next), { revalidate: false }),
    [mutate, initial],
  )
  return [data ?? initial, set] as const
}
