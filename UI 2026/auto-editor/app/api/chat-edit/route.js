import { mkdir, readFile, writeFile, unlink } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import OpenAI from 'openai'
import { retrieveContext, getKnowledgeBaseInfo } from '../../../lib/embeddings'

export const runtime = 'nodejs'
export const maxDuration = 300

/*
 * Edit plan schema the LLM must return:
 * {
 *   trimSeconds: 0-120 | null,
 *   speed: number multiplier (0.25 - 4) | null,
 *   mute: boolean,
 *   filters: string[]   // valid ffmpeg video filters, chained with commas
 *   labels: string[]    // short human-readable summary of each change
 * }
 */

const PLAN_SCHEMA_HINT = `Return ONLY JSON, no markdown:
{
  "trimSeconds": <integer seconds 1-120 or null>,
  "speed": <multiplier like 0.5 for slow-mo or 2 for 2x, or null>,
  "mute": <true if audio should be removed>,
  "filters": [<ffmpeg video filter strings, e.g. "eq=contrast=1.18:saturation=1.05", "vignette", "hue=s=0", "fade=t=in:st=0:d=0.8,fade=t=out:st=2:d=0.8", "colorbalance=rs=0.12:bs=-0.1", "unsharp=5:5:0.7", "gblur=sigma=2", "boxblur=2:1", "hflip", "vflip", "transpose=1", "curves=vintage", "noise=alls=8:allf=t", "scale=iw*1.15:-1,crop=iw/1.15:ih/1.15", "crop=ih*9/16:ih">],
  "labels": [<short human descriptions like "cinematic grade", "slow motion">],
  "actions": [<special actions: "transcribe", "captions:karaoke", "captions:tiktok", "captions:cinematic", "captions:minimal", "auto-cut", "burn-captions">]
}`

const FFMPEG_SYSTEM_PROMPT = `You are a video edit planner for an ffmpeg-based auto editor. Convert the user's creative description into an edit plan.
${PLAN_SCHEMA_HINT}
Rules: keep filters valid ffmpeg syntax; vertical 9:16 is crop=ih*9/16:ih; combine multiple looks into the filters array; never invent filters you are unsure of; if the user asks for nothing specific, return empty arrays.`

const RAG_INSTRUCTION = `Use the retrieved video-editing reference knowledge when it is relevant. Treat it as guidance, not as a substitute for the user's request. Do not invent ffmpeg filters or claim capabilities that are not in the reference.`

