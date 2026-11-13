# VOICE_MODE — Voice Input

> Feature Flag: `FEATURE_VOICE_MODE=1`
> Status: fully working (two backends: Anthropic OAuth / Doubao ASR)
> References: 46

## 1. Overview

VOICE_MODE implements Push-to-Talk voice input. The user holds the space bar to record, the audio streams to an STT backend, and the live transcription appears in the terminal. Two backends are supported:

- **Anthropic STT (default)**: streams over WebSocket to the Nova 3 endpoint; requires Anthropic OAuth
- **Doubao ASR**: streaming recognition through the AsyncGenerator protocol of the `doubaoime-asr` package, using a separate credentials file and no Anthropic OAuth

### Key Features

- **Push-to-Talk**: hold the space bar to record; the message is sent automatically on release
- **Streaming transcription**: interim transcription results appear in real time during recording
- **Seamless integration**: transcribed text is submitted directly as a user message in the conversation
- **Switchable backends**: choose the STT backend with a `/voice` command argument, persisted to settings.json

## 2. User Interaction

| Action | Behavior |
|--------|----------|
| Hold space | Start recording and show the recording state |
| Release space | Stop recording; the transcription is submitted automatically |
| `/voice` | Toggle voice mode (uses the Anthropic backend by default) |
| `/voice doubao` | Enable voice mode with the Doubao ASR backend |
| `/voice anthropic` | Switch back to the Anthropic STT backend |

### UI Feedback

- **Recording indicator**: a red/pulsing animation while recording
- **Interim transcription**: live STT text shown during recording
- **Final transcription**: replaces the interim result when finished

## 3. Implementation

### 3.1 Gating Logic

File: `src/voice/voiceModeEnabled.ts`

Two layers of check functions:

```ts
// Anthropic backend (requires OAuth)
isVoiceModeEnabled() = hasVoiceAuth() && isVoiceGrowthBookEnabled()

// Doubao backend / general availability check (no OAuth needed)
isVoiceAvailable() = isVoiceGrowthBookEnabled()
```

1. **Feature Flag**: `feature('VOICE_MODE')` — compile-time/runtime switch
2. **GrowthBook Kill-Switch**: `!getFeatureValue_CACHED_MAY_BE_STALE('tengu_amber_quartz_disabled', false)` — emergency off switch (default false = not disabled)
3. **Auth check (Anthropic only)**: `hasVoiceAuth()` — requires an Anthropic OAuth token (not an API key)
4. **Provider check**: the `voiceProvider` setting decides which backend is used; the Doubao backend skips the OAuth check

### 3.2 Core Modules

| Module | Responsibility |
|--------|----------------|
| `src/voice/voiceModeEnabled.ts` | Three-layer gating: feature flag + GrowthBook + auth |
| `src/hooks/useVoice.ts` | React hook managing recording state and backend connections |
| `src/services/voiceStreamSTT.ts` | Anthropic WebSocket streaming STT |
| `src/services/doubaoSTT.ts` | Doubao ASR adapter (AsyncGenerator → VoiceStreamConnection) |
| `src/commands/voice/voice.ts` | `/voice` command implementation, handling backend selection and persistence |
| `src/hooks/useVoiceEnabled.ts` | Voice-enabled state hook; decides whether to skip OAuth based on the provider |
| `src/utils/settings/types.ts` | `voiceProvider: 'anthropic' | 'doubao'` setting type definition |

### 3.3 Data Flow

#### Anthropic Backend

```
User presses space
      │
      ▼
useVoice hook activates
      │
      ▼
macOS native audio / SoX starts recording
      │
      ▼
WebSocket connection to the Anthropic STT endpoint
      │
      ├──→ interim transcription → shown live
      │
      ▼
User releases space
      │
      ▼
Recording stops, wait for the final transcription
      │
      ▼
Transcribed text → inserted into input box → submitted automatically
```

#### Doubao ASR Backend

```
User presses space
      │
      ▼
useVoice hook activates (voiceProvider === 'doubao' detected)
      │
      ▼
macOS native audio / SoX starts recording
      │
      ▼
connectDoubaoStream() creates an AudioChunkQueue + VoiceStreamConnection
      │
      ├──→ onReady fires immediately (no handshake to wait for)
      │
      ▼
Audio data flows through AudioChunkQueue into transcribeRealtime()
      │
      ├──→ INTERIM_RESULT → interim transcription shown live
      ├──→ FINAL_RESULT   → final transcription shown
      │
      ▼
User releases space
      │
      ▼
finalize() returns immediately (Doubao already returned results during recording)
      │
      ▼
Transcribed text → inserted into input box → submitted automatically
```

### 3.4 Audio Recording

Two audio backends are supported (shared by both STT backends):
- **macOS native audio**: preferred, low latency
- **SoX (Sound eXchange)**: fallback, cross-platform

### 3.5 Doubao ASR Adapter Design

File: `src/services/doubaoSTT.ts`

The Doubao backend uses the adapter pattern to bridge the `doubaoime-asr` AsyncGenerator protocol to the `VoiceStreamConnection` interface:

**AudioChunkQueue** — a push-style async queue:
- Implements the `AsyncIterable<Uint8Array>` interface
- `push(chunk)` enqueues audio data, `push(null)` sends the end signal
- Internally maintains two pieces of state: waiters and a buffer queue (chunks)

