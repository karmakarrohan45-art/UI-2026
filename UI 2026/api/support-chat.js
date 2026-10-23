const max = Math.max

const PRESETS = [
  {
    id: 1,
    name: 'CHEWY Text Animation',
    type: 'DaVinci Resolve',
    category: 'LUTs',
    tone: 'Warm',
    price: 18,
    color: '#e9d3b2',
    video: '/okki2.mov',
  },
  {
    id: 2,
    name: 'Coastal Haze',
    type: 'DaVinci Resolve',
    category: 'Courses',
    tone: 'Cool',
    price: 24,
    image: 'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=900&q=85',
    color: '#c8d8d8',
  },
  {
    id: 3,
    name: 'After Hours',
    type: 'Mobile',
    category: '1:1 session',
    tone: 'Moody',
    price: 16,
    image: 'https://images.unsplash.com/photo-1519501025264-65ba15a82390?auto=format&fit=crop&w=900&q=85',
    color: '#b9aab1',
  },
  {
    id: 4,
    name: 'Quiet Bloom',
    type: 'DaVinci Resolve',
    category: 'Courses',
    tone: 'Soft',
    price: 20,
    image: 'https://images.unsplash.com/photo-1490750967868-88aa4486c946?auto=format&fit=crop&w=900&q=85',
    color: '#e8c3ba',
  },
]

const SUPPORT_SYSTEM_PROMPT =
  'You are the helpful support assistant for Gene Academy, a digital storefront for video-editing LUTs, courses, and 1:1 sessions. ' +
  'Answer concisely and warmly. Help with product discovery, purchases, account access, and digital delivery. ' +
  'All prices are in Indian Rupees (INR). State amounts as \u20b9 followed by the number, for example \u20b918. ' +
  "Never invent order status, pricing, refund policies, or account details. If information is unavailable, say so and suggest contacting the team. " +
  'If a user asks for help or support, provide our contact number: 6289821372 and encourage them to call or message us.'

const RAG_SYSTEM_INSTRUCTION =
  'Use the retrieved knowledge below as the primary source for product, delivery, checkout, and support facts. ' +
  'Do not invent facts that are not present in the retrieved knowledge. ' +
  'When the retrieved knowledge states a price, quote that exact price and currency from the source instead of saying it is unavailable. ' +
  'Only say information is unavailable when the retrieved knowledge truly does not contain it. ' +
  'When a retrieved source answers part of the question, mention its title in brackets. ' +
  'If the retrieved knowledge is empty or does not contain enough information, say that clearly and suggest contacting the team.'

const STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'can', 'do', 'for', 'from',
  'how', 'i', 'in', 'is', 'it', 'me', 'my', 'of', 'on', 'or', 'that', 'the',
  'this', 'to', 'what', 'when', 'where', 'which', 'who', 'with', 'you', 'your',
])

const normalizeText = (value) => String(value || '').toLowerCase().replace(/\s+/g, ' ').trim()

const tokenize = (value) => {
  const words = normalizeText(value).match(/[a-z0-9]+/g) || []
  return words.filter((word) => word.length > 1 && !STOP_WORDS.has(word))
}

const buildKnowledgeDocuments = (presets) => {
  const docs = [
    {
      id: 'store-overview',
      title: 'Gene Academy store',
      source: 'Storefront knowledge',
      content:
        'Gene Academy is a digital storefront for video-editing LUTs, courses, and 1:1 sessions. ' +
        'The catalog includes DaVinci Resolve, Mobile, Course, and Motion Graphics items. ' +
        'Use the catalog details when helping a customer choose a product.',
    },
    {
      id: 'digital-delivery',
      title: 'Digital delivery',
      source: 'Storefront knowledge',
      content:
        'The products are digital. The checkout form saves an email address for delivery. ' +
        'After a confirmed payment, download links are sent to the saved email address. ' +
        'Do not claim a refund policy or an order status that is not available.',
    },
    {
      id: 'support-contact',
      title: 'Support contact',
      source: 'Storefront knowledge',
      content: 'For immediate help with an order, account, or product, call or message 6289821372.',
    },
    {
      id: 'account-access',
      title: 'Account access',
      source: 'Storefront knowledge',
      content:
        'The storefront provides Google sign-in and email sign-in fields. ' +
        'If a customer cannot access an account, ask them to verify the email they used and contact support.',
    },
    {
      id: 'checkout',
      title: 'Checkout and payment',
      source: 'Storefront knowledge',
      content:
        'Checkout uses Razorpay when the backend payment credentials are configured. ' +
        'If the backend reports that payment is unavailable, tell the customer to try again or contact support.',
    },
  ]

  for (const preset of presets) {
    const name = String(preset.name || 'Untitled product').trim()
    if (!name) continue
    const productType = String(preset.type || '').trim()
    const category = String(preset.category || '').trim()
    const tone = String(preset.tone || '').trim()
    const price = preset.price
    const details = [`${name} is listed in the Gene Academy catalog.`]
    if (productType) details.push(`It is a ${productType} item.`)
    if (category) details.push(`It belongs to the ${category} category.`)
    if (tone) details.push(`Its tone is ${tone}.`)
    if (price !== undefined) details.push(`The catalog price is \u20b9${price}.`)
    docs.push({
      id: `preset-${preset.id}`,
      title: name,
      source: 'Product catalog',
      content: details.join(' '),
    })
  }

  return docs
}

