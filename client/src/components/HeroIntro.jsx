import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Globe, Database, ListOrdered, Share2, Search } from 'lucide-react';
import './HeroIntro.css';

const HeroIntro = ({ onComplete }) => {
  const [stage, setStage] = useState(0);
  const [typedText, setTypedText] = useState('');

  const fullSearchQuery = "mern stack";

  useEffect(() => {
    let timer;
    const sequence = async () => {
      // Stage 0: Initial load & Logo Reveal (0s - 2s)
      await new Promise(r => setTimeout(r, 2000));
      setStage(1);
      
      // Stage 1: Engine Animation (Crawl, Index, Rank) (2s - 5s)
      await new Promise(r => setTimeout(r, 3000));
      setStage(2);

      // Stage 2: Typing "mern stack" (5s - 6.5s)
      for (let i = 0; i <= fullSearchQuery.length; i++) {
        setTypedText(fullSearchQuery.slice(0, i));
        await new Promise(r => setTimeout(r, 100)); // Typewriter effect
      }
      
      // Wait a moment after typing, then show results animation (6.5s - 8.5s)
      await new Promise(r => setTimeout(r, 500));
      setStage(3);

      // Stage 4: Transition out (8.5s - 9.5s)
      await new Promise(r => setTimeout(r, 2000));
      setStage(4);

      await new Promise(r => setTimeout(r, 1000));
      onComplete();
    };

    sequence();
    return () => clearTimeout(timer);
  }, [onComplete]);

  return (
    <motion.div 
      className="hero-intro-container"
      initial={{ opacity: 1 }}
      animate={{ opacity: stage === 4 ? 0 : 1 }}
      transition={{ duration: 0.8, ease: "easeInOut" }}
    >
      {/* Background ambient glowing gradients */}
      <div className="ambient-glow glow-1"></div>
      <div className="ambient-glow glow-2"></div>
      <div className="ambient-glow glow-3"></div>

      {/* Floating particles */}
      <div className="particles-container">
        {[...Array(20)].map((_, i) => (
          <motion.div
            key={i}
            className="particle"
            initial={{ 
              y: Math.random() * window.innerHeight, 
              x: Math.random() * window.innerWidth,
              opacity: Math.random() * 0.5 + 0.1
            }}
            animate={{
              y: [null, Math.random() * window.innerHeight],
              x: [null, Math.random() * window.innerWidth]
            }}
            transition={{
              duration: Math.random() * 10 + 10,
              repeat: Infinity,
              ease: "linear"
            }}
          />
        ))}
      </div>

      <AnimatePresence>
        {stage === 0 && (
          <motion.div 
            key="logo-reveal"
            className="logo-reveal-container"
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 1.2, opacity: 0, filter: 'blur(10px)' }}
            transition={{ duration: 1.5, ease: [0.22, 1, 0.36, 1] }}
          >
            <div className="orbital-ring ring-1"></div>
            <div className="orbital-ring ring-2"></div>
            <Globe className="hero-logo-icon" size={64} />
            <h1 className="hero-logo-text">GravitySearch</h1>
            <p className="hero-logo-sub">Advanced AI-Powered Indexing</p>
          </motion.div>
        )}

        {stage === 1 && (
          <motion.div 
            key="engine-animation"
            className="engine-animation-container"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20, filter: 'blur(10px)' }}
            transition={{ duration: 0.8 }}
          >
            <div className="engine-nodes">
              <Node icon={<Share2 />} label="Crawl" delay={0} />
              <div className="connector line-1"></div>
              <Node icon={<Database />} label="Index" delay={0.4} />
              <div className="connector line-2"></div>
              <Node icon={<ListOrdered />} label="Rank" delay={0.8} />
            </div>
            <motion.div 
              className="data-flow-pulse"
              initial={{ scaleX: 0, opacity: 0 }}
              animate={{ scaleX: 1, opacity: 0.5 }}
              transition={{ duration: 2, repeat: Infinity }}
            />
          </motion.div>
        )}

        {(stage === 2 || stage === 3) && (
          <motion.div 
            key="search-interaction"
            className="search-interaction-container"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, y: -50 }}
            transition={{ duration: 0.8, ease: "easeOut" }}
          >
            <div className="hero-search-bar glass">
              <Search className="hero-search-icon" size={24} />
              <span className="hero-search-text">
                {typedText}
                <motion.span 
                  className="cursor"
                  animate={{ opacity: [1, 0] }}
                  transition={{ repeat: Infinity, duration: 0.8 }}
                >|</motion.span>
              </span>
            </div>

            {stage === 3 && (
              <motion.div 
                className="hero-results-mock"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ staggerChildren: 0.2 }}
              >
                {[1, 2, 3].map((item) => (
                  <motion.div 
                    key={item}
                    className="hero-result-card glass glow-shadow"
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: item * 0.15 }}
                  >
                    <div className="mock-title"></div>
                    <div className="mock-url"></div>
                    <div className="mock-snippet"></div>
                  </motion.div>
                ))}
              </motion.div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
};

const Node = ({ icon, label, delay }) => (
  <motion.div 
    className="engine-node glass glow-shadow"
    initial={{ scale: 0, opacity: 0 }}
    animate={{ scale: 1, opacity: 1 }}
    transition={{ delay, type: "spring", stiffness: 200, damping: 20 }}
  >
    {icon}
    <span>{label}</span>
  </motion.div>
);

export default HeroIntro;
