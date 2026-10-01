import OpenAI from 'openai'
import knowledgeBase from './video-editing-kb.json'

const EMBEDDING_MODEL = process.env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-small'
const STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'can', 'do', 'for', 'from',
  'how', 'i', 'in', 'is', 'it', 'me', 'my', 'of', 'on', 'or', 'that', 'the',
  'this', 'to', 'what', 'when', 'where', 'which', 'who', 'with', 'you', 'your'
])

let knowledgeCache = null

const normalizeText = (value) => String(value || '').toLowerCase().replace(/\s+/g, ' ').trim()

const tokenize = (value) => normalizeText(value)
  .match(/[a-z0-9]+/g)
  ?.filter((word) => word.length > 1 && !STOP_WORDS.has(word)) || []

const cosineSimilarity = (left, right) => {
  if (!left || !right || left.length !== right.length) return 0
  let dot = 0
  let leftLength = 0
  let rightLength = 0
  for (let index = 0; index < left.length; index += 1) {
    dot += left[index] * right[index]
    leftLength += left[index] * left[index]
    rightLength += right[index] * right[index]
  }
  if (!leftLength || !rightLength) return 0
  return dot / (Math.sqrt(leftLength) * Math.sqrt(rightLength))
}

const lexicalRank = (query, chunks) => {
  const queryTokens = tokenize(query)
  const queryCounts = queryTokens.reduce((counts, token) => {
    counts[token] = (counts[token] || 0) + 1
    return counts
  }, {})
  const documentFrequency = {}
  const tokenizedChunks = chunks.map((chunk) => {
    const tokens = tokenize(`${chunk.title} ${chunk.content}`)
    const counts = {}
    for (const token of tokens) {
      counts[token] = (counts[token] || 0) + 1
      documentFrequency[token] = (documentFrequency[token] || 0) + 1
    }
    return { chunk, tokens, counts }
  })

  return tokenizedChunks.map(({ chunk, tokens, counts }) => {
    let score = 0
    let matches = 0
    for (const [token, queryCount] of Object.entries(queryCounts)) {
      const frequency = counts[token] || 0
      if (!frequency) continue
      matches += 1
      const inverseFrequency = Math.log(1 + (chunks.length - (documentFrequency[token] || 0) + 0.5) / ((documentFrequency[token] || 0) + 0.5))
      score += inverseFrequency * (1 + Math.log(frequency)) * queryCount
    }
    const title = normalizeText(chunk.title)
    if (normalizeText(query) && normalizeText(query).split(' ').some((word) => word && title.includes(word))) score += 2
    score += Math.min(matches, 5) * 0.15
    return { chunk, score }
  })
    .filter(({ score }) => score > 0)
    .sort((left, right) => right.score - left.score || left.chunk.title.localeCompare(right.chunk.title))
}

const snippetFor = (content, query) => {
  const normalizedContent = normalizeText(content)
  const normalizedQuery = normalizeText(query)
  const queryWords = tokenize(query)
  const words = tokenize(content)
  const index = queryWords.findIndex((word) => words.includes(word))
  if (index < 0) return content.slice(0, 150)
  const start = Math.max(0, index - 5)
  const end = Math.min(words.length, index + 14)
  const snippet = words.slice(start, end).join(' ')
  return `${snippet}${end < words.length ? '...' : ''}`
}

const loadKnowledgeBase = async () => {
  if (knowledgeCache) return knowledgeCache
  const chunks = Array.isArray(knowledgeBase.chunks) ? knowledgeBase.chunks : []
  const apiKey = process.env.OPENAI_API_KEY
  let embeddings = null
  let mode = 'lexical'

  if (apiKey && chunks.length) {
    try {
      const client = new OpenAI({ apiKey })
      const responses = await Promise.all(chunks.map((chunk) => client.embeddings.create({
        model: EMBEDDING_MODEL,
        input: chunk.content
      })))
      embeddings = responses.map((response) => response.data?.[0]?.embedding).filter(Boolean)
      if (embeddings.length === chunks.length) mode = 'embeddings'
      else embeddings = null
    } catch {
      embeddings = null
      mode = 'lexical'
    }
  }

  knowledgeCache = Promise.resolve({ chunks, embeddings, mode })
  return knowledgeCache
}

export function getKnowledgeBaseInfo() {
  return {
    chunkCount: Array.isArray(knowledgeBase.chunks) ? knowledgeBase.chunks.length : 0,
    embeddingModel: EMBEDDING_MODEL,
    mode: knowledgeCache ? 'initialized' : 'ready'
  }
}

export async function retrieveContext(query, topK = 3) {
  const cleanedQuery = normalizeText(query)
  if (!cleanedQuery) return { context: '', sources: [], mode: 'lexical' }

  const { chunks, embeddings, mode } = await loadKnowledgeBase()
  if (!chunks.length) return { context: '', sources: [], mode }

  let ranked
  if (mode === 'embeddings' && embeddings) {
    try {
      const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
      const response = await client.embeddings.create({ model: EMBEDDING_MODEL, input: cleanedQuery })
      const queryEmbedding = response.data?.[0]?.embedding
      ranked = chunks.map((chunk, index) => ({
        chunk,
        score: cosineSimilarity(queryEmbedding, embeddings[index])
      }))
        .filter(({ score }) => score > 0.12)
        .sort((left, right) => right.score - left.score || left.chunk.title.localeCompare(right.chunk.title))
    } catch {
      ranked = lexicalRank(cleanedQuery, chunks)
    }
  } else {
    ranked = lexicalRank(cleanedQuery, chunks)
  }

  const limit = Math.max(1, Math.min(8, Number(topK) || 3))
  const selected = ranked.slice(0, limit)
  const sources = selected.map(({ chunk, score }) => ({
    id: chunk.id,
    title: chunk.title,
    tags: Array.isArray(chunk.tags) ? chunk.tags : [],
    snippet: snippetFor(chunk.content, cleanedQuery),
    score: Number(score.toFixed(4))
  }))
  const context = selected.map(({ chunk }) => `${chunk.title}:\n${chunk.content}`).join('\n\n---\n\n')
  return { context, sources, mode }
}
