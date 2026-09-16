import React from 'react';

/** Layout-mirroring shimmer block. `as` lets you render a card/row without nested divs. */
export const TravionSkeleton: React.FC<{
  className?: string;
  radius?: string;
  as?: 'div' | 'p' | 'span';
}> = ({ className = '', radius = 'rounded-2xl', as: Tag = 'div' }) => (
  <Tag aria-hidden className={`skeleton ${radius} ${className}`} />
);

export const TravionSkeletonCard: React.FC<{ className?: string }> = ({ className = '' }) => (
  <div className={`card-soft rounded-3xl p-4 ${className}`}>
    <TravionSkeleton className="w-full aspect-[16/10] rounded-2xl" />
    <TravionSkeleton className="h-4 w-3/4 mt-3" />
    <TravionSkeleton className="h-3 w-1/2 mt-2" />
    <TravionSkeleton className="h-8 w-full mt-4" />
  </div>
);