const isSafeFilterChain = (filters) => filters.every((f) => /^[a-zA-Z0-9_=:.*/,+\-\s]+$/.test(f) && !/(sh|`|\$\{|&&|\|\||;)/.test(f))

const planFromLlm = async (prompts) => {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) return null
  try {
    const openai = new OpenAI({ apiKey })
    const query = prompts.join(' ')
    let ragContext = ''
    let ragSources = []
    let ragMode = 'unavailable'
    try {
      const retrieval = await retrieveContext(query, 3)
      ragContext = retrieval.context || ''
      ragSources = retrieval.sources || []
      ragMode = retrieval.mode || 'lexical'
    } catch {
      ragContext = ''
      ragSources = []
      ragMode = 'fallback'
    }

    const systemPrompt = `${FFMPEG_SYSTEM_PROMPT}\n\n${RAG_INSTRUCTION}${ragContext ? `\n\nReference knowledge:\n${ragContext}` : ''}`
    const completion = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      response_format: { type: 'json_object' },
      temperature: 0.2,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: prompts.join('\n') }
      ]
    })
    const plan = JSON.parse(completion.choices[0]?.message?.content || '{}')
    if (!Array.isArray(plan.filters) || !isSafeFilterChain(plan.filters.map(String))) return null
    return {
      filters: plan.filters.map(String).filter(Boolean),
      labels: Array.isArray(plan.labels) ? plan.labels.map(String).slice(0, 12) : [],
      actions: Array.isArray(plan.actions) ? plan.actions.map(String).filter(Boolean) : [],
      options: {
        speed: Number.isFinite(Number(plan.speed)) && plan.speed ? Number(plan.speed) : null,
        mute: !!plan.mute,
        trimSeconds: Number.isInteger(plan.trimSeconds) ? Math.min(120, Math.max(1, plan.trimSeconds)) : null
      },
      planner: 'ai',
      rag: {
        enabled: Boolean(ragContext),
        mode: ragMode,
        sources: ragSources
      }
    }
  } catch {
    return null // fall back to keyword parsing on any LLM/network error
  }
}

/**
 * Turns the user's creative prompts into ffmpeg edit instructions.
 * Each match adds a video filter and/or an audio/clip option,
 * plus a short human-readable summary of what was applied.
 */
const PROMPT_RULES = [
  { test: /black\s*(&|and)?\s*white|b\s*&\s*w|monochrome|grayscale/i, filter: 'hue=s=0', label: 'black & white grade' },
  { test: /vintage|retro|vhs|old\s*(school|film)|90s|80s/i, filter: 'curves=vintage,noise=alls=8:allf=t', label: 'vintage film look' },
  { test: /vibrant|colorful|saturat|punchy|pop/i, filter: 'eq=saturation=1.4:contrast=1.1', label: 'vibrant colors' },
  { test: /cinematic|movie|film\s*look/i, filter: 'eq=contrast=1.18:saturation=1.05,vignette', label: 'cinematic grade with vignette' },
  { test: /moody|dark|gloom|shadow/i, filter: 'eq=brightness=-0.06:contrast=1.15:saturation=0.85', label: 'moody dark tone' },
  { test: /bright|sunny|light(er)?\b|lift/i, filter: 'eq=brightness=0.06:saturation=1.1', label: 'brighter exposure' },
  { test: /warm|golden|cozy|sunset/i, filter: 'colorbalance=rs=0.12:gs=0.04:bs=-0.1', label: 'warm golden tone' },
  { test: /cool|cold|blue|icy|winter/i, filter: 'colorbalance=rs=-0.1:bs=0.12', label: 'cool blue tone' },
  { test: /sharp|crisp|detail/i, filter: 'unsharp=5:5:0.7', label: 'sharpened details' },
  { test: /soft|dreamy|glow|hazy/i, filter: 'gblur=sigma=0.6,eq=saturation=1.05', label: 'soft dreamy glow' },
  { test: /slow\s*(mo|motion|down)?|slower/i, speed: 0.5, label: 'slow motion (2x slower)' },
  { test: /\bfast(er)?\b|speed\s*up|timelapse|hyper\s*lapse/i, speed: 2, label: 'sped up (2x faster)' },
  { test: /zoom\s*in|closer/i, filter: 'scale=iw*1.15:-1,crop=iw/1.15:ih/1.15', label: 'zoom in' },
  { test: /\bzoom\s*out|wide(r)?\b/i, filter: 'scale=iw*0.9:-1,pad=iw*1.11:ih*1.11:(ow-iw)/2:(oh-ih)/2', label: 'zoom out with padding' },
  { test: /mirror|flip\s*horizontal/i, filter: 'hflip', label: 'horizontal mirror flip' },
  { test: /flip\s*vertical|upside\s*down/i, filter: 'vflip', label: 'vertical flip' },
  { test: /rotate/i, filter: 'transpose=1', label: 'rotated 90°', once: true },
  { test: /fade/i, filter: 'fade=t=in:st=0:d=0.8,fade=t=out:st=2:d=0.8', label: 'fade in/out' },
  { test: /blur/i, filter: 'boxblur=2:1', label: 'blurred look' },
  { test: /sepia|brown(ish)?\s*tone/i, filter: 'hue=s=0.4,colorbalance=rs=0.15:gs=0.05:bs=-0.15', label: 'sepia tone' },
  { test: /\bmute\b|no\s*(audio|sound)|silent/i, mute: true, label: 'muted audio' },
  { test: /transcribe|speech.to.text|caption|subtitle|lyrics/i, filter: null, label: 'transcribe audio for captions', action: 'transcribe' },
  { test: /karaoke|highlight\s*word|word.by.word/i, filter: null, label: 'karaoke style captions', action: 'captions:karaoke' },
  { test: /tiktok\s*caption|reel\s*caption|animated\s*caption/i, filter: null, label: 'tiktok style captions', action: 'captions:tiktok' },
  { test: /cinematic\s*caption|elegant\s*caption/i, filter: null, label: 'cinematic captions', action: 'captions:cinematic' },
  { test: /minimal\s*caption|clean\s*caption/i, filter: null, label: 'minimal captions', action: 'captions:minimal' },
  { test: /remove\s*pause|cut\s*silence|auto.cut|trim\s*silence/i, filter: null, label: 'remove pauses', action: 'auto-cut' },
  { test: /burn\s*caption|hardcode\s*caption|embed\s*caption/i, filter: null, label: 'burn captions into video', action: 'burn-captions' }
]

const parsePrompts = (prompts) => {
  const text = prompts.join(' ')
  const filters = []
  const labels = []
  const actions = []
  const options = { speed: null, mute: false, trimSeconds: null }

  for (const rule of PROMPT_RULES) {
    if (!rule.test.test(text)) continue
    if (rule.filter && !filters.includes(rule.filter)) filters.push(rule.filter)
    if (rule.speed) options.speed = options.speed ? options.speed * rule.speed : rule.speed
    if (rule.mute) options.mute = true
    if (rule.action && !actions.includes(rule.action)) actions.push(rule.action)
    labels.push(rule.label)
  }

  const trimMatch = text.match(/(?:trim|cut|first|only)\s*(?:to|at)?\s*(\d{1,3})\s*(?:s|sec|secs|seconds)?/i)
    || text.match(/(\d{1,3})\s*(?:s|sec|secs|seconds)\b/i)
  if (trimMatch) {
    options.trimSeconds = Math.min(120, parseInt(trimMatch[1], 10))
    labels.push(`trimmed to first ${options.trimSeconds}s`)
  }

  if (options.speed) filters.unshift(`setpts=${1 / options.speed}*PTS`)

  return { filters, labels, options, actions, planner: 'keywords' }
}

const runFfmpeg = (args) => new Promise((resolve, reject) => {
  const child = spawn('ffmpeg', args, { windowsHide: true })
  let stderr = ''
  child.stderr.on('data', (chunk) => { stderr += chunk })
  child.on('error', reject)
  child.on('close', (code) => code === 0 ? resolve() : reject(new Error(stderr.slice(-400) || `ffmpeg exited with ${code}`)))
})

const FFMPEG_PATH = process.env.FFMPEG_PATH || 'ffmpeg'

/**
 * Converts an absolute path inside public/ into a browser URL.
 * path.relative keeps this correct on Windows, where cwd uses backslashes.
 */
const toPublicUrl = (absolutePath) => {
  const publicDir = path.join(process.cwd(), 'public')
  const relative = path.relative(publicDir, absolutePath)
  if (!relative || relative.startsWith('..')) return null
  return `/${relative.split(path.sep).join('/')}`
}

const runFfmpegCommand = (args, timeoutMs = 300000) => new Promise((resolve, reject) => {
  let child
  try {
    child = spawn(FFMPEG_PATH, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
  } catch (error) {
    reject(error)
    return
  }

  let stdout = ''
  let stderr = ''
  let settled = false
  const timer = setTimeout(() => {
    if (settled) return
    settled = true
    child.kill()
    reject(new Error(`ffmpeg timed out`))
  }, timeoutMs)

  const collect = (target, chunk) => {
    const text = chunk.toString()
    target += text
    return target.length > 20000 ? text.slice(-20000) : target
  }

  child.stdout.on('data', (chunk) => { stdout = collect(stdout, chunk) })
  child.stderr.on('data', (chunk) => { stderr = collect(stderr, chunk) })
  child.on('error', (error) => {
    if (settled) return
    settled = true
    clearTimeout(timer)
    reject(error)
  })
  child.on('close', (code) => {
    if (settled) return
    settled = true
    clearTimeout(timer)
    if (code === 0) {
      resolve({ stdout, stderr })
    } else {
      reject(new Error(stderr.slice(-800) || `ffmpeg exited with ${code}`))
    }
  })
})

const extractAudio = async (inputPath, outputPath) => {
  await runFfmpegCommand([
    '-y', '-i', inputPath,
    '-vn', '-acodec', 'libmp3lame', '-ar', '16000', '-ac', '1',
    '-f', 'mp3', outputPath
  ], 120000)
}

const transcribeWithWhisper = async (audioPath, language = 'en') => {
  const apiKey = (process.env.OPENAI_API_KEY || '').trim()
  if (!apiKey || apiKey === 'your_openai_api_key_here') {
    throw new Error('OPENAI_API_KEY not configured')
  }

  // Node's fetch does not support file:// URLs, so read the audio into a Blob.
  const audioFile = new Blob([await readFile(audioPath)], { type: 'audio/mpeg' })

  const formData = new FormData()
  formData.append('file', audioFile, 'audio.mp3')
  formData.append('model', 'whisper-1')
  formData.append('response_format', 'verbose_json')
  formData.append('language', language)

  const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}` },
    body: formData
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Whisper API error: ${error}`)
  }

  return response.json()
}

const formatSRT = (segments) => {
  return segments.map((seg, index) => {
    const start = formatTimeSRT(seg.start)
    const end = formatTimeSRT(seg.end)
    return `${index + 1}\n${start} --> ${end}\n${seg.text.trim()}\n`
  }).join('\n')
}

const formatTimeSRT = (seconds) => {
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const secs = Math.floor(seconds % 60)
  const ms = Math.floor((seconds % 1) * 1000)
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')},${String(ms).padStart(3, '0')}`
}