const knowledgeDocuments = buildKnowledgeDocuments(PRESETS)

const TOP_K = 4
const MIN_SCORE = 0.08

const snippetFor = (content, query) => {
  const queryWords = tokenize(query)
  if (!queryWords.length) return content.slice(0, 150)

  const lowered = content.toLowerCase()
  let matchIndex = null
  for (const word of queryWords) {
    const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const found = lowered.search(new RegExp('\\b' + escaped + '\\b', 'i'))
    if (found >= 0 && (matchIndex === null || found < matchIndex)) matchIndex = found
  }
  if (matchIndex === null) return content.slice(0, 150)

  const start = Math.max(0, matchIndex - 80)
  const end = Math.min(content.length, matchIndex + 280)
  let windowStr = content.slice(start, end)

  if (end < content.length) {
    const boundary = Math.max(windowStr.lastIndexOf('. '), windowStr.lastIndexOf('.\n'))
    if (boundary > 0) {
      windowStr = windowStr.slice(0, boundary + 1)
    }
  }

  const prefix = start > 0 ? '...' : ''
  const suffix = end < content.length ? '...' : ''
  return prefix + windowStr.trim() + suffix
}

const searchKnowledge = (query, documents) => {
  const queryTokens = tokenize(query)
  if (!queryTokens.length) return []

  const docTokens = documents.map((doc) => tokenize(doc.content + ' ' + doc.title))
  const docLengths = docTokens.map((t) => t.length)

  const totalDocs = documents.length
  const avgLength = docLengths.reduce((a, b) => a + b, 0) / max(1, totalDocs)

  const documentFrequency = {}
  for (const tokens of docTokens) {
    for (const term of new Set(tokens)) {
      documentFrequency[term] = (documentFrequency[term] || 0) + 1
    }
  }

  const queryCounts = {}
  for (const token of queryTokens) {
    queryCounts[token] = (queryCounts[token] || 0) + 1
  }

  const scored = documents.map((doc, index) => {
    const tokens = docTokens[index]
    const counts = {}
    for (const token of tokens) {
      counts[token] = (counts[token] || 0) + 1
    }

    let score = 0
    let matched = 0
    for (const [term, queryCount] of Object.entries(queryCounts)) {
      const freq = counts[term] || 0
      if (!freq) continue
      matched += 1
      const idf = Math.log(1 + (totalDocs - (documentFrequency[term] || 0) + 0.5) / ((documentFrequency[term] || 0) + 0.5))
      const lengthRatio = docLengths[index] / max(1, avgLength)
      const denom = freq + 1.2 * (1 - 0.75 + 0.75 * lengthRatio)
      score += idf * (freq * 1.2 + freq) / denom * queryCount
    }

    const title = normalizeText(doc.title)
    const normQuery = normalizeText(query)
    if (normQuery && title.includes(normQuery)) {
      score += 4
    } else {
      const queryWords = normQuery.split(' ')
      if (queryWords.some((word) => word && title.includes(word))) score += 1.5
    }
    if (matched) score += Math.min(matched, 4) * 0.08

    return { score, doc, index }
  })

  return scored
    .filter(({ score }) => score >= MIN_SCORE)
    .sort((a, b) => b.score - a.score || documents[a.index].title.localeCompare(documents[b.index].title))
    .slice(0, max(1, TOP_K))
    .map(({ doc, index, score }) => ({
      id: doc.id,
      title: doc.title,
      source: doc.source,
      url: doc.url || '',
      snippet: snippetFor(doc.content, query),
      score: Math.round(score * 10000) / 10000,
    }))
}

