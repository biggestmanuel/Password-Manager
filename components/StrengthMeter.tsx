'use client';

import { estimateStrength } from '@/lib/vault-crypto';

const COLORS = [
  'bg-red-500',
  'bg-orange-500',
  'bg-yellow-500',
  'bg-lime-500',
  'bg-emerald-500',
];

/** Four-segment strength bar. Advisory only -- not a security control. */
export function StrengthMeter({ password }: { password: string }) {
  const { score, label } = estimateStrength(password);

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <div className="flex flex-1 gap-1" aria-hidden="true">
          {[0, 1, 2, 3].map((index) => (
            <div
              key={index}
              className={`h-1 flex-1 rounded-full transition-colors ${
                password && index < score ? COLORS[score] : 'bg-gray-700'
              }`}
            />
          ))}
        </div>
        {password ? (
          <span className="w-20 text-right text-[11px] text-gray-400">{label}</span>
        ) : null}
      </div>
      {/* Announced to screen readers, since the bar itself is decorative. */}
      <p className="sr-only" aria-live="polite">
        {password ? `Password strength: ${label}` : ''}
      </p>
    </div>
  );
}