const formatASS = (segments, style = 'default') => {
  const styles = {
    default: 'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Default,Arial,48,&H00FFFFFF,&H000000FF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,2,2,2,10,10,10,1',
    karaoke: 'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Karaoke,Arial,52,&H00FFFFFF,&H0000FFFF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,3,2,2,10,10,10,1',
    wordByWord: 'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: WordByWord,Arial,56,&H00FFFFFF,&H0000FFFF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,3,2,2,10,10,10,1',
    tiktok: 'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: TikTok,Montserrat,60,&H00FFFFFF,&H0000FFFF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,4,3,2,10,10,10,1',
    cinematic: 'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Cinematic,Cinzel,50,&H00FFFFFF,&H00FFD700,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,2,3,2,10,10,10,1',
    minimal: 'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Minimal,Helvetica,44,&H00FFFFFF,&H00000000,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,1,0,2,10,10,10,1'
  }

  const header = `[Script Info]\nTitle: Auto-generated captions\nScriptType: v4.00+\nWrapStyle: 0\nScaledBorderAndShadow: yes\nYCbCr Matrix: TV.709\nPlayResX: 1080\nPlayResY: 1920\n\n[V4+ Styles]\n${styles[style] || styles.default}\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text`

  const events = segments.map((seg) => {
    const start = formatTimeASS(seg.start)
    const end = formatTimeASS(seg.end)
    const text = seg.text.trim().replace(/\n/g, '\\N')
    return `Dialogue: 0,${start},${end},${style.charAt(0).toUpperCase() + style.slice(1)},,0,0,0,,${text}`
  }).join('\n')

  return `${header}\n${events}`
}

