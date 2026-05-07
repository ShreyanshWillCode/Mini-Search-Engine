import React, { useRef, useEffect } from 'react';
import * as d3 from 'd3';

const ForceGraph = ({ data, onNodeClick }) => {
  const containerRef = useRef(null);

  useEffect(() => {
    if (!data || !data.nodes || !data.links || !containerRef.current) return;

    // Clear previous graph
    d3.select(containerRef.current).selectAll("*").remove();

    const width = containerRef.current.clientWidth;
    const height = containerRef.current.clientHeight;

    // Setup SVG
    const svg = d3.select(containerRef.current)
      .append("svg")
      .attr("class", "d3-canvas")
      .attr("width", width)
      .attr("height", height);

    // Add a group for zooming/panning
    const g = svg.append("g");

    // Setup Zoom
    const zoom = d3.zoom()
      .scaleExtent([0.1, 4])
      .on("zoom", (event) => {
        g.attr("transform", event.transform);
      });
    svg.call(zoom);

    // Deep copy data because D3 mutates it
    const nodes = data.nodes.map(d => ({ ...d }));
    const links = data.links.map(d => ({ ...d }));

    // Force Simulation
    const simulation = d3.forceSimulation(nodes)
      .force("link", d3.forceLink(links).id(d => d.id).distance(100))
      .force("charge", d3.forceManyBody().strength(-200))
      .force("center", d3.forceCenter(width / 2, height / 2))
      .force("collide", d3.forceCollide().radius(d => Math.max(10, d.pagerank * 50 + 10)));

    // Draw Links
    const link = g.append("g")
      .attr("stroke", "rgba(255, 255, 255, 0.2)")
      .attr("stroke-opacity", 0.6)
      .selectAll("line")
      .data(links)
      .join("line")
      .attr("stroke-width", Math.sqrt);

    // Color Scale based on depth or group
    const color = d3.scaleOrdinal(d3.schemeSet3);

    // Draw Nodes
    const node = g.append("g")
      .attr("stroke", "#fff")
      .attr("stroke-width", 1.5)
      .selectAll("circle")
      .data(nodes)
      .join("circle")
      .attr("r", d => Math.max(5, (d.pagerank || 0) * 50 + 5))
      .attr("fill", d => color(d.group))
      .call(drag(simulation));

    // Tooltip
    const tooltip = d3.select(containerRef.current)
      .append("div")
      .attr("class", "d3-tooltip")
      .style("opacity", 0);

    node.on("mouseover", (event, d) => {
      tooltip.transition().duration(200).style("opacity", 1);
      tooltip.html(`
        <strong>${d.title}</strong><br/>
        PR: ${(d.pagerank || 0).toFixed(4)}<br/>
        Depth: ${d.depth}
      `)
      .style("left", (event.pageX) + "px")
      .style("top", (event.pageY) + "px");
      
      d3.select(event.currentTarget).attr("stroke", "#8b5cf6").attr("stroke-width", 3);
    })
    .on("mouseout", (event) => {
      tooltip.transition().duration(500).style("opacity", 0);
      d3.select(event.currentTarget).attr("stroke", "#fff").attr("stroke-width", 1.5);
    })
    .on("click", (event, d) => {
      if (onNodeClick) onNodeClick(d);
    });

    // Simulation Tick
    simulation.on("tick", () => {
      link
        .attr("x1", d => d.source.x)
        .attr("y1", d => d.source.y)
        .attr("x2", d => d.target.x)
        .attr("y2", d => d.target.y);

      node
        .attr("cx", d => d.x)
        .attr("cy", d => d.y);
    });

    // Drag functionality
    function drag(simulation) {
      function dragstarted(event) {
        if (!event.active) simulation.alphaTarget(0.3).restart();
        event.subject.fx = event.subject.x;
        event.subject.fy = event.subject.y;
      }
      
      function dragged(event) {
        event.subject.fx = event.x;
        event.subject.fy = event.y;
      }
      
      function dragended(event) {
        if (!event.active) simulation.alphaTarget(0);
        event.subject.fx = null;
        event.subject.fy = null;
      }
      
      return d3.drag()
        .on("start", dragstarted)
        .on("drag", dragged)
        .on("end", dragended);
    }

    return () => {
      simulation.stop();
      tooltip.remove();
    };
  }, [data, onNodeClick]);

  return <div ref={containerRef} style={{ width: '100%', height: '100%' }} />;
};

export default ForceGraph;
