import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  MessageSquare, Send, Sparkles, User, X, Lock, RefreshCw,
  Compass, AlertCircle, Bot
} from 'lucide-react';
import { api } from '../../services/api';
import { ChatMessageItem } from '../../types';

interface TripChatDrawerProps {
  tripId: string;
  isOpen: boolean;
  onClose: () => void;
  isGuideAssigned: boolean;
  assignedGuideName?: string;
  onTriggerReplan?: () => void;
}

export const TripChatDrawer: React.FC<TripChatDrawerProps> = ({
  tripId,
  isOpen,
  onClose,
  isGuideAssigned,
  assignedGuideName,
  onTriggerReplan
}) => {
  const [channel, setChannel] = useState<'AI' | 'GUIDE'>('AI');
  const [messages, setMessages] = useState<ChatMessageItem[]>([]);
  const [inputText, setInputText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const fetchHistory = async () => {
    try {
      const hist = await api.getChatHistory(tripId, channel);
      setMessages(hist);
    } catch (err) {
      console.error("Chat history fetch failed:", err);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchHistory();
    }
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
      await api.sendChatMessage(tripId, text, channel);
      await fetchHistory();
      if (text.toLowerCase().includes("change") && onTriggerReplan) {
        onTriggerReplan();
      }
    } catch (err: any) {
      console.error("Message send error:", err);
    } finally {
      setIsLoading(false);
    }
  };

  const quickPrompts = [
    "Where should I eat tonight?",
    "I am tired, change today's plan",
    "What emergency contacts are nearby?",
    "Tell me about the hidden gems"
  ];

  if (!isOpen) return null;

  return (
    <motion.div
      initial={{ opacity: 0, x: 300 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 300 }}
      className="fixed right-0 top-0 bottom-0 w-full sm:w-[420px] bg-white shadow-2xl border-l border-slate-200 z-50 flex flex-col"
    >
      {/* Drawer Header */}
      <div className="p-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/70">
        <div>
          <span className="text-[10px] font-bold uppercase tracking-wider text-travion-600">Trip Scoped Memory</span>
          <h3 className="text-base font-extrabold text-slate-900 flex items-center gap-2">
            <span>Travion Trip Chat</span>
          </h3>
        </div>
        <button
          onClick={onClose}
          className="p-1.5 text-slate-400 hover:text-slate-600 rounded-full hover:bg-slate-200"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Channel Switcher */}
      <div className="p-3 bg-white border-b border-slate-100 flex items-center gap-2">
        <button
          onClick={() => setChannel('AI')}
          className={`flex-1 py-2 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 ${
            channel === 'AI'
              ? 'bg-travion-600 text-white shadow-sm'
              : 'bg-slate-50 text-slate-600 hover:bg-slate-100'
          }`}
        >
          <Bot className="w-4 h-4" />
          <span>Trip AI Assistant</span>
        </button>

        <button
          onClick={() => {
            if (isGuideAssigned) setChannel('GUIDE');
          }}
          disabled={!isGuideAssigned}
          className={`flex-1 py-2 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 ${
            channel === 'GUIDE'
              ? 'bg-travion-600 text-white shadow-sm'
              : isGuideAssigned
              ? 'bg-slate-50 text-slate-600 hover:bg-slate-100'
              : 'bg-slate-100 text-slate-400 opacity-60 cursor-not-allowed'
          }`}
        >
          {isGuideAssigned ? <User className="w-4 h-4" /> : <Lock className="w-3.5 h-3.5" />}
          <span>Guide Chat {assignedGuideName ? `(${assignedGuideName.split(' ')[0]})` : ''}</span>
        </button>
      </div>

      {/* Chat Messages List */}
      <div className="flex-1 p-4 overflow-y-auto space-y-3 bg-slate-50/40">
        {messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center p-6 text-slate-400">
            <div className="w-12 h-12 rounded-2xl bg-travion-50 text-travion-500 flex items-center justify-center mb-3">
              <Sparkles className="w-6 h-6" />
            </div>
            <p className="text-sm font-semibold text-slate-700">Trip AI Assistant Ready</p>
            <p className="text-xs text-slate-400 mt-1">
              Ask about nearby food, adjust your stops, or request navigation details.
            </p>
          </div>
        ) : (
          messages.map((msg) => {
            const isMe = msg.sender_role === 'USER';
            const isAi = msg.sender_role === 'AI';
            return (
              <div
                key={msg.id}
                className={`flex flex-col ${isMe ? 'items-end' : 'items-start'}`}
              >
                <span className="text-[10px] font-bold text-slate-400 px-1 mb-0.5">
                  {msg.sender_name}
                </span>
                <div
                  className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-xs font-medium leading-relaxed ${
                    isMe
                      ? 'bg-travion-600 text-white rounded-tr-none'
                      : isAi
                      ? 'bg-white text-slate-800 border border-slate-200 rounded-tl-none shadow-sm'
                      : 'bg-amber-500 text-white rounded-tl-none'
                  }`}
                >
                  {msg.message}
                </div>
              </div>
            );
          })
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Suggested Quick Prompt Chips (AI Channel only) */}
      {channel === 'AI' && (
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
      )}

      {/* Input Field */}
      <div className="p-3 bg-white border-t border-slate-200 flex items-center gap-2">
        <input
          type="text"
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSend()}
          placeholder={channel === 'AI' ? "Ask Trip AI anything..." : "Message your assigned guide..."}
          className="flex-1 px-4 py-2.5 rounded-2xl border border-slate-200 text-xs font-semibold focus:border-travion-500 focus:outline-none bg-slate-50"
        />
        <button
          onClick={() => handleSend()}
          disabled={isLoading || !inputText.trim()}
          className="p-2.5 rounded-2xl bg-travion-600 hover:bg-travion-700 text-white shadow-sm transition-all disabled:opacity-40"
        >
          <Send className="w-4 h-4" />
        </button>
      </div>
    </motion.div>
  );
};
