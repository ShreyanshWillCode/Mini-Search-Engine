import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Network, Activity, Cpu, X, Share2, ExternalLink } from 'lucide-react';
import { graphService } from '../services/api';
import ForceGraph from './ForceGraph';
import './Visualization.css';

const VisualizationDashboard = ({ onClose }) => {
  const [graphData, setGraphData] = useState({ nodes: [], links: [] });
  const [loading, setLoading] = useState(true);
  const [selectedNode, setSelectedNode] = useState(null);
  const [mode, setMode] = useState('graph'); // 'graph', 'pagerank', 'crawl'

  useEffect(() => {
    const fetchGraph = async () => {
      try {
        const res = await graphService.getGraphData();
        setGraphData({
          nodes: res.data.nodes,
          links: res.data.links
        });
      } catch (err) {
        console.error("Failed to load graph data", err);
      } finally {
        setLoading(false);
      }
    };
    fetchGraph();
  }, []);

  const handleNodeClick = (node) => {
    setSelectedNode(node);
  };

  return (
    <motion.div 
      className="viz-dashboard"
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 1.05 }}
      transition={{ duration: 0.5, ease: "easeInOut" }}
    >
      {/* Background Glows */}
      <div className="viz-glow top-left"></div>
      <div className="viz-glow bottom-right"></div>

      {/* Header */}
      <header className="viz-header">
        <div className="viz-brand">
          <Network size={24} />
          <span>Gravity Engine Visualization</span>
        </div>

        <div className="viz-controls">
          <button 
            className={`viz-mode-btn ${mode === 'graph' ? 'active' : ''}`}
            onClick={() => setMode('graph')}
          >
            <Share2 size={16} style={{marginRight: 6, display:'inline'}}/>
            Topology
          </button>
          <button 
            className={`viz-mode-btn ${mode === 'pagerank' ? 'active' : ''}`}
            onClick={() => setMode('pagerank')}
          >
            <Activity size={16} style={{marginRight: 6, display:'inline'}}/>
            PageRank Flow
          </button>
          <button 
            className={`viz-mode-btn ${mode === 'crawl' ? 'active' : ''}`}
            onClick={() => setMode('crawl')}
          >
            <Cpu size={16} style={{marginRight: 6, display:'inline'}}/>
            Crawl Queue
          </button>
        </div>

        <button className="viz-exit-btn" onClick={onClose}>
          <X size={18} /> Exit
        </button>
      </header>

      {/* Main Graph Area */}
      <main className="viz-main">
        {loading ? (
          <div style={{display:'flex', width:'100%', height:'100%', alignItems:'center', justifyContent:'center'}}>
            <motion.div 
              animate={{ rotate: 360 }} 
              transition={{ repeat: Infinity, duration: 2, ease: "linear" }}
            >
              <Cpu size={48} color="#8b5cf6" />
            </motion.div>
          </div>
        ) : (
          <div className="graph-container">
            <ForceGraph data={graphData} onNodeClick={handleNodeClick} />
          </div>
        )}

        {/* Side Panel for Details */}
        <AnimatePresence>
          {selectedNode && (
            <motion.div 
              className="viz-side-panel"
              initial={{ opacity: 0, x: 50 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 50 }}
            >
              <div className="viz-panel-section">
                <h3>Node Intelligence</h3>
                <div className="node-details">
                  <div className="node-title">{selectedNode.title}</div>
                  <a href={selectedNode.id} target="_blank" rel="noreferrer" className="node-url" style={{display:'flex', alignItems:'center', gap:4}}>
                    {selectedNode.id} <ExternalLink size={12}/>
                  </a>
                  
                  <div className="node-metrics">
                    <div className="nm-row">
                      <span>PageRank Score</span>
                      <span style={{color: '#8b5cf6', fontWeight: 'bold'}}>{(selectedNode.pagerank || 0).toFixed(6)}</span>
                    </div>
                    <div className="nm-row">
                      <span>Crawl Depth</span>
                      <span>Level {selectedNode.depth}</span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="viz-panel-section">
                <h3>Network Links</h3>
                <div className="viz-stat-grid">
                  <div className="viz-stat-box">
                    <span className="viz-stat-label">Inbound Links</span>
                    <span className="viz-stat-val">
                      {graphData.links.filter(l => l.target === selectedNode.id || l.target.id === selectedNode.id).length}
                    </span>
                  </div>
                  <div className="viz-stat-box">
                    <span className="viz-stat-label">Outbound Links</span>
                    <span className="viz-stat-val">
                      {graphData.links.filter(l => l.source === selectedNode.id || l.source.id === selectedNode.id).length}
                    </span>
                  </div>
                </div>
              </div>

              <button 
                className="viz-exit-btn" 
                style={{marginTop: 'auto', justifyContent: 'center', background: 'rgba(139, 92, 246, 0.2)', borderColor: '#8b5cf6', color: '#fff'}}
                onClick={() => setSelectedNode(null)}
              >
                Deselect Node
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        {!selectedNode && !loading && (
          <div className="viz-side-panel" style={{opacity: 0.6}}>
            <div className="empty-selection">
              <Network size={48} style={{margin: '0 auto 1rem', opacity: 0.5}} />
              <p>Select a node to view its intelligence metrics.</p>
            </div>
            
            <div className="viz-panel-section" style={{marginTop: '2rem'}}>
              <h3>Global Network</h3>
              <div className="viz-stat-grid">
                <div className="viz-stat-box">
                  <span className="viz-stat-label">Total Nodes</span>
                  <span className="viz-stat-val">{graphData.nodes.length}</span>
                </div>
                <div className="viz-stat-box">
                  <span className="viz-stat-label">Total Edges</span>
                  <span className="viz-stat-val">{graphData.links.length}</span>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>
    </motion.div>
  );
};

export default VisualizationDashboard;