const formatTimeASS = (seconds) => {
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const secs = seconds % 60
  return `${hours}:${String(minutes).padStart(2, '0')}:${secs.toFixed(2).padStart(5, '0')}`
}

const burnCaptions = async (inputPath, outputPath, captionPath, captionStyle = 'default') => {
  const styleFilters = {
    default: "subtitles='${captionPath}'",
    karaoke: "subtitles='${captionPath}:force_style=Fontsize=52,Outline=3,Shadow=2'",
    wordByWord: "subtitles='${captionPath}:force_style=Fontsize=56,Outline=3,Shadow=2'",
    tiktok: "subtitles='${captionPath}:force_style=Fontname=Montserrat,Fontsize=60,Outline=4,Shadow=3,Alignment=2'",
    cinematic: "subtitles='${captionPath}:force_style=Fontname=Cinzel,Fontsize=50,Outline=2,Shadow=3,Alignment=2'",
    minimal: "subtitles='${captionPath}:force_style=Fontname=Helvetica,Fontsize=44,Outline=1,Shadow=0,Alignment=2'"
  }

  const filter = styleFilters[captionStyle] || styleFilters.default
  await runFfmpegCommand([
    '-y', '-i', inputPath,
    '-vf', filter.replace('${captionPath}', captionPath.replace(/\\/g, '/').replace(/:/g, '\\:')),
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '22',
    '-c:a', 'copy', '-movflags', '+faststart', outputPath
  ], 300000)
}

