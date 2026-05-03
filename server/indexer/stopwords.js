/**
 * stopwords.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Configurable set of English stopwords for the tokenizer pipeline.
 *
 * Design: JavaScript Set for O(1) average-case lookup.
 * To customise: add/remove strings from the array below.
 */

const STOPWORDS = new Set([
  // Articles & determiners
  "a", "an", "the",
  // Conjunctions
  "and", "or", "but", "nor", "so", "yet", "both", "either", "neither",
  // Prepositions
  "in", "on", "at", "to", "for", "of", "with", "by", "from", "into",
  "onto", "upon", "over", "under", "above", "below", "between", "among",
  "through", "during", "before", "after", "since", "until", "within",
  "without", "against", "along", "around", "behind", "beneath", "beside",
  "beyond", "except", "inside", "near", "off", "outside", "past",
  "throughout",
  // Auxiliary verbs
  "is", "are", "was", "were", "be", "been", "being",
  "have", "has", "had", "do", "does", "did",
  "will", "would", "could", "should", "may", "might", "must", "shall",
  "can", "cannot", "need", "dare", "ought",
  // Pronouns
  "i", "me", "my", "myself", "we", "our", "ours", "ourselves",
  "you", "your", "yours", "yourself", "yourselves",
  "he", "him", "his", "himself", "she", "her", "hers", "herself",
  "it", "its", "itself", "they", "them", "their", "theirs", "themselves",
  // Demonstratives & relatives
  "this", "that", "these", "those", "what", "which", "who", "whom",
  "whose", "where", "when", "why", "how",
  // Common adverbs / fillers
  "not", "no", "nor", "also", "just", "only", "even", "very", "too",
  "more", "most", "other", "some", "such", "than", "then", "as", "if",
  "each", "few", "about", "here", "there", "now", "up", "via",
  "well", "back", "still", "again", "already", "always", "never",
  "often", "once", "quite", "rather", "really", "simply", "then",
  "therefore", "though", "although", "while", "because",
]);

module.exports = { STOPWORDS };
