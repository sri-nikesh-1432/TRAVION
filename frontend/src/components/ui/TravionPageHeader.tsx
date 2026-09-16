import React from 'react';
import { AnimatePresence, motion } from 'framer-motion';

export interface TravionPageHeaderProps {
  eyebrow?: React.ReactNode;
  title: React.ReactNode;
  kicker?: React.ReactNode;
  /** Context chips e.g. "Munnar · Sep 19–22 · 3 travellers" (reduce short-term memory load) */
  context?: React.ReactNode[];
  as?: 'h1' | 'h2';
  align?: 'left' | 'center';
}

export const TravionPageHeader: React.FC<TravionPageHeaderProps> = ({
  eyebrow,
  title,
  kicker,
  context,
  as: Tag = 'h1',
  align = 'left',
}) => (
  <div className={`${align === 'center' ? 'text-center mx-auto' : ''} max-w-2xl`}>
    {eyebrow && (
      <div className={`${align === 'center' ? 'justify-center' : ''} flex items-center gap-2 mb-3`}>
        {typeof eyebrow === 'string' ? (
          <span className="type-label text-travion-600">{eyebrow}</span>
        ) : (
          eyebrow
        )}
      </div>
    )}
    <Tag className="type-h1 text-charcoal-900">{title}</Tag>
    {kicker && <p className="type-body text-charcoal-500 mt-3">{kicker}</p>}
    {context && context.length > 0 && (
      <div className="flex flex-wrap items-center gap-2 mt-5">
        {context.map((chip, i) => (
          <span
            key={i}
            className="inline-flex items-center gap-1.5 rounded-full bg-white/80 border border-charcoal-200/70 px-3 py-1.5 text-[11.5px] font-bold text-charcoal-600 shadow-soft"
          >
            {chip}
          </span>
        ))}
      </div>
    )}
  </div>
);

/** Standard fade-page header entrance — consistent across every domain. */
export const TravionHeaderMotion: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <motion.div
    initial={{ opacity: 0, y: 14 }}
    animate={{ opacity: 1, y: 0 }}
    transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
  >
    {children}
  </motion.div>
);