const autoCutSilence = async (inputPath, outputPath, styleFilters = '') => {
  const { stdout } = await runFfmpegCommand([
    '-hide_banner', '-i', inputPath,
    '-af', 'silencedetect=noise=-35dB:d=0.5',
    '-f', 'null', '-'
  ])
  
  const silenceIntervals = []
  let silenceStart = null
  for (const line of stdout.split(/\r?\n/)) {
    const startMatch = line.match(/silence_start:\s*([0-9]+(?:\.[0-9]+)?)/)
    const endMatch = line.match(/silence_end:\s*([0-9]+(?:\.[0-9]+)?)/)
    if (startMatch && silenceStart === null) silenceStart = Number(startMatch[1])
    if (endMatch && silenceStart !== null) {
      silenceIntervals.push({ start: silenceStart, end: Number(endMatch[1]) })
      silenceStart = null
    }
  }
  if (silenceStart !== null) silenceIntervals.push({ start: silenceStart, end: 999999 })

  const probe = await runFfmpegCommand([
    '-v', 'error', '-show_entries', 'format=duration', '-of', 'json', inputPath
  ])
  const duration = JSON.parse(probe.stdout).format?.duration || 0

  const keepSegments = []
  let cursor = 0
  for (const interval of silenceIntervals) {
    const silenceStart = Math.min(duration, Math.max(0, interval.start))
    const silenceEnd = Math.min(duration, Math.max(0, interval.end))
    if (silenceStart > cursor + 0.08) {
      keepSegments.push({ start: cursor, end: silenceStart })
    }
    cursor = Math.max(cursor, silenceEnd)
  }
  if (duration > cursor + 0.08) keepSegments.push({ start: cursor, end: duration })
  if (!keepSegments.length && duration > 0) keepSegments.push({ start: 0, end: duration })

  if (keepSegments.length === 1) {
    const segment = keepSegments[0]
    const trimFilter = `trim=start=${segment.start.toFixed(3)}:end=${segment.end.toFixed(3)},setpts=PTS-STARTPTS`
    const vf = styleFilters ? `${trimFilter},${styleFilters}` : trimFilter
    await runFfmpegCommand([
      '-y', '-i', inputPath,
      '-vf', vf,
      '-af', `atrim=start=${segment.start.toFixed(3)}:end=${segment.end.toFixed(3)},asetpts=PTS-STARTPTS,loudnorm=I=-16:TP=-1.5:LRA=11`,
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '22',
      '-c:a', 'aac', '-b:a', '160k',
      '-movflags', '+faststart', outputPath
    ])
  } else {
    const graph = []
    const inputs = []
    keepSegments.forEach((segment, index) => {
      graph.push(`[0:v]trim=start=${segment.start.toFixed(3)}:end=${segment.end.toFixed(3)},setpts=PTS-STARTPTS[v${index}]`)
      graph.push(`[0:a]atrim=start=${segment.start.toFixed(3)}:end=${segment.end.toFixed(3)},asetpts=PTS-STARTPTS[a${index}]`)
      inputs.push(`[v${index}][a${index}]`)
    })
    graph.push(`${inputs.join('')}concat=n=${keepSegments.length}:v=1:a=1[concatenated][concatenatedAudio]`)
    const vf = styleFilters ? `[concatenated]${styleFilters}[outputVideo]` : '[concatenated]copy[outputVideo]'
    graph.push(vf)
    graph.push('[concatenatedAudio]loudnorm=I=-16:TP=-1.5:LRA=11[outputAudio]')
    
    await runFfmpegCommand([
      '-y', '-i', inputPath,
      '-filter_complex', graph.join(';'),
      '-map', '[outputVideo]', '-map', '[outputAudio]',
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '22',
      '-c:a', 'aac', '-b:a', '160k',
      '-movflags', '+faststart', outputPath
    ])
  }
}

