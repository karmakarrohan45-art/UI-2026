import { createWriteStream } from 'node:fs'
import { mkdir, unlink, writeFile } from 'node:fs/promises'
import { pipeline } from 'node:stream/promises'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

export const runtime = 'nodejs'
export const maxDuration = 300

const STYLE_FILTERS = {
  'Cinematic': 'eq=contrast=1.12:saturation=1.05,vignette,curves=preset=increase_contrast',
  'Vibrant Reels': 'eq=contrast=1.15:saturation=1.35,unsharp=5:5:0.6',
  'Clean Vlog': 'eq=brightness=0.03:saturation=1.1,unsharp=3:3:0.4',
  'Moody Film': 'eq=contrast=1.2:saturation=0.85,colorbalance=rs=-0.08:bs=0.06',
  'Podcast Cut': 'eq=contrast=1.05:saturation=1.0'
}

const MAX_FILE_SIZE = 200 * 1024 * 1024
const FFMPEG_PATH = process.env.FFMPEG_PATH || 'ffmpeg'
const FFPROBE_PATH = process.env.FFPROBE_PATH || 'ffprobe'
const SILENCE_THRESHOLD = '-35dB'
const MIN_SILENCE_SECONDS = 0.5
const MIN_SEGMENT_SECONDS = 0.08
const MAX_CUTS = 100
const COMMAND_TIMEOUT_MS = 270000

const isMissingExecutable = (error) => error?.code === 'ENOENT' || /ENOENT|spawn/i.test(String(error?.message))

