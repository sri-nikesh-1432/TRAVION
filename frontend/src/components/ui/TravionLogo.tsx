import React from 'react';
import { Compass } from 'lucide-react';

/** TRAVION word-lockup. Variants: `dark` (for light surfaces), `onLight` placement over imagery. */
export const TravionLogo: React.FC<{ className?: string; mark?: 'dark' | 'ivory' | 'sky' }> = ({
  className = '',
  mark = 'dark',
}) => (
  <span className={`inline-flex items-center gap-2 select-none ${className}`}>
    <span
      className={`w-7 h-7 rounded-[10px] flex items-center justify-center shadow-soft ${
        mark === 'ivory' ? 'bg-ivory-100 text-travion-700' : mark === 'sky' ? 'bg-travion-600 text-white' : 'bg-charcoal-900 text-white'
      }`}
    >
      <Compass className="w-4 h-4" strokeWidth={2.2} />
    </span>
    <span className={`font-black tracking-[-0.02em] text-[15px] ${mark === 'ivory' ? 'text-ivory-100' : 'text-charcoal-900'}`}>
      TRAVION
    </span>
  </span>
);