export async function POST(request) {
  try {
    const formData = await request.formData()
    const video = formData.get('video')
    const rawPrompts = formData.get('prompts')

    if (!video || typeof video === 'string') {
      return Response.json({ success: false, message: 'No video file received.' }, { status: 400 })
    }
    if (video.size > 200 * 1024 * 1024) {
      return Response.json({ success: false, message: 'File is larger than the 200 MB limit.' }, { status: 413 })
    }

    let prompts = []
    try { prompts = JSON.parse(rawPrompts || '[]') } catch { prompts = [] }
    prompts = prompts.filter((p) => typeof p === 'string' && p.trim())
    if (!prompts.length) {
      return Response.json({
        success: false,
        message: 'Tell the bot what to do in the chat first — for example: "make it cinematic, slow motion, trim to 10 seconds".'
      }, { status: 400 })
    }

    const keywordPlan = parsePrompts(prompts)
    // Prefer the AI planner when an OPENAI_API_KEY is configured; regex rules are the fallback.
    const plan = (await planFromLlm(prompts)) || keywordPlan
    const { filters, labels, options, actions } = plan
    if (!labels.length && !filters.length && (!actions || !actions.length)) {
      return Response.json({
        success: false,
        message: 'I could not find any edit instructions in your prompt. Try words like "cinematic", "black and white", "slow motion", "bright", "vintage", "trim to 15 seconds", "mute", "transcribe", "add captions", "remove pauses".'
      }, { status: 400 })
    }

    const uploadsDir = path.join(process.cwd(), 'public', 'uploads')
    const outputDir = path.join(process.cwd(), 'public', 'edited')
    await mkdir(uploadsDir, { recursive: true })
    await mkdir(outputDir, { recursive: true })

    const id = randomUUID()
    const extension = path.extname(video.name || '') || '.mp4'
    const inputPath = path.join(uploadsDir, `${id}${extension}`)
    const outputPath = path.join(outputDir, `${id}-edited.mp4`)

    await writeFile(inputPath, Buffer.from(await video.arrayBuffer()))

    let currentInputPath = inputPath
    let currentOutputPath = outputPath
    // Tracks the last video actually written, so the returned URL always exists.
    let finalOutputPath = inputPath
    let finalLabels = [...labels]
    let transcript = null
    let segments = null
    let captionedVideoUrl = null
    let srtContent = null
    let assContent = null

    try {
      // Build style filters from the regular filters
      const styleFilters = filters.join(',')

      // Handle special actions in order
      for (const action of actions || []) {
        if (action === 'transcribe') {
          // Extract audio and transcribe
          const audioPath = path.join(uploadsDir, `${id}-audio.mp3`)
          await extractAudio(currentInputPath, audioPath)
          const result = await transcribeWithWhisper(audioPath)
          segments = result.segments || []
          transcript = result.text || segments.map(s => s.text).join(' ')
          srtContent = formatSRT(segments)
          await unlink(audioPath)
          finalLabels.push('transcribed audio')
        } else if (action.startsWith('captions:')) {
          // Generate captions with specific style
          const captionStyle = action.split(':')[1] || 'default'
          if (!segments) {
            // Need to transcribe first
            const audioPath = path.join(uploadsDir, `${id}-audio.mp3`)
            await extractAudio(currentInputPath, audioPath)
            const result = await transcribeWithWhisper(audioPath)
            segments = result.segments || []
            transcript = result.text || segments.map(s => s.text).join(' ')
            await unlink(audioPath)
          }
          const assPath = path.join(uploadsDir, `${id}-captions.ass`)
          assContent = formatASS(segments, captionStyle)
          await writeFile(assPath, assContent)
          srtContent = formatSRT(segments)
          finalLabels.push(`${captionStyle} captions generated`)
        } else if (action === 'auto-cut') {
          // Remove silence/pauses
          const autoCutOutputPath = path.join(outputDir, `${id}-autocut.mp4`)
          await autoCutSilence(currentInputPath, autoCutOutputPath, styleFilters)
          currentInputPath = autoCutOutputPath
          finalOutputPath = autoCutOutputPath
          finalLabels.push('removed pauses')
        } else if (action === 'burn-captions') {
          // Burn captions into video
          if (!segments) {
            const audioPath = path.join(uploadsDir, `${id}-audio.mp3`)
            await extractAudio(currentInputPath, audioPath)
            const result = await transcribeWithWhisper(audioPath)
            segments = result.segments || []
            transcript = result.text || segments.map(s => s.text).join(' ')
            await unlink(audioPath)
          }
          const assPath = path.join(uploadsDir, `${id}-captions.ass`)
          const captionStyle = 'default'
          assContent = formatASS(segments, captionStyle)
          await writeFile(assPath, assContent)
          
          const captionedOutputPath = path.join(outputDir, `${id}-captioned.mp4`)
          await burnCaptions(currentInputPath, captionedOutputPath, assPath, captionStyle)
          currentInputPath = captionedOutputPath
          finalOutputPath = captionedOutputPath
          captionedVideoUrl = `/edited/${id}-captioned.mp4`
          srtContent = formatSRT(segments)
          await unlink(assPath)
          finalLabels.push('burned captions into video')
        }
      }

      // If we have regular filters but no special actions that already produced output, apply filters
      const hasSpecialOutputAction = actions?.some(a => ['auto-cut', 'burn-captions'].includes(a))
      if (filters.length && !hasSpecialOutputAction) {
        const args = ['-y', '-i', currentInputPath]
        if (options.trimSeconds) args.push('-t', String(options.trimSeconds))
        if (filters.length) args.push('-vf', filters.join(','))
        if (options.mute) {
          args.push('-an')
        } else {
          const audioFilters = []
          if (options.speed) audioFilters.push(`atempo=${Math.min(2, Math.max(0.5, options.speed))}`)
          audioFilters.push('loudnorm=I=-16:TP=-1.5:LRA=11')
          args.push('-af', audioFilters.join(','))
        }
        args.push('-c:v', 'libx264', '-preset', 'veryfast', '-crf', '22')
        if (!options.mute) args.push('-c:a', 'aac', '-b:a', '160k')
        args.push('-movflags', '+faststart', currentOutputPath)

        try {
          await runFfmpegCommand(args)
          currentInputPath = currentOutputPath
          finalOutputPath = currentOutputPath
        } catch (error) {
          if (!/ENOENT|spawn/i.test(String(error.message))) throw error
          return Response.json({
            success: true,
            simulated: true,
            output_url: `/uploads/${id}${extension}`,
            reply: `I understood: ${finalLabels.join(', ')}. (Simulated mode — ffmpeg is not installed on this server, so the original clip is returned.)`
          })
        }
      }

      // Determine final output URL from the file that was actually written.
      const finalOutputUrl = toPublicUrl(finalOutputPath)

      return Response.json({
        success: true,
        output_url: finalOutputUrl,
        applied: finalLabels,
        planner: plan.planner,
        transcript,
        segments,
        srt: srtContent,
        ass: assContent,
        reply: `Done! I applied: ${finalLabels.join(', ') || 'your requested look'}. Tweak it with another message or render a new idea.`
      })
    } catch (error) {
      if (!/ENOENT|spawn/i.test(String(error.message))) throw error
      return Response.json({
        success: true,
        simulated: true,
        output_url: `/uploads/${id}${extension}`,
        reply: `I understood: ${finalLabels.join(', ')}. (Simulated mode — ffmpeg is not installed on this server, so the original clip is returned.)`
      })
    }
  } catch (error) {
    return Response.json(
      { success: false, message: error?.message || 'The edit bot ran into a problem.' },
      { status: 500 }
    )
  }
}

export async function GET() {
  const key = (process.env.OPENAI_API_KEY || '').trim()
  const aiConfigured = Boolean(key) && key !== 'your_openai_api_key_here'
  return Response.json({
    success: true,
    planner: aiConfigured ? 'ai' : 'keywords',
    ai_configured: aiConfigured,
    understood_prompts: PROMPT_RULES.map((rule) => rule.label)
  })
}
