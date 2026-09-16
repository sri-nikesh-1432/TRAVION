import React from 'react';

const tones: Record<string, string> = {
  neutral: 'bg-charcoal-100 text-charcoal-600',
  sky: 'bg-travion-100 text-travion-700',
  sage: 'bg-sage-200 text-sage-700',
  cognac: 'bg-cognac-100 text-cognac-700',
  gold: 'bg-gold-100 text-gold-500',
  blush: 'bg-blush-200 text-charcoal-700',
  emerald: 'bg-emerald-50 text-emerald-700',
  amber: 'bg-amber-50 text-amber-700',
  red: 'bg-red-50 text-red-600',
  violet: 'bg-violet-50 text-violet-700',
  outline: 'bg-white border border-charcoal-200 text-charcoal-600',
};

export const TravionBadge: React.FC<
  { tone?: keyof typeof tones; icon?: React.ReactNode } & React.HTMLAttributes<HTMLSpanElement>
> = ({ tone = 'neutral', icon, className = '', children, ...rest }) => (
  <span
    {...rest}
    className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10.5px] font-black uppercase tracking-wide ${tones[tone]} ${className}`}
  >
    {icon}
    {children}
  </span>
);