**connectDoubaoStream()** — the connection entry point:
- Dynamically imports `doubaoime-asr` (optionalDependencies)
- Loads credentials from `~/.claude/tts/doubao/credentials.json`
- Creates the AudioChunkQueue and VoiceStreamConnection
- Fires `onReady` immediately (avoiding a deadlock with useVoice's audio buffering)
- `finalize()` returns immediately (Doubao already returned results during recording)
- A background async IIFE consumes the `transcribeRealtime` generator, mapping response types to callbacks

**Response type mapping**:

| doubaoime-asr ResponseType | Callback mapping |
|----------------------------|------------------|
| SESSION_STARTED | Logged |
| VAD_START | Logged |
| INTERIM_RESULT | `onTranscript(text, false)` |
| FINAL_RESULT | `onTranscript(text, true)` |
| ERROR | `onError(errorMsg)` |
| SESSION_FINISHED | Logged |

### 3.6 Backend Selection Logic

File: `src/hooks/useVoice.ts`

```ts
// Determine the current provider
isDoubaoProvider() → reads settings.voiceProvider

// Availability check in handleKeyEvent
const sttAvailable = isDoubaoProvider()
  ? isDoubaoAvailableSync()    // optimistic check (returns true the first time)
  : isVoiceStreamAvailable()   // Anthropic WebSocket check

// Connect function selection in attemptConnect
const connectFn = isDoubaoProvider()
  ? connectDoubaoStream
  : connectVoiceStream
```

Special handling for the Doubao backend:
- Skips the `getVoiceKeyterms()` call (Doubao needs no keyword hints)
- Skips Focus Mode (`if (!enabled || !focusMode || isDoubaoProvider())`)

## 4. Key Design Decisions

1. **Two backends coexist**: the Doubao backend is a separate adapter alongside the Anthropic backend, doesn't replace the existing flow, and is selected through the `voiceProvider` setting
2. **Setting persistence**: `voiceProvider` is stored in `settings.json`, changed through the `/voice` command, and applies across sessions
3. **OAuth-only (Anthropic)**: the Anthropic backend uses the `voice_stream` endpoint (claude.ai), available only to OAuth users
4. **No OAuth for Doubao**: the Doubao backend uses a separate credentials file, doesn't depend on Anthropic authentication, and relaxes the gate through `isVoiceAvailable()`
5. **GrowthBook negative gate**: `tengu_amber_quartz_disabled` defaults to `false`, so new installs work out of the box
6. **onReady fires immediately**: the Doubao backend fires `onReady` as soon as the connection is set up, avoiding a timing deadlock with useVoice's audio buffering (Anthropic must wait for the WebSocket handshake)
7. **finalize() returns immediately**: Doubao has already returned all results during recording, so there is nothing to wait for when the user lets go
8. **Optimistic availability check**: `isDoubaoAvailableSync()` returns `true` on the first call, and real import errors are handled in `connectDoubaoStream`
9. **optionalDependencies**: `doubaoime-asr` is an optional dependency, so a failed install doesn't affect the Anthropic backend

## 5. Usage

```bash
# Enable the feature
FEATURE_VOICE_MODE=1 bun run dev

# Using the Anthropic backend in the REPL
# 1. Make sure you're logged in via OAuth (claude.ai subscription)
# 2. Type /voice to enable
# 3. Hold the space bar and speak
# 4. Release the space bar and wait for the transcription

# Using the Doubao ASR backend in the REPL
# 1. Make sure doubaoime-asr is installed (bun add doubaoime-asr)
# 2. Configure the credentials file: ~/.claude/tts/doubao/credentials.json
# 3. Type /voice doubao to enable
# 4. Hold the space bar and speak
# 5. Release the space bar; the transcription appears immediately

# Switching backends
/voice doubao      # switch to Doubao ASR
/voice anthropic   # switch back to Anthropic STT
/voice             # turn voice mode off
```

### Doubao Credentials

Credentials file path: `~/.claude/tts/doubao/credentials.json`

```json
{
  "deviceId": "...",
  "installId": "...",
  "cdid": "...",
  "openudid": "...",
  "clientudid": "...",
  "token": "..."
}
```

## 6. External Dependencies

| Dependency | Description | Applies to |
|------------|-------------|------------|
| Anthropic OAuth | claude.ai subscription login, not an API key | Anthropic |
| GrowthBook | `tengu_amber_quartz_disabled` emergency off switch | Both |
| macOS native audio or SoX | Audio recording | Both |
| Nova 3 STT | Anthropic speech-to-text model | Anthropic |
| doubaoime-asr | Doubao ASR SDK (optionalDependencies) | Doubao |
| Credentials file | `~/.claude/tts/doubao/credentials.json` | Doubao |

## 7. File Index

| File | Responsibility |
|------|----------------|
| `src/voice/voiceModeEnabled.ts` | Three-layer gating logic + `isVoiceAvailable()` |
| `src/hooks/useVoice.ts` | React hook (recording state + backend selection + connection management) |
| `src/hooks/useVoiceEnabled.ts` | Voice-enabled state hook (decides the OAuth check by provider) |
| `src/services/voiceStreamSTT.ts` | Anthropic STT WebSocket streaming |
| `src/services/doubaoSTT.ts` | Doubao ASR adapter (AudioChunkQueue + connectDoubaoStream) |
| `src/commands/voice/voice.ts` | `/voice` command (toggle + backend selection) |
| `src/commands/voice/index.ts` | Command registration (availability restriction removed) |
| `src/utils/settings/types.ts` | `voiceProvider` type definition |
