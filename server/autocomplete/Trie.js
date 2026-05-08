/**
 * Trie.js — Prefix Tree for autocomplete suggestions
 * ─────────────────────────────────────────────────────────────────────────────
 * Each node stores:
 *   children   : Map<char, TrieNode>
 *   isEnd      : boolean        — marks a complete word endpoint
 *   frequency  : number         — how often this word was seen/searched
 *   word       : string | null  — full word stored at the end node (avoids
 *                                 reconstructing during traversal)
 *
 * Complexity:
 *   insert   → O(L)        where L = word length
 *   suggest  → O(L + K)    L to reach prefix node, K = total nodes under it
 *              Practically O(1) for short prefixes with a topN cap
 */

"use strict";

class TrieNode {
  constructor() {
    this.children  = new Map();
    this.isEnd     = false;
    this.frequency = 0;
    this.word      = null;
  }
}

class Trie {
  constructor() {
    this.root  = new TrieNode();
    this._size = 0; // number of distinct words inserted
  }

  /**
   * insert(word, frequency)
   * Inserts a word into the Trie. If it already exists, the frequency is
   * added (not replaced) so repeated searches accumulate weight.
   *
   * @param {string} word
   * @param {number} [frequency=1]
   */
  insert(word, frequency = 1) {
    if (!word || typeof word !== "string") return;
    word = word.toLowerCase().trim();
    if (word.length === 0 || word.length > 50) return;

    let node = this.root;
    for (const char of word) {
      if (!node.children.has(char)) {
        node.children.set(char, new TrieNode());
      }
      node = node.children.get(char);
    }

    if (!node.isEnd) {
      node.isEnd = true;
      node.word  = word;
      this._size++;
    }
    node.frequency += frequency;
  }

  /**
   * getSuggestions(prefix, topN)
   * Returns the top-N complete words that start with `prefix`,
   * ranked by frequency descending.
   *
   * @param {string} prefix
   * @param {number} [topN=8]
   * @returns {Array<{ word: string, frequency: number }>}
   */
  getSuggestions(prefix, topN = 8) {
    if (!prefix) return [];
    prefix = prefix.toLowerCase().trim();

    // Navigate to the prefix endpoint
    let node = this.root;
    for (const char of prefix) {
      if (!node.children.has(char)) return []; // prefix not found
      node = node.children.get(char);
    }

    // BFS/DFS collect all words under this prefix node
    const results = [];
    this._collect(node, results);

    // Sort by frequency descending, slice to topN
    results.sort((a, b) => b.frequency - a.frequency);
    return results.slice(0, topN);
  }

  /**
   * _collect(node, results)
   * DFS traversal to collect all complete words reachable from `node`.
   * Uses an iterative stack to avoid call-stack overflow on large Tries.
   *
   * @param {TrieNode} startNode
   * @param {Array}    results   — mutable output array
   */
  _collect(startNode, results) {
    const stack = [startNode];
    while (stack.length > 0) {
      const current = stack.pop();
      if (current.isEnd) {
        results.push({ word: current.word, frequency: current.frequency });
      }
      for (const child of current.children.values()) {
        stack.push(child);
      }
    }
  }

  /**
   * size() — number of distinct words in the Trie
   */
  get size() {
    return this._size;
  }

  /**
   * clear() — reset the Trie (called before rebuilds)
   */
  clear() {
    this.root  = new TrieNode();
    this._size = 0;
  }
}

module.exports = Trie;
