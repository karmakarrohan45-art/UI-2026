import { mkdir, readFile, writeFile, unlink } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

export const runtime = 'nodejs'
export const maxDuration = 300

const MAX_FILE_SIZE = 200 * 1024 * 1024
const FFMPEG_PATH = process.env.FFMPEG_PATH || 'ffmpeg'

const runCommand = (command, args, timeoutMs = 300000) => new Promise((resolve, reject) => {
  let child
  try {
    child = spawn(command, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
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
    reject(new Error(`${command} timed out`))
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
      reject(new Error(stderr.slice(-800) || `${command} exited with ${code}`))
    }
  })
})

const runFfmpeg = (args, timeoutMs) => runCommand(FFMPEG_PATH, args, timeoutMs)

const extractAudio = async (inputPath, outputPath) => {
  await runFfmpeg([
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
    tiktok: 'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: TikTok,Montserrat,60,&H00FFFFFF,&H0000FFFF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,4,3,2,10,10,10,1'
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
    tiktok: "subtitles='${captionPath}:force_style=Fontname=Montserrat,Fontsize=60,Outline=4,Shadow=3,Alignment=2'"
  }

  const filter = styleFilters[captionStyle] || styleFilters.default
  await runFfmpeg([
    '-y', '-i', inputPath,
    '-vf', filter.replace('${captionPath}', captionPath.replace(/\\/g, '/').replace(/:/g, '\\:')),
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '22',
    '-c:a', 'copy', '-movflags', '+faststart', outputPath
  ], 300000)
}

export async function POST(request) {
  try {
    const formData = await request.formData()
    const video = formData.get('video')
    const language = formData.get('language') || 'en'
    const returnSRT = formData.get('return_srt') === 'true'
    const returnASS = formData.get('return_ass') === 'true'
    const captionStyle = formData.get('caption_style') || 'default'

    if (!video || typeof video === 'string') {
      return Response.json({ success: false, message: 'No video file received.' }, { status: 400 })
    }
    if (video.size > MAX_FILE_SIZE) {
      return Response.json({ success: false, message: 'File is larger than the 200 MB limit.' }, { status: 413 })
    }

    const uploadsDir = path.join(process.cwd(), 'public', 'uploads')
    const outputDir = path.join(process.cwd(), 'public', 'edited')
    await mkdir(uploadsDir, { recursive: true })
    await mkdir(outputDir, { recursive: true })

    const id = randomUUID()
    const rawExtension = path.extname(video.name || '')
    const extension = /^\.[a-zA-Z0-9]{1,10}$/.test(rawExtension) ? rawExtension : '.mp4'
    const inputPath = path.join(uploadsDir, `${id}${extension}`)
    const audioPath = path.join(uploadsDir, `${id}-audio.mp3`)

    await writeFile(inputPath, Buffer.from(await video.arrayBuffer()))

    let result
    let segments = []
    let transcript = ''
    let srtContent = ''
    let assContent = ''
    let captionedVideoUrl = null

    try {
      await extractAudio(inputPath, audioPath)
      result = await transcribeWithWhisper(audioPath, language)
      
      segments = result.segments || []
      transcript = result.text || segments.map(s => s.text).join(' ')
      
      if (returnSRT) {
        srtContent = formatSRT(segments)
      }
      if (returnASS) {
        assContent = formatASS(segments, captionStyle)
      }

      if (captionStyle !== 'none') {
        const captionPath = path.join(uploadsDir, `${id}-captions.ass`)
        await writeFile(captionPath, assContent || formatASS(segments, captionStyle))
        
        const captionedOutputPath = path.join(outputDir, `${id}-captioned.mp4`)
        await burnCaptions(inputPath, captionedOutputPath, captionPath, captionStyle)
        captionedVideoUrl = `/edited/${id}-captioned.mp4`
        await unlink(captionPath)
      }

      await unlink(audioPath)
    } catch (error) {
      if (error.message.includes('OPENAI_API_KEY')) {
        return Response.json({ 
          success: false, 
          message: 'Transcription requires OPENAI_API_KEY to be configured.' 
        }, { status: 503 })
      }
      throw error
    }

    return Response.json({
      success: true,
      transcript,
      segments,
      language: result.language || language,
      duration: result.duration,
      srt: srtContent || null,
      ass: assContent || null,
      captioned_video_url: captionedVideoUrl,
      original_video_url: `/uploads/${id}${extension}`
    })
  } catch (error) {
    return Response.json(
      { success: false, message: error?.message || 'Transcription failed.' },
      { status: 500 }
    )
  }
}

export async function GET() {
  const key = (process.env.OPENAI_API_KEY || '').trim()
  const transcriptionConfigured = Boolean(key) && key !== 'your_openai_api_key_here'
  return Response.json({
    success: true,
    transcription_configured: transcriptionConfigured,
    supported_languages: ['en', 'es', 'fr', 'de', 'it', 'pt', 'ru', 'ja', 'ko', 'zh', 'ar', 'hi', 'tr', 'pl', 'nl'],
    caption_styles: ['default', 'karaoke', 'wordByWord', 'tiktok', 'none'],
    max_file_mb: MAX_FILE_SIZE / (1024 * 1024),
    note: transcriptionConfigured
      ? 'Whisper transcription is configured.'
      : 'Requires a real OPENAI_API_KEY in .env.local for Whisper transcription'
  })
}