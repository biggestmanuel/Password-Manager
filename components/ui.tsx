'use client';

import { forwardRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode } from 'react';

export function cx(...values: (string | false | null | undefined)[]): string {
  return values.filter(Boolean).join(' ');
}

// --- Button -------------------------------------------------------------

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-blue-600 text-white hover:bg-blue-500 focus-visible:outline-blue-500',
  secondary: 'bg-gray-800 text-gray-100 hover:bg-gray-700 focus-visible:outline-gray-500',
  ghost: 'text-gray-400 hover:text-white hover:bg-gray-800 focus-visible:outline-gray-500',
  danger: 'text-gray-400 hover:text-red-400 hover:bg-red-500/10 focus-visible:outline-red-500',
};

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', className, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      // Buttons inside a form default to type="submit". An unlabelled one
      // silently submits the form, which is a classic source of
      // "delete button deleted the wrong thing" bugs.
      type={props.type ?? 'button'}
      className={cx(
        'rounded-md px-3 py-2 text-sm font-medium transition-colors',
        'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2',
        'disabled:cursor-not-allowed disabled:opacity-50',
        VARIANTS[variant],
        className,
      )}
      {...props}
    />
  );
});

// --- Input --------------------------------------------------------------

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...props }, ref) {
    return (
      <input
        ref={ref}
        className={cx(
          'w-full rounded-md border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-100',
          'placeholder:text-gray-500 focus:border-blue-500 focus:outline-none',
          'disabled:opacity-50',
          className,
        )}
        {...props}
      />
    );
  },
);

// --- Field --------------------------------------------------------------

export function Field({
  label,
  children,
  hint,
  id,
}: {
  label: string;
  children: ReactNode;
  hint?: ReactNode;
  id: string;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-xs font-medium text-gray-400">
        {label}
      </label>
      {children}
      {hint ? <p className="text-xs text-gray-500">{hint}</p> : null}
    </div>
  );
}

// --- Card ---------------------------------------------------------------

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cx('rounded-xl border border-gray-800 bg-gray-900 p-6 shadow-xl', className)}>
      {children}
    </div>
  );
}

// --- Alert --------------------------------------------------------------

export function Alert({ children, tone = 'error' }: { children: ReactNode; tone?: 'error' | 'warning' | 'info' }) {
  const tones = {
    error: 'border-red-900/60 bg-red-950/40 text-red-300',
    warning: 'border-amber-900/60 bg-amber-950/40 text-amber-200',
    info: 'border-blue-900/60 bg-blue-950/40 text-blue-200',
  } as const;

  return (
    <div role="alert" className={cx('rounded-md border px-3 py-2 text-xs', tones[tone])}>
      {children}
    </div>
  );
}