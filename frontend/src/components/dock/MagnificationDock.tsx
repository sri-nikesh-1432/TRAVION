import React, { useRef, useState } from 'react';
import { motion, useMotionValue, useSpring, useTransform } from 'framer-motion';

export interface DockItemData {
  icon: React.ReactNode;
  label: React.ReactNode;
  onClick: () => void;
  className?: string;
  badge?: string | number;
}

interface MagnificationDockProps {
  items: DockItemData[];
  distance?: number;
  panelHeight?: number;
  baseItemSize?: number;
  magnification?: number;
  spring?: { mass: number; stiffness: number; damping: number };
}

function DockItem({
  item,
  mouseX,
  distance,
  baseItemSize,
  magnification,
  spring
}: {
  item: DockItemData;
  mouseX: any;
  distance: number;
  baseItemSize: number;
  magnification: number;
  spring: { mass: number; stiffness: number; damping: number };
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const [isHovered, setIsHovered] = useState(false);

  const distanceCalc = useTransform(mouseX, (val: number) => {
    const bounds = ref.current?.getBoundingClientRect() ?? { x: 0, width: 0 };
    return val - bounds.x - bounds.width / 2;
  });

  const widthSync = useTransform(
    distanceCalc,
    [-distance, 0, distance],
    [baseItemSize, magnification, baseItemSize]
  );

  const width = useSpring(widthSync, spring);

  return (
    <motion.button
      ref={ref}
      style={{ width, height: width }}
      onClick={item.onClick}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      className={`relative flex items-center justify-center rounded-2xl bg-white/90 shadow-sm border border-travion-100 hover:border-travion-400 hover:shadow-soft text-slate-700 hover:text-travion-600 transition-colors focus:outline-none ${item.className || ''}`}
    >
      {/* Tooltip */}
      {isHovered && (
        <motion.div
          initial={{ opacity: 0, y: 10, scale: 0.9 }}
          animate={{ opacity: 1, y: -44, scale: 1 }}
          exit={{ opacity: 0, y: 10, scale: 0.9 }}
          className="absolute -top-2 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-xl bg-slate-900/90 backdrop-blur-md px-3 py-1.5 text-xs font-semibold text-white shadow-lg pointer-events-none z-50"
        >
          {item.label}
        </motion.div>
      )}

      {/* Icon */}
      <div className="flex items-center justify-center text-xl pointer-events-none">
        {item.icon}
      </div>

      {/* Optional Badge */}
      {item.badge !== undefined && (
        <span className="absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white shadow-sm">
          {item.badge}
        </span>
      )}
    </motion.button>
  );
}

export const MagnificationDock: React.FC<MagnificationDockProps> = ({
  items,
  distance = 180,
  panelHeight = 68,
  baseItemSize = 48,
  magnification = 68,
  spring = { mass: 0.1, stiffness: 150, damping: 12 }
}) => {
  const mouseX = useMotionValue(Infinity);

  return (
    <motion.div
      onMouseMove={(e) => mouseX.set(e.pageX)}
      onMouseLeave={() => mouseX.set(Infinity)}
      style={{ height: panelHeight }}
      className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 flex items-center gap-3 px-4 rounded-3xl bg-white/80 backdrop-blur-xl border border-travion-200/80 shadow-floating"
    >
      {items.map((item, idx) => (
        <DockItem
          key={idx}
          item={item}
          mouseX={mouseX}
          distance={distance}
          baseItemSize={baseItemSize}
          magnification={magnification}
          spring={spring}
        />
      ))}
    </motion.div>
  );
};