const runCommand = (command, args, timeoutMs = COMMAND_TIMEOUT_MS) => new Promise((resolve, reject) => {
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

const runFfprobe = (args) => runCommand(FFPROBE_PATH, args, 30000)

const parseDurationFromFfmpegInfo = (text) => {
  const match = text.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/)
  if (!match) return 0
  return (Number(match[1]) * 3600) + (Number(match[2]) * 60) + Number(match[3])
}

const probeVideo = async (inputPath) => {
  try {
    const { stdout } = await runFfprobe([
      '-v', 'error',
      '-show_entries', 'format=duration:stream=codec_type,duration',
      '-of', 'json',
      inputPath
    ])
    const probe = JSON.parse(stdout)
    const streams = Array.isArray(probe.streams) ? probe.streams : []
    const videoStream = streams.find((stream) => stream.codec_type === 'video')
    const duration = Number(probe.format?.duration || videoStream?.duration || 0)
    return {
      duration: Number.isFinite(duration) && duration > 0 ? duration : 0,
      hasAudio: streams.some((stream) => stream.codec_type === 'audio')
    }
  } catch (error) {
    if (!isMissingExecutable(error)) throw error
    const { stderr } = await runFfmpeg(['-hide_banner', '-i', inputPath, '-f', 'null', '-'], 30000)
    return {
      duration: parseDurationFromFfmpegInfo(stderr),
      hasAudio: /Stream #.*Audio/i.test(stderr)
    }
  }
}

const parseSilenceIntervals = (ffmpegOutput, duration) => {
  const intervals = []
  let silenceStart = null

  for (const line of ffmpegOutput.split(/\r?\n/)) {
    const startMatch = line.match(/silence_start:\s*([0-9]+(?:\.[0-9]+)?)/)
    const endMatch = line.match(/silence_end:\s*([0-9]+(?:\.[0-9]+)?)/)

    if (startMatch && silenceStart === null) {
      silenceStart = Number(startMatch[1])
    }
    if (endMatch && silenceStart !== null) {
      intervals.push({ start: silenceStart, end: Number(endMatch[1]) })
      silenceStart = null
    }
  }

  if (silenceStart !== null && duration > silenceStart) {
    intervals.push({ start: silenceStart, end: duration })
  }

  return intervals
    .map((interval) => ({
      start: Math.max(0, interval.start),
      end: Math.max(0, Math.min(duration || interval.end, interval.end))
    }))
    .filter((interval) => interval.end - interval.start >= MIN_SILENCE_SECONDS)
    .sort((a, b) => a.start - b.start)
    .reduce((merged, interval) => {
      const previous = merged[merged.length - 1]
      if (previous && interval.start <= previous.end) {
        previous.end = Math.max(previous.end, interval.end)
      } else {
        merged.push({ ...interval })
      }
      return merged
    }, [])
}

const mergeCloseSegments = (segments) => segments.reduce((merged, segment) => {
  const previous = merged[merged.length - 1]
  if (previous && segment.start - previous.end < 0.15) {
    previous.end = segment.end
  } else {
    merged.push({ ...segment })
  }
  return merged
}, [])

const limitSegments = (segments) => {
  const limited = [...segments]
  while (limited.length > MAX_CUTS + 1) {
    let smallestGap = Number.POSITIVE_INFINITY
    let mergeIndex = 1
    for (let index = 1; index < limited.length; index += 1) {
      const gap = limited[index].start - limited[index - 1].end
      if (gap < smallestGap) {
        smallestGap = gap
        mergeIndex = index
      }
    }
    limited[mergeIndex - 1].end = limited[mergeIndex].end
    limited.splice(mergeIndex, 1)
  }
  return limited
}

const buildKeepSegments = (silenceIntervals, duration) => {
  const keepSegments = []
  let cursor = 0

  for (const interval of silenceIntervals) {
    const silenceStart = Math.min(duration, Math.max(0, interval.start))
    const silenceEnd = Math.min(duration, Math.max(0, interval.end))
    if (silenceStart > cursor + MIN_SEGMENT_SECONDS) {
      keepSegments.push({ start: cursor, end: silenceStart })
    }
    cursor = Math.max(cursor, silenceEnd)
  }

  if (duration > cursor + MIN_SEGMENT_SECONDS) {
    keepSegments.push({ start: cursor, end: duration })
  }

  if (!keepSegments.length && duration > 0) {
    keepSegments.push({ start: 0, end: duration })
  }

  return limitSegments(mergeCloseSegments(keepSegments))
}

const formatTime = (value) => value.toFixed(3)

const getSegmentDuration = (segment) => Math.max(0, segment.end - segment.start)

const getTotalDuration = (segments) => segments.reduce((total, segment) => total + getSegmentDuration(segment), 0)

const buildPostVideoFilters = (duration, styleFilters) => {
  const filters = []
  const fadeDuration = Math.min(0.4, Math.max(0, duration / 4))
  if (duration >= 0.8 && fadeDuration > 0) {
    filters.push(`fade=t=in:st=0:d=${formatTime(fadeDuration)}`)
    filters.push(`fade=t=out:st=${formatTime(Math.max(0, duration - fadeDuration))}:d=${formatTime(fadeDuration)}`)
  }
  filters.push(styleFilters)
  return filters.filter(Boolean).join(',')
}

const buildRenderArgs = ({ inputPath, outputPath, segments, hasAudio, styleFilters }) => {
  const args = ['-y', '-i', inputPath]
  const segmentDuration = getTotalDuration(segments)
  const postVideoFilters = buildPostVideoFilters(segmentDuration, styleFilters)

  if (segments.length === 1) {
    const segment = segments[0]
    const trimFilter = `trim=start=${formatTime(segment.start)}:end=${formatTime(segment.end)},setpts=PTS-STARTPTS`
    args.push('-vf', [trimFilter, postVideoFilters].filter(Boolean).join(','))
    if (hasAudio) {
      args.push('-af', `atrim=start=${formatTime(segment.start)}:end=${formatTime(segment.end)},asetpts=PTS-STARTPTS,loudnorm=I=-16:TP=-1.5:LRA=11`)
    }
  } else {
    const graph = []
    const inputs = []
    segments.forEach((segment, index) => {
      const start = formatTime(segment.start)
      const end = formatTime(segment.end)
      graph.push(`[0:v]trim=start=${start}:end=${end},setpts=PTS-STARTPTS[v${index}]`)
      if (hasAudio) {
        graph.push(`[0:a]atrim=start=${start}:end=${end},asetpts=PTS-STARTPTS[a${index}]`)
      }
      inputs.push(`[v${index}]${hasAudio ? `[a${index}]` : ''}`)
    })

    graph.push(`${inputs.join('')}concat=n=${segments.length}:v=1:a=${hasAudio ? 1 : 0}[concatenated]${hasAudio ? '[concatenatedAudio]' : ''}`)
    graph.push(`[concatenated]${postVideoFilters}[outputVideo]`)
    if (hasAudio) {
      graph.push('[concatenatedAudio]loudnorm=I=-16:TP=-1.5:LRA=11[outputAudio]')
    }

    args.push('-filter_complex', graph.join(';'), '-map', '[outputVideo]')
    if (hasAudio) args.push('-map', '[outputAudio]')
  }

  args.push(
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-crf', '22',
    '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart'
  )
  if (hasAudio) {
    args.push('-c:a', 'aac', '-b:a', '160k')
  } else {
    args.push('-an')
  }
  args.push(outputPath)
  return args
}

const simulatedResponse = (id, extension) => Response.json({
  success: true,
  simulated: true,
  is_original: true,
  output_url: `/uploads/${id}${extension}`,
  cuts: 0,
  message: 'Automatic cut detection requires ffmpeg to be installed on the server. The original upload was returned.',
  ffmpeg_required: true
})

export async function POST(request) {
  try {
    const formData = await request.formData()
    const video = formData.get('video')
    const style = formData.get('style') || 'Cinematic'

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
    const outputPath = path.join(outputDir, `${id}-edited.mp4`)
    await pipeline(video.stream(), createWriteStream(inputPath))

    let probe
    let silenceIntervals = []
    let segments = []
    try {
      probe = await probeVideo(inputPath)
      if (probe.hasAudio && probe.duration > 0) {
        const { stderr } = await runFfmpeg([
          '-hide_banner',
          '-i', inputPath,
          '-af', `silencedetect=noise=${SILENCE_THRESHOLD}:d=${MIN_SILENCE_SECONDS}`,
          '-f', 'null',
          '-'
        ])
        silenceIntervals = parseSilenceIntervals(stderr, probe.duration)
        segments = buildKeepSegments(silenceIntervals, probe.duration)
      } else {
        segments = probe.duration > 0 ? [{ start: 0, end: probe.duration }] : []
      }
    } catch (error) {
      if (isMissingExecutable(error)) return simulatedResponse(id, extension)
      throw error
    }

    if (!segments.length) {
      return Response.json({ success: false, message: 'The uploaded video could not be analyzed.' }, { status: 422 })
    }

    try {
      await runFfmpeg(buildRenderArgs({
        inputPath,
        outputPath,
        segments,
        hasAudio: probe.hasAudio,
        styleFilters: STYLE_FILTERS[style] || STYLE_FILTERS['Cinematic']
      }))
      await unlink(inputPath)
    } catch (error) {
      if (isMissingExecutable(error)) return simulatedResponse(id, extension)
      throw error
    }

    const originalDuration = probe.duration || getTotalDuration(segments)
    const outputDuration = getTotalDuration(segments)
    const cuts = Math.max(0, segments.length - 1)
    return Response.json({
      success: true,
      output_url: `/edited/${id}-edited.mp4`,
      style,
      cuts,
      removed_seconds: Math.max(0, originalDuration - outputDuration),
      output_duration_seconds: outputDuration,
      detection: {
        silence_threshold: SILENCE_THRESHOLD,
        minimum_silence_seconds: MIN_SILENCE_SECONDS
      }
    })
  } catch (error) {
    return Response.json(
      { success: false, message: error?.message || 'Auto edit failed on the server.' },
      { status: 500 }
    )
  }
}

export async function GET() {
  return Response.json({
    success: true,
    styles: Object.keys(STYLE_FILTERS),
    max_file_mb: MAX_FILE_SIZE / (1024 * 1024),
    automatic_cuts: true,
    silence_threshold: SILENCE_THRESHOLD,
    minimum_silence_seconds: MIN_SILENCE_SECONDS
  })
}
