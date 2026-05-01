/**
 * queue.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Custom O(1) FIFO Queue for BFS traversal.
 *
 * WHY NOT JUST USE Array.shift()?
 *   Array.shift() is O(n) — every dequeue re-indexes the entire array.
 *   At scale (thousands of URLs) this becomes a bottleneck.
 *
 * THIS IMPLEMENTATION:
 *   Uses a plain object as a hash map with head/tail pointers.
 *   → enqueue()  O(1)
 *   → dequeue()  O(1)   (no shifting, just a pointer increment)
 *   → peek()     O(1)
 *   → size       O(1)
 *
 * DSA Concept:
 *   Simulates a linked-list queue using an object as memory.
 *   head  → index of the front element (next to dequeue)
 *   tail  → index where the next element will be inserted
 *
 *   Example state after enqueue(A), enqueue(B), dequeue():
 *     items = { 1: B }   head = 1   tail = 2
 */

class Queue {
  constructor() {
    this._items = {}; // internal storage (hash map)
    this._head = 0;   // pointer to front of queue
    this._tail = 0;   // pointer to next insertion slot
  }

  // ── Core operations ────────────────────────────────────────────────────────

  /**
   * Add an item to the back of the queue.  O(1)
   * @param {*} item
   */
  enqueue(item) {
    this._items[this._tail] = item;
    this._tail++;
  }

  /**
   * Remove and return the item at the front of the queue.  O(1)
   * Returns undefined if the queue is empty.
   * @returns {*}
   */
  dequeue() {
    if (this.isEmpty()) return undefined;
    const item = this._items[this._head];
    delete this._items[this._head]; // free memory
    this._head++;
    return item;
  }

  /**
   * Look at the front item WITHOUT removing it.  O(1)
   * @returns {*}
   */
  peek() {
    return this._items[this._head];
  }

  /**
   * Check if the queue has no elements.  O(1)
   * @returns {boolean}
   */
  isEmpty() {
    return this._head === this._tail;
  }

  // ── Utility ────────────────────────────────────────────────────────────────

  /**
   * Number of elements currently in the queue.  O(1)
   * @type {number}
   */
  get size() {
    return this._tail - this._head;
  }

  /**
   * Reset the queue back to empty state.
   */
  clear() {
    this._items = {};
    this._head = 0;
    this._tail = 0;
  }

  /**
   * Human-readable representation for logging.
   * @returns {string}
   */
  toString() {
    return `Queue(size=${this.size}, front=${JSON.stringify(this.peek())})`;
  }
}

module.exports = Queue;
