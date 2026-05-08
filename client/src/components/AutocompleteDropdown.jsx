/**
 * AutocompleteDropdown.jsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Renders a floating suggestion panel below the search bar.
 *
 * Props:
 *   suggestions  {Array<{word, frequency}>}  — from /api/autocomplete
 *   query        {string}                    — current search bar value
 *   onSelect     {(word: string) => void}    — called when user picks a suggestion
 *   visible      {boolean}
 *   selectedIdx  {number}                    — keyboard-highlighted index (-1 = none)
 */

import React, { memo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Search } from 'lucide-react';
import './AutocompleteDropdown.css';

// Helper: split `word` into [prefix, rest] based on the last token of `query`
function splitMatch(word, query) {
  if (!query) return ['', word];
  const lastToken = query.trim().split(/\s+/).pop().toLowerCase();
  const idx       = word.toLowerCase().indexOf(lastToken);
  if (idx === -1 || lastToken.length === 0) return ['', word];
  return [
    word.slice(0, idx + lastToken.length),   // matched prefix
    word.slice(idx + lastToken.length),       // remainder
  ];
}

const AutocompleteDropdown = memo(({ suggestions, query, onSelect, visible, selectedIdx = -1 }) => {
  if (!visible || !suggestions || suggestions.length === 0) return null;

  return (
    <AnimatePresence>
      <motion.div
        className="autocomplete-dropdown"
        initial={{ opacity: 0, y: -6, scale: 0.98 }}
        animate={{ opacity: 1, y: 0,  scale: 1    }}
        exit={{    opacity: 0, y: -6, scale: 0.98 }}
        transition={{ duration: 0.15, ease: 'easeOut' }}
        // Prevent the dropdown click from blurring the search input
        onMouseDown={(e) => e.preventDefault()}
      >
        {suggestions.map((item, idx) => {
          const [matched, rest] = splitMatch(item.word, query);
          return (
            <motion.button
              key={item.word}
              className={`suggestion-item${idx === selectedIdx ? ' keyboard-selected' : ''}`}
              onClick={() => onSelect(item.word)}
              initial={{ opacity: 0, x: -4 }}
              animate={{ opacity: 1, x: 0  }}
              transition={{ duration: 0.1, delay: idx * 0.03 }}
            >
              <Search className="suggestion-icon" size={14} />
              <span className="suggestion-text">
                <span className="match">{matched}</span>{rest}
              </span>
              {item.frequency > 1 && (
                <span className="suggestion-freq" title="Frequency score">
                  ×{item.frequency}
                </span>
              )}
            </motion.button>
          );
        })}

        <div className="suggestion-footer">
          <kbd>↑↓</kbd> navigate &nbsp; <kbd>↵</kbd> select &nbsp; <kbd>Esc</kbd> close
        </div>
      </motion.div>
    </AnimatePresence>
  );
});

AutocompleteDropdown.displayName = 'AutocompleteDropdown';
export default AutocompleteDropdown;
