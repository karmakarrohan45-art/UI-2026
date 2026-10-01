'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

const LIBRARY_URL = process.env.NEXT_PUBLIC_LIBRARY_URL || 'http://localhost:5173'

const STYLE_OPTIONS = ['Cinematic', 'Vibrant Reels', 'Clean Vlog', 'Moody Film', 'Podcast Cut']

const CAPTION_STYLES = ['default', 'karaoke', 'wordByWord', 'tiktok', 'cinematic', 'minimal']

const SUGGESTIONS = [
  'Make it cinematic with a slow fade in',
  'Black and white, moody, trim to 10 seconds',
  'Vibrant and punchy, speed it up 2x',
  'Vintage VHS look, muted audio',
  'Transcribe audio and add karaoke captions',
  'Remove pauses and add TikTok style captions',
  'Add cinematic captions, burn into video'
]

const BOT_GREETING = {
  from: 'bot',
  text: "Hi! I'm your edit bot. Upload a video and I can remove pauses automatically, transcribe audio, add animated captions, or follow your creative instructions."
}

export default function AutoEditStudio() {
  const [file, setFile] = useState(null)
  const [style, setStyle] = useState('Cinematic')
  const [autoCutEnabled, setAutoCutEnabled] = useState(true)
  const [messages, setMessages] = useState([BOT_GREETING])
  const [prompt, setPrompt] = useState('')
  const [isRendering, setIsRendering] = useState(false)
  const [progress, setProgress] = useState(0)
  const [statusText, setStatusText] = useState('')
  const [error, setError] = useState('')
  const [warning, setWarning] = useState('')
  const [resultUrl, setResultUrl] = useState(null)
  const [cutSummary, setCutSummary] = useState(null)
  const [dragOver, setDragOver] = useState(false)
  const [transcript, setTranscript] = useState(null)
  const [segments, setSegments] = useState(null)
  const [srtContent, setSrtContent] = useState(null)
  const [assContent, setAssContent] = useState(null)
  const [captionStyle, setCaptionStyle] = useState('default')
  const [showCaptionOptions, setShowCaptionOptions] = useState(false)
  const [transcribeOnly, setTranscribeOnly] = useState(false)
  const inputRef = useRef(null)
  const chatEndRef = useRef(null)

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [messages, isRendering])

  const renderAutoCut = (selectedFile = file) => {
    if (!selectedFile || isRendering) return

    setIsRendering(true)
    setError('')
    setWarning('')
    setResultUrl(null)
    setCutSummary(null)
    setProgress(8)
    setStatusText('Uploading your video…')

    const formData = new FormData()
    formData.append('video', selectedFile)
    formData.append('style', style)

    const request = new XMLHttpRequest()
    request.open('POST', '/api/auto-edit')

    request.upload.addEventListener('progress', (event) => {
      if (!event.lengthComputable) return
      const uploadPart = (event.loaded / event.total) * 60
      setProgress(Math.max(8, Math.round(uploadPart)))
      if (uploadPart >= 60) setStatusText('Detecting pauses and rendering the final cut…')
    })

    request.addEventListener('load', () => {
      setIsRendering(false)
      try {
        const data = JSON.parse(request.responseText)
        if (request.status >= 400 || !data.success) {
          setError(data.message || 'The automatic editor could not finish. Please try again.')
          return
        }

        setProgress(100)
        setStatusText('')
        setResultUrl(data.output_url)
        setCutSummary({
          cuts: Number(data.cuts || 0),
          removedSeconds: Number(data.removed_seconds || 0),
          outputDurationSeconds: Number(data.output_duration_seconds || 0),
          simulated: !!data.simulated
        })
        setWarning(data.simulated ? data.message : '')
        setMessages((current) => [...current, {
          from: 'bot',
          text: data.simulated
            ? 'The server returned the original upload because ffmpeg is not installed. Install ffmpeg to enable real pause removal and rendering.'
            : `Finished! I removed ${Number(data.cuts || 0)} pause${Number(data.cuts || 0) === 1 ? '' : 's'} and rendered the final video.`
        }])
      } catch {
        setError('Unexpected server response. Please try again.')
      }
    })

    request.addEventListener('error', () => {
      setIsRendering(false)
      setError('Could not reach the editing server. Please try again.')
    })

    request.send(formData)
  }

  const pickFile = useCallback((selected) => {
    setError('')
    setWarning('')
    setResultUrl(null)
    setCutSummary(null)
    setProgress(0)
    setStatusText('')
    if (!selected) return
    if (isRendering) {
      setError('Wait for the current render to finish before changing the video.')
      return
    }
    if (!selected.type.startsWith('video/')) {
      setError('Please choose a video file (mp4, mov, webm...).')
      return
    }

    setFile(selected)
    setMessages((current) => [...current,
      { from: 'user', text: `Uploaded ${selected.name} (${(selected.size / (1024 * 1024)).toFixed(1)} MB)` },
      { from: 'bot', text: autoCutEnabled ? 'Analyzing pauses and preparing the final cut…' : 'Video received. Add an edit prompt or enable automatic cuts to render it.' }
    ])

    if (autoCutEnabled) renderAutoCut(selected)
  }, [autoCutEnabled, isRendering])

  const handleDrop = (event) => {
    event.preventDefault()
    setDragOver(false)
    pickFile(event.dataTransfer.files?.[0])
  }

  const transcribeVideo = async () => {
    if (!file || isRendering) return

    setIsRendering(true)
    setError('')
    setWarning('')
    setResultUrl(null)
    setCutSummary(null)
    setTranscript(null)
    setSegments(null)
    setSrtContent(null)
    setAssContent(null)
    setProgress(8)
    setStatusText('Uploading video for transcription…')

    const formData = new FormData()
    formData.append('video', file)
    formData.append('language', 'en')
    formData.append('return_srt', 'true')
    formData.append('return_ass', 'true')

    const request = new XMLHttpRequest()
    request.open('POST', '/api/transcribe')

    request.upload.addEventListener('progress', (event) => {
      if (!event.lengthComputable) return
      const uploadPart = (event.loaded / event.total) * 60
      setProgress(Math.max(8, Math.round(uploadPart)))
      if (uploadPart >= 60) setStatusText('Transcribing audio with Whisper…')
    })

    request.addEventListener('load', () => {
      setIsRendering(false)
      try {
        const data = JSON.parse(request.responseText)
        if (request.status >= 400 || !data.success) {
          setError(data.message || 'Transcription failed. Please try again.')
          return
        }

        setProgress(100)
        setStatusText('')
        setTranscript(data.transcript)
        setSegments(data.segments)
        setSrtContent(data.srt)
        setAssContent(data.ass)
        
        if (data.captioned_video_url) {
          setResultUrl(data.captioned_video_url)
          setWarning('Captions burned into video')
        } else {
          setWarning('Transcription complete. Enable captions to burn them into the video.')
        }
        
        setMessages((current) => [...current, {
          from: 'bot',
          text: data.captioned_video_url
            ? 'Transcription complete with captions burned in! Download the SRT/ASS files below.'
            : 'Transcription complete! You can now add animated captions to your video.'
        }])
      } catch {
        setError('Unexpected server response. Please try again.')
      }
    })

    request.addEventListener('error', () => {
      setIsRendering(false)
      setError('Could not reach the transcription server. Please try again.')
    })

    request.send(formData)
  }

  const addCaptions = async () => {
    if (!file || isRendering) return

    setIsRendering(true)
    setError('')
    setWarning('')
    setResultUrl(null)
    setCutSummary(null)
    setProgress(8)
    setStatusText('Uploading video for caption generation…')

    const formData = new FormData()
    formData.append('video', file)
    formData.append('auto_transcribe', 'true')
    formData.append('caption_style', captionStyle)
    formData.append('language', 'en')

    const request = new XMLHttpRequest()
    request.open('POST', '/api/captions')

    request.upload.addEventListener('progress', (event) => {
      if (!event.lengthComputable) return
      const uploadPart = (event.loaded / event.total) * 60
      setProgress(Math.max(8, Math.round(uploadPart)))
      if (uploadPart >= 60) setStatusText('Generating animated captions…')
    })

    request.addEventListener('load', () => {
      setIsRendering(false)
      try {
        const data = JSON.parse(request.responseText)
        if (request.status >= 400 || !data.success) {
          setError(data.message || 'Caption generation failed. Please try again.')
          return
        }

        setProgress(100)
        setStatusText('')
        setResultUrl(data.captioned_video_url)
        setTranscript(data.transcript)
        setSegments(data.segments)
        setSrtContent(data.srt)
        setAssContent(data.ass)
        
        setMessages((current) => [...current, {
          from: 'bot',
          text: `Captions added with ${captionStyle} style! Video ready with animated subtitles.`
        }])
      } catch {
        setError('Unexpected server response. Please try again.')
      }
    })

    request.addEventListener('error', () => {
      setIsRendering(false)
      setError('Could not reach the caption server. Please try again.')
    })

    request.send(formData)
  }

  const submitPrompt = (event) => {
    event?.preventDefault()
    const text = prompt.trim()
    if (!text || isRendering) return
    setPrompt('')
    setError('')
    setWarning('')
    setMessages((current) => [...current, { from: 'user', text }])
  }

  const renderEdit = () => {
    const prompts = messages.filter((m) => m.from === 'user' && !m.text.startsWith('Uploaded')).map((m) => m.text)
    if (!file || !prompts.length || isRendering) return

    setIsRendering(true)
    setError('')
    setWarning('')
    setResultUrl(null)
    setCutSummary(null)
    setTranscript(null)
    setSegments(null)
    setSrtContent(null)
    setAssContent(null)
    setProgress(8)
    setStatusText('Uploading your video…')

    const formData = new FormData()
    formData.append('video', file)
    formData.append('prompts', JSON.stringify(prompts))

    const request = new XMLHttpRequest()
    request.open('POST', '/api/chat-edit')

    request.upload.addEventListener('progress', (event) => {
      if (!event.lengthComputable) return
      const uploadPart = (event.loaded / event.total) * 60
      setProgress(Math.max(8, Math.round(uploadPart)))
      if (uploadPart >= 60) setStatusText('Creating your edit…')
    })

    request.addEventListener('load', () => {
      setIsRendering(false)
      try {
        const data = JSON.parse(request.responseText)
        if (request.status >= 400 || !data.success) {
          setError(data.message || 'The edit bot could not finish. Please try again.')
          return
        }
        setProgress(100)
        setStatusText('')
        setResultUrl(data.output_url)
        setTranscript(data.transcript)
        setSegments(data.segments)
        setSrtContent(data.srt)
        setAssContent(data.ass)
        setMessages((current) => [...current, { from: 'bot', text: data.reply || 'Your edited video is ready below.' }])
      } catch {
        setError('Unexpected server response. Please try again.')
      }
    })

    request.addEventListener('error', () => {
      setIsRendering(false)
      setError('Could not reach the editing server. Please try again.')
    })

    request.send(formData)
  }

  const hasPrompts = messages.some((m) => m.from === 'user' && !m.text.startsWith('Uploaded'))

  return (
    <main className="studio">
      <header className="topbar">
        <div className="brand"><span className="brand-mark">G</span><span>Gene Academy</span></div>
        <a className="back-link" href={LIBRARY_URL}>← Back to library</a>
      </header>

      <section className="hero">
        <p className="eyebrow">AUTOMATIC CUTS</p>
        <h1>Upload once. We remove pauses and render the final cut.</h1>
        <p className="subhead">
          The editor detects dead air, joins the remaining clips, applies your selected look, and exports a ready-to-share MP4.
        </p>
      </section>

      <section className="panel">
        <div className="editor-controls">
          <label className="style-select">
            <span>Look</span>
            <select value={style} onChange={(event) => setStyle(event.target.value)} disabled={isRendering}>
              {STYLE_OPTIONS.map((option) => <option key={option}>{option}</option>)}
            </select>
          </label>
          <label className="auto-cut-toggle">
            <input type="checkbox" checked={autoCutEnabled} onChange={(event) => setAutoCutEnabled(event.target.checked)} disabled={isRendering} />
            <span>Automatically render after upload</span>
          </label>
        </div>

        <div className="transcribe-controls">
          <p className="eyebrow">TRANSCRIPTION & CAPTIONS</p>
          <div className="transcribe-buttons">
            <button className="edit-button transcribe-button" disabled={!file || isRendering} onClick={transcribeVideo}>
              {isRendering ? 'Transcribing…' : '🎙 Transcribe Audio'}
            </button>
            <button className="edit-button caption-button" disabled={!file || isRendering} onClick={addCaptions}>
              {isRendering ? 'Adding Captions…' : '📝 Add Animated Captions'}
            </button>
          </div>
          <label className="caption-style-select">
            <span>Caption Style</span>
            <select value={captionStyle} onChange={(event) => setCaptionStyle(event.target.value)} disabled={isRendering}>
              {CAPTION_STYLES.map((option) => <option key={option}>{option.charAt(0).toUpperCase() + option.slice(1)}</option>)}
            </select>
          </label>
        </div>

        <div
          className={`dropzone${dragOver ? ' dragover' : ''}`}
          onClick={() => inputRef.current?.click()}
          onDragOver={(event) => { event.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          role="button"
          tabIndex={0}
          aria-label="Upload a video"
          onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') inputRef.current?.click() }}
        >
          <div className="dropzone-icon">🎬</div>
          {file
            ? <><strong>{file.name}</strong><small>{(file.size / (1024 * 1024)).toFixed(1)} MB · click to change</small></>
            : <><strong>Drag & drop your video here</strong><small>or click to browse · MP4, MOV, WEBM up to 200 MB</small></>}
          <input
            ref={inputRef}
            type="file"
            accept="video/*"
            hidden
            onChange={(event) => pickFile(event.target.files?.[0])}
          />
        </div>
      </section>

      <section className="panel chat-panel">
        <p className="eyebrow">EDIT BOT CHAT</p>
        <div className="chat-messages">
          {messages.map((message, index) => (
            <p className={`chat-line ${message.from}`} key={index}>{message.text}</p>
          ))}
          {isRendering && <p className="chat-line bot">Working on it…</p>}
          <div ref={chatEndRef} />
        </div>

        {!hasPrompts && (
          <div className="suggestions">
            {SUGGESTIONS.map((suggestion) => (
              <button key={suggestion} type="button" className="style-chip" onClick={() => setPrompt(suggestion)}>
                {suggestion}
              </button>
            ))}
          </div>
        )}

        <form className="chat-form" onSubmit={submitPrompt}>
          <input
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder={file ? 'e.g. make it moody, slow motion, trim to 10s' : 'Upload a video first, then describe your edit here…'}
            aria-label="Describe your edit"
            disabled={isRendering}
          />
          <button type="submit" aria-label="Add prompt" disabled={!prompt.trim() || isRendering}>➤</button>
        </form>

        <button className="edit-button auto-cut-button" disabled={!file || isRendering} onClick={() => renderAutoCut()}>
          {isRendering ? 'Rendering…' : 'Auto-cut & render'}
        </button>

        <button className="edit-button prompt-button" disabled={!file || !hasPrompts || isRendering} onClick={renderEdit}>
          Render chat edit
        </button>

        {(isRendering || progress > 0) && (
          <div>
            <div className={`progress-track${isRendering && progress < 100 ? ' processing' : ''}`}><div className="progress-fill" style={{ width: `${progress}%` }} /></div>
            {statusText && <p className="status-line">{statusText}</p>}
          </div>
        )}

        {cutSummary && (
          <div className={`cut-summary${cutSummary.simulated ? ' simulated' : ''}`}>
            <strong>{cutSummary.simulated ? 'Original video returned' : 'Automatic cut summary'}</strong>
            <span>{cutSummary.simulated
              ? 'No cuts were made because ffmpeg is unavailable.'
              : `${cutSummary.cuts} pause${cutSummary.cuts === 1 ? '' : 's'} removed · ${cutSummary.removedSeconds.toFixed(1)}s shorter · ${cutSummary.outputDurationSeconds.toFixed(1)}s final`}
            </span>
          </div>
        )}

        {error && <p className="error-text">{error}</p>}
        {warning && <p className="warning-text">{warning}</p>}

        {resultUrl && (
          <div className="result-section">
            <video className="result-video" src={resultUrl} controls playsInline />
            <a className="download-link" href={resultUrl} download>Download final video</a>
          </div>
        )}

        {(transcript || srtContent || assContent) && (
          <div className="transcript-section">
            <p className="eyebrow">TRANSCRIPT & SUBTITLES</p>
            {transcript && (
              <details className="transcript-details">
                <summary>View Full Transcript</summary>
                <pre className="transcript-text">{transcript}</pre>
              </details>
            )}
            <div className="subtitle-downloads">
              {srtContent && (
                <a 
                  className="download-link srt-download" 
                  href={`data:text/srt;charset=utf-8,${encodeURIComponent(srtContent)}`} 
                  download="captions.srt"
                >
                  📄 Download SRT
                </a>
              )}
              {assContent && (
                <a 
                  className="download-link ass-download" 
                  href={`data:text/ass;charset=utf-8,${encodeURIComponent(assContent)}`} 
                  download="captions.ass"
                >
                  🎬 Download ASS (Animated)
                </a>
              )}
            </div>
          </div>
        )}
      </section>
    </main>
  )
}
