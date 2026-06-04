import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Sparkles, Copy, RefreshCw, ChevronDown, ChevronUp, ExternalLink, CheckCheck, AlertCircle } from 'lucide-react';

/**
 * AIAnswerCard
 * ─────────────────────────────────────────────────────────────────────────────
 * Perplexity-style AI answer card that displays:
 *   - Streaming-style typing animation of the AI answer
 *   - Confidence indicator bar
 *   - Collapsible source citations
 *   - Copy and Regenerate buttons
 *   - Loading skeleton state
 *
 * Props:
 *   answer      {string}   — AI generated answer text
 *   sources     {Array}    — [{ index, title, url, score }]
 *   confidence  {number}   — 0.0 – 1.0
 *   latencyMs   {number}   — time taken for AI response
 *   fromCache   {boolean}  — whether served from Redis cache
 *   loading     {boolean}  — whether AI is currently generating
 *   error       {string}   — error message if AI failed
 *   onRegenerate {fn}      — callback to trigger new AI call
 */
export default function AIAnswerCard({
  answer,
  sources = [],
  confidence = 0,
  latencyMs,
  fromCache,
  loading,
  error,
  onRegenerate,
}) {
  const [displayedText, setDisplayedText] = useState('');
  const [showSources, setShowSources] = useState(true);
  const [copied, setCopied]           = useState(false);
  const [isTyping, setIsTyping]       = useState(false);
  const animFrameRef                  = useRef(null);
  const prevAnswerRef                 = useRef('');

  // Character-by-character typing animation
  useEffect(() => {
    if (!answer || answer === prevAnswerRef.current) return;
    prevAnswerRef.current = answer;

    setIsTyping(true);
    setDisplayedText('');

    let i = 0;
    const chars = answer.split('');

    // Use requestAnimationFrame for smooth, non-blocking animation
    const step = () => {
      // Add 3 chars per frame for a fast but visible effect
      const chunkSize = 3;
      const nextI = Math.min(i + chunkSize, chars.length);
      setDisplayedText(chars.slice(0, nextI).join(''));
      i = nextI;

      if (i < chars.length) {
        animFrameRef.current = requestAnimationFrame(step);
      } else {
        setIsTyping(false);
      }
    };

    animFrameRef.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(animFrameRef.current);
  }, [answer]);

  const handleCopy = async () => {
    if (!answer) return;
    try {
      await navigator.clipboard.writeText(answer);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback for non-secure contexts
    }
  };

  const confidenceLabel =
    confidence >= 0.8 ? 'High' :
    confidence >= 0.5 ? 'Medium' :
    'Low';

  const confidenceColor =
    confidence >= 0.8 ? '#22c55e' :
    confidence >= 0.5 ? '#f59e0b' :
    '#ef4444';

  return (
    <motion.div
      className="ai-answer-card"
      initial={{ opacity: 0, y: -12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: 'easeOut' }}
    >
      {/* ── Header ────────────────────────────────────────────────────────── */}
      <div className="ai-card-header">
        <div className="ai-card-title">
          <motion.div
            className="ai-icon-wrapper"
            animate={loading ? { rotate: 360 } : { rotate: 0 }}
            transition={loading ? { repeat: Infinity, duration: 1.5, ease: 'linear' } : {}}
          >
            <Sparkles size={18} />
          </motion.div>
          <span>AI Answer</span>
          {fromCache && !loading && (
            <span className="ai-cache-badge">⚡ Cached</span>
          )}
        </div>

        <div className="ai-header-actions">
          {!loading && answer && (
            <>
              <button
                className="ai-action-btn"
                onClick={handleCopy}
                title="Copy answer"
              >
                {copied ? <CheckCheck size={15} /> : <Copy size={15} />}
                {copied ? 'Copied!' : 'Copy'}
              </button>
              <button
                className="ai-action-btn"
                onClick={onRegenerate}
                title="Regenerate answer"
              >
                <RefreshCw size={15} />
                Regenerate
              </button>
            </>
          )}
        </div>
      </div>

      {/* ── Loading skeleton ───────────────────────────────────────────────── */}
      {loading && (
        <div className="ai-skeleton">
          <div className="ai-skeleton-thinking">
            <motion.div
              className="ai-thinking-dots"
              animate={{ opacity: [0.4, 1, 0.4] }}
              transition={{ repeat: Infinity, duration: 1.2 }}
            >
              <span /><span /><span />
            </motion.div>
            <span className="ai-thinking-label">Searching and thinking...</span>
          </div>
          <div className="ai-skeleton-line" style={{ width: '95%' }} />
          <div className="ai-skeleton-line" style={{ width: '88%' }} />
          <div className="ai-skeleton-line" style={{ width: '72%' }} />
          <div className="ai-skeleton-line" style={{ width: '80%', marginTop: '0.5rem' }} />
          <div className="ai-skeleton-line" style={{ width: '60%' }} />
        </div>
      )}

      {/* ── Error state ────────────────────────────────────────────────────── */}
      {error && !loading && (
        <div className="ai-error-state">
          <AlertCircle size={20} />
          <p>{error}</p>
        </div>
      )}

      {/* ── AI Answer text ─────────────────────────────────────────────────── */}
      {!loading && !error && displayedText && (
        <div className="ai-answer-body">
          <p className="ai-answer-text">
            {displayedText}
            {isTyping && <span className="ai-cursor" />}
          </p>
        </div>
      )}

      {/* ── Confidence + Latency bar ───────────────────────────────────────── */}
      {!loading && !error && answer && (
        <div className="ai-meta-bar">
          <div className="ai-confidence">
            <span className="ai-meta-label">Confidence</span>
            <div className="ai-confidence-bar-bg">
              <motion.div
                className="ai-confidence-bar-fill"
                initial={{ width: 0 }}
                animate={{ width: `${Math.round(confidence * 100)}%` }}
                transition={{ duration: 0.6, ease: 'easeOut', delay: 0.3 }}
                style={{ background: confidenceColor }}
              />
            </div>
            <span className="ai-confidence-label" style={{ color: confidenceColor }}>
              {confidenceLabel} ({Math.round(confidence * 100)}%)
            </span>
          </div>

          {latencyMs && (
            <span className="ai-latency-tag">
              {fromCache ? '⚡ Cached' : `🤖 ${latencyMs}ms`}
            </span>
          )}
        </div>
      )}

      {/* ── Sources ────────────────────────────────────────────────────────── */}
      {!loading && !error && sources.length > 0 && (
        <div className="ai-sources">
          <button
            className="ai-sources-toggle"
            onClick={() => setShowSources(s => !s)}
          >
            <span>Sources ({sources.length})</span>
            {showSources ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
          </button>

          <AnimatePresence>
            {showSources && (
              <motion.div
                className="ai-sources-list"
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.25 }}
              >
                {sources.map((src) => (
                  <motion.a
                    key={src.url}
                    href={src.url}
                    target="_blank"
                    rel="noreferrer"
                    className="ai-source-chip"
                    whileHover={{ y: -1, scale: 1.02 }}
                    transition={{ duration: 0.15 }}
                  >
                    <span className="ai-source-index">{src.index}</span>
                    <div className="ai-source-info">
                      <span className="ai-source-title">{src.title || src.url}</span>
                      <span className="ai-source-url">{src.url}</span>
                    </div>
                    <ExternalLink size={12} className="ai-source-ext" />
                  </motion.a>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}
    </motion.div>
  );
}
