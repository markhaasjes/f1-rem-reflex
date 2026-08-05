import type { ReactNode } from 'react';

export function Pill({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <span className={`inline-flex items-center rounded-full bg-white px-5 py-2 font-extrabold text-ink ${className}`}>
      {children}
    </span>
  );
}