const formatRetrievedContext = (results) => {
  if (!results.length) return ''
  return results
    .map((r, i) => `[${i + 1}] ${r.title} (${r.source}): ${r.snippet}\n${r.snippet}`)
    .join('\n\n---\n\n')
}

const formatSources = (results) => {
  return results.map((r) => ({
    id: r.id,
    title: r.title,
    source: r.source,
    url: r.url || '',
    snippet: r.snippet,
  }))
}

const GROQ_CHAT_URL = 'https://api.groq.com/openai/v1/chat/completions'
const GROQ_MODEL = process.env.GROQ_MODEL || 'openai/gpt-oss-120b'
const GROQ_USER_AGENT =
  process.env.GROQ_USER_AGENT ||
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed. Use POST.' })
  }

  let body
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body
  } catch {
    return res.status(400).json({ message: 'Invalid JSON body.' })
  }

  const rawMessages = body?.messages
  if (!Array.isArray(rawMessages)) {
    return res.status(400).json({ message: 'Messages must be a list.' })
  }

  const messages = []
  for (const item of rawMessages.slice(-12)) {
    if (typeof item !== 'object' || item === null) continue
    const role = item.role
    const content = item.content
    if ((role !== 'user' && role !== 'assistant') || typeof content !== 'string') continue
    const stripped = content.trim()
    if (stripped) messages.push({ role, content: stripped.slice(0, 2000) })
  }

  if (!messages.length || messages[messages.length - 1].role !== 'user') {
    return res.status(400).json({ message: 'Send a support question to start the chat.' })
  }

  const apiKey = (process.env.GROQ_API_KEY || '').trim()
  if (!apiKey || apiKey === 'your_groq_api_key_here') {
    return res.status(503).json({
      message: 'AI support is not configured. Add GROQ_API_KEY to the backend environment and restart the server.',
    })
  }

  const query = messages[messages.length - 1].content
  const retrieved = searchKnowledge(query, knowledgeDocuments)
  const context = retrieved.length ? formatRetrievedContext(retrieved) : ''

  const systemPrompt = context
    ? `${SUPPORT_SYSTEM_PROMPT}\n\n${RAG_SYSTEM_INSTRUCTION}\n\nRetrieved knowledge:\n${context}`
    : SUPPORT_SYSTEM_PROMPT

  try {
    const groqResponse = await fetch(GROQ_CHAT_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'User-Agent': GROQ_USER_AGENT,
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        messages: [{ role: 'system', content: systemPrompt }, ...messages],
        max_tokens: 800,
        temperature: 0.4,
      }),
    })

    if (!groqResponse.ok) {
      const errorText = await groqResponse.text()
      console.error(`Groq API error ${groqResponse.status}: ${errorText.slice(0, 500)}`)
      return res.status(502).json({
        message: 'The Groq support service could not complete this request. Please try again shortly.',
      })
    }

    const result = await groqResponse.json()
    let reply = result.choices?.[0]?.message?.content || ''

    if (typeof reply === 'number') reply = ''
    if (Array.isArray(reply)) {
      reply = reply.map((part) => (typeof part === 'object' && part !== null ? part.text || '' : '')).join('')
    }

    if (typeof reply !== 'string' || !reply.trim()) {
      return res.status(502).json({
        message: 'The Groq support service is temporarily unavailable. Please try again shortly.',
      })
    }

    return res.status(200).json({
      message: reply.trim(),
      sources: formatSources(retrieved),
      rag: {
        enabled: Boolean(context),
        retrieved: retrieved.length,
        top_k: TOP_K,
      },
    })
  } catch (error) {
    if (error.name === 'TypeError' && /fetch|network/i.test(error.message)) {
      return res.status(502).json({
        message: 'The Groq support service is temporarily unavailable. Please try again shortly.',
      })
    }
    console.error('Support chat error:', error)
    return res.status(500).json({ message: 'The edit bot ran into a problem.' })
  }
}
