import React from 'react';

const base =
  'inline-flex items-center justify-center gap-2 font-bold whitespace-nowrap transition-all active:scale-[0.985] disabled:opacity-60 disabled:cursor-not-allowed disabled:active:scale-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-travion-600';

const variants: Record<string, string> = {
  primary: 'bg-travion-600 hover:bg-travion-700 text-white shadow-soft hover:shadow-soft-lg',
  ink: 'bg-charcoal-900 hover:bg-charcoal-800 text-ivory-50 shadow-soft',
  soft: 'bg-travion-50 hover:bg-travion-100 text-travion-700 border border-travion-100',
  sage: 'bg-sage-500 hover:bg-sage-600 text-white shadow-soft',
  cognac: 'bg-cognac-500 hover:bg-cognac-600 text-white shadow-soft',
  outline: 'bg-white/70 hover:bg-white border border-charcoal-200 text-charcoal-700 hover:text-charcoal-900',
  ghost: 'bg-transparent hover:bg-charcoal-100/70 text-charcoal-700',
  glass: 'glass text-charcoal-800 shadow-glass hover:bg-white/80',
  danger: 'bg-red-50 hover:bg-red-100 text-red-600 border border-red-100',
};

const sizes: Record<string, string> = {
  xs: 'h-8 px-3 text-[11.5px] rounded-xl',
  sm: 'h-10 px-4 text-[12.5px] rounded-xl',
  md: 'h-11 px-5 text-[13.5px] rounded-2xl',
  lg: 'h-12 px-6 text-[14.5px] rounded-2xl',
  xl: 'h-14 px-8 text-[15px] rounded-2xl',
};

export interface TravionButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: keyof typeof variants;
  size?: keyof typeof sizes;
  /** 44px minimum touch target on touch devices — set for mobile-primary actions. */
  touch?: boolean;
  loading?: boolean;
}

export const TravionButton: React.FC<TravionButtonProps> = ({
  variant = 'primary',
  size = 'md',
  touch,
  loading,
  className = '',
  children,
  disabled,
  ...rest
}) => (
  <button
    {...rest}
    disabled={disabled || loading}
    className={`${base} ${variants[variant]} ${sizes[size]} ${touch ? 'min-h-11' : ''} ${className}`}
  >
    {loading && (
      <span
        aria-hidden
        className="w-3.5 h-3.5 rounded-full border-2 border-current border-t-transparent animate-spin"
      />
    )}
    {children}
  </button>
);