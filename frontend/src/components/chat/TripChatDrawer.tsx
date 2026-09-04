import React, { useState, useEffect, useRef, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Send, X, Bot, User, Lock, LocateFixed, MapPin, Wallet, Compass, RefreshCw, MessageSquare,
} from 'lucide-react';
import { api } from '../../services/api';
import { ChatMessageItem, TripItinerary } from '../../types';
import { buildJourneySnapshot } from '../live-map/journey';

interface TripChatDrawerProps {
  tripId: string;
  isOpen: boolean;
  onClose: () => void;
  isGuideAssigned: boolean;
  assignedGuideName?: string;
  onTriggerReplan?: () => void;
  currentPosition?: { lat: number; lng: number } | null;
  mode?: 'user' | 'guide';
  // Trip context for the "I'm following your journey" chips + quick questions
  destinationName?: string;
  tripStart?: string;
  tripEnd?: string;
  itinerary?: TripItinerary | null;
  travellerName?: string;
  budgetLabel?: string;
}

const TRAFFIC = [
  { c: 'bg-[#ff5f57]', id: 'close' },
  { c: 'bg-[#febc2e]', id: 'min' },
  { c: 'bg-[#28c840]', id: 'max' },
];

export const TripChatDrawer: React.FC<TripChatDrawerProps> = ({
  tripId, isOpen, onClose, isGuideAssigned, assignedGuideName, onTriggerReplan,
  currentPosition = null, mode = 'user', destinationName, tripStart, tripEnd,
  itinerary = null, travellerName, budgetLabel,
}) => {
  const isGuide = mode === 'guide';
  const [channel, setChannel] = useState<'AI' | 'GUIDE'>(isGuide ? 'GUIDE' : 'AI');
  const [messages, setMessages] = useState<ChatMessageItem[]>([]);
  const [inputText, setInputText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const snapshot = useMemo(
    () => (itinerary ? buildJourneySnapshot(itinerary, tripStart, tripEnd) : null),
    [itinerary, tripStart, tripEnd]
  );
  const nextStop = useMemo(() => {
    if (!snapshot?.currentStopId) return null;
    for (const d of itinerary?.days || []) for (const s of d.stops) if (s.id === snapshot.currentStopId) return s;
    return null;
  }, [itinerary, snapshot?.currentStopId]);

  const dayLabel = !snapshot
    ? 'Trip'
    : snapshot.notStarted
      ? 'Before trip'
      : snapshot.finished
        ? 'Trip complete'
        : snapshot.todayDayNo != null
          ? `Day ${snapshot.todayDayNo}`
          : 'Live trip';

  const gpsLabel = currentPosition
    ? 'Live GPS · resolved'
    : 'Live location unavailable';

  const fetchHistory = async () => {
    try {
      const hist = await api.getChatHistory(tripId, channel);
      setMessages(hist);
    } catch (err) {
      console.error('Chat history fetch failed:', err);
    }
  };

  useEffect(() => {
    if (isGuide) setChannel('GUIDE');
  }, [isGuide]);

  useEffect(() => {
    if (isOpen) fetchHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, tripId, channel]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = async (textToSend?: string) => {
    const text = textToSend || inputText;
    if (!text.trim()) return;
    setInputText('');
    setIsLoading(true);
    try {
      await api.sendChatMessage(tripId, text, channel, currentPosition);
      await fetchHistory();
      if (text.toLowerCase().includes('change') && onTriggerReplan) onTriggerReplan();
    } catch (err: any) {
      console.error('Message send error:', err);
    } finally {
      setIsLoading(false);
    }
  };

  // Context-aware quick questions — identical pipeline to typed questions.
  const quickPrompts = useMemo(() => {
    if (isGuide) {
      return [
        'Where is the traveller now?',
        'Where should we meet today?',
        'Share today\'s itinerary highlights',
        'What time is check-in?',
      ];
    }
    if (snapshot?.notStarted) {
      return [
        'What is my plan for Day 1?',
        'What should I pack?',
        'How much am I paying Travion?',
        'What is next?',
      ];
    }
    if (snapshot?.finished) {
      return [
        'How was my trip summary?',
        'What did I spend?',
        'Can I review my guide?',
      ];
    }
    return [
      'What is next?',
      `Where should I eat near ${destinationName || 'here'}?`,
      'How much have I spent so far?',
      'Is it cold there?',
    ];
  }, [isGuide, snapshot?.notStarted, snapshot?.finished, destinationName]);

  if (!isOpen) return null;

  const contextChips = isGuide
    ? [
        { icon: <User className="w-3 h-3" />, label: travellerName || 'Traveller', onClick: () => handleSend('Tell me about this traveller') },
        { icon: <MapPin className="w-3 h-3" />, label: destinationName || 'Trip', onClick: () => handleSend("What's the traveller's itinerary today?") },
        { icon: <LocateFixed className="w-3 h-3" />, label: gpsLabel, onClick: undefined },
      ]
    : [
        { icon: <MapPin className="w-3 h-3" />, label: `${dayLabel} · ${destinationName || 'Trip'}`, onClick: undefined },
        { icon: <Compass className="w-3 h-3" />, label: nextStop ? `Next: ${nextStop.title}` : 'No next stop yet', onClick: () => handleSend("What's next?") },
        { icon: <Wallet className="w-3 h-3" />, label: budgetLabel || 'Budget', onClick: () => handleSend('How much am I paying Travion?') },
        { icon: <LocateFixed className="w-3 h-3" />, label: gpsLabel, onClick: undefined },
      ];

  return (
    <motion.div
      initial={{ opacity: 0, x: 320 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 320 }}
      transition={{ type: 'tween', duration: 0.28, ease: 'easeOut' }}
      className="fixed right-0 top-0 bottom-0 w-full sm:w-[430px] bg-white shadow-2xl border-l border-slate-200 z-50 flex flex-col"
    >
      {/* macOS-style header */}
      <div className="px-4 pt-3.5 pb-3 border-b border-slate-100 bg-gradient-to-b from-slate-50 to-white">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            {TRAFFIC.map((t) => (
              <span key={t.id} className={`w-3 h-3 rounded-full ${t.c}`} />
            ))}
          </div>
          <div className="flex-1 text-center">
            <p className="text-[11px] font-black tracking-[0.18em] text-slate-700">
              {isGuide ? 'GUIDE CHAT' : 'TRAVION AI'}
            </p>
            <p className="text-[10px] font-semibold text-slate-400">
              {isGuide ? "I'm coordinating this trip with you." : "I'm following your journey."}
            </p>
          </div>
          <button onClick={onClose} className="p-1.5 text-slate-400 hover:text-slate-600 rounded-full hover:bg-slate-200">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Context chips */}
        <div className="mt-2.5 flex items-center gap-1.5 overflow-x-auto no-scrollbar">
          {contextChips.map((chip, i) => (
            <button
              key={i}
              type="button"
              disabled={!chip.onClick}
              onClick={chip.onClick}
              className={`whitespace-nowrap shrink-0 px-2.5 py-1 rounded-full border text-[10.5px] font-bold transition-colors ${
                chip.onClick
                  ? 'bg-travion-50 text-travion-700 border-travion-100 hover:bg-travion-100'
                  : 'bg-slate-50 text-slate-500 border-slate-200'
              }`}
            >
              <span className="inline-flex items-center gap-1">{chip.icon}{chip.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Channel swithcer (user mode only) */}
      {!isGuide && (
        <div className="p-3 bg-white border-b border-slate-100 flex items-center gap-2">
          <button
            onClick={() => setChannel('AI')}
            className={`flex-1 py-2 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 ${
              channel === 'AI' ? 'bg-travion-600 text-white shadow-sm' : 'bg-slate-50 text-slate-600 hover:bg-slate-100'
            }`}
          >
            <Bot className="w-4 h-4" />
            <span>Trip AI Assistant</span>
          </button>
          <button
            onClick={() => { if (isGuideAssigned) setChannel('GUIDE'); }}
            disabled={!isGuideAssigned}
            className={`flex-1 py-2 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 ${
              channel === 'GUIDE' ? 'bg-travion-600 text-white shadow-sm'
              : isGuideAssigned ? 'bg-slate-50 text-slate-600 hover:bg-slate-100'
              : 'bg-slate-100 text-slate-400 opacity-60 cursor-not-allowed'
            }`}
          >
            {isGuideAssigned ? <User className="w-4 h-4" /> : <Lock className="w-3.5 h-3.5" />}
            <span>Guide Chat {assignedGuideName ? `(${assignedGuideName.split(' ')[0]})` : ''}</span>
          </button>
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 p-4 overflow-y-auto space-y-3 bg-slate-50/40">
        {messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center p-6 text-slate-400">
            <div className="w-12 h-12 rounded-2xl bg-travion-50 text-travion-500 flex items-center justify-center mb-3">
              {isGuide ? <MessageSquare className="w-6 h-6" /> : <Bot className="w-6 h-6" />}
            </div>
            <p className="text-sm font-semibold text-slate-700">
              {isGuide ? 'Guide conversation ready' : 'Trip-aware assistant ready'}
            </p>
            <p className="text-xs text-slate-400 mt-1">
              {isGuide
                ? 'The traveller can message you here — trip context stays attached.'
                : 'Anything about your trip: food, budget, next stop, weather, changes.'}
            </p>
          </div>
        ) : (
          messages.map((msg) => {
            const isMe = isGuide ? msg.sender_role === 'GUIDE' : msg.sender_role === 'USER';
            const isAi = msg.sender_role === 'AI';
            return (
              <div key={msg.id} className={`flex flex-col ${isMe ? 'items-end' : 'items-start'}`}>
                <span className="text-[10px] font-bold text-slate-400 px-1 mb-0.5">{msg.sender_name}</span>
                <div className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-xs font-medium leading-relaxed whitespace-pre-line ${
                  isMe
                    ? 'bg-travion-600 text-white rounded-tr-none'
                    : isAi
                      ? 'bg-white text-slate-800 border border-slate-200 rounded-tl-none shadow-sm'
                      : 'bg-amber-500 text-white rounded-tl-none'
                }`}>
                  {msg.message}
                </div>
              </div>
            );
          })
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Quick prompts */}
      <div className="p-2.5 bg-white border-t border-slate-100 flex items-center gap-1.5 overflow-x-auto no-scrollbar">
        {quickPrompts.map((prompt, idx) => (
          <button
            key={idx}
            type="button"
            onClick={() => handleSend(prompt)}
            className="whitespace-nowrap px-3 py-1 rounded-full bg-slate-100 hover:bg-travion-50 hover:text-travion-700 text-[11px] font-semibold text-slate-600 border border-slate-200 transition-colors shrink-0"
          >
            {prompt}
          </button>
        ))}
      </div>

      {/* Input */}
      <div className="p-3 bg-white border-t border-slate-200 flex items-center gap-2">
        <input
          type="text"
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSend()}
          placeholder={isGuide ? "Message the traveller..." : channel === 'GUIDE' ? 'Message your assigned guide...' : 'Ask Trip AI anything...'}
          className="flex-1 px-4 py-2.5 rounded-2xl border border-slate-200 text-xs font-semibold focus:border-travion-500 focus:outline-none bg-slate-50"
        />
        <button
          onClick={() => handleSend()}
          disabled={isLoading || !inputText.trim()}
          className="p-2.5 rounded-2xl bg-travion-600 hover:bg-travion-700 text-white shadow-sm transition-all disabled:opacity-40"
        >
          {isLoading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
        </button>
      </div>
    </motion.div>
  );
};