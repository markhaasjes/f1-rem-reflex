import type { ReactNode } from 'react'

export function Pill({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <span className={`inline-flex items-center rounded-full bg-white px-5 py-2 font-extrabold text-ink ${className}`}>
      {children}
    </span>
  )
}

export function NumberBadge({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-badge-blue text-sm font-extrabold text-white">
      {children}
    </span>
  )
}
