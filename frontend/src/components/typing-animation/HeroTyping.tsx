import React, { useState, useEffect } from 'react';
import { RotateCcw } from 'lucide-react';

interface HeroTypingProps {
  text?: string;
  speed?: number;
  className?: string;
  showReplay?: boolean;
}

export const HeroTyping: React.FC<HeroTypingProps> = ({
  text = "Travel without the uncertainty.",
  speed = 50,
  className = "",
  showReplay = true
}) => {
  const [displayedText, setDisplayedText] = useState("");
  const [isTypingComplete, setIsTypingComplete] = useState(false);
  const [key, setKey] = useState(0);

  useEffect(() => {
    setDisplayedText("");
    setIsTypingComplete(false);
    let currentIndex = 0;

    const interval = setInterval(() => {
      if (currentIndex < text.length) {
        setDisplayedText(text.slice(0, currentIndex + 1));
        currentIndex++;
      } else {
        setIsTypingComplete(true);
        clearInterval(interval);
      }
    }, speed);

    return () => clearInterval(interval);
  }, [text, speed, key]);

  return (
    <div className={`inline-flex items-center gap-3 ${className}`}>
      <span className="relative font-bold tracking-tight text-slate-900">
        {displayedText}
        <span
          className={`inline-block w-[3px] h-[0.9em] ml-1 bg-travion-500 align-middle transition-opacity duration-300 ${
            isTypingComplete ? 'animate-pulse opacity-0' : 'opacity-100'
          }`}
        />
      </span>
      {showReplay && isTypingComplete && (
        <button
          onClick={() => setKey(prev => prev + 1)}
          className="p-1.5 rounded-full text-slate-400 hover:text-travion-600 hover:bg-travion-50 transition-all focus:outline-none"
          title="Replay animation"
        >
          <RotateCcw className="w-4 h-4" />
        </button>
      )}
    </div>
  );
};
