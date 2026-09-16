import React from 'react';

/** Liquid glass surface — nav, search, map controls, sheets, assistant. */
export const TravionGlass: React.FC<
  React.HTMLAttributes<HTMLDivElement> & { strong?: boolean; dark?: boolean }
> = ({ strong, dark, className = '', ...rest }) => (
  <div
    {...rest}
    className={`${dark ? 'glass-dark text-ivory-100' : strong ? 'glass-strong' : 'glass'} ${
      className
    }`}
  />
);

/** Soft flat card — the workhorse surface for content. */
export const TravionCard: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({ className = '', ...rest }) => (
  <div {...rest} className={`card-soft rounded-3xl ${className}`} />
);