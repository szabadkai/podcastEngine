# Layer Lines Weekly

Automated weekly podcast about 3D printing and additive manufacturing. The pipeline collects news from RSS feeds, clusters and fact-checks them with AI, writes a two-host conversational script, synthesizes audio with TTS, and publishes to a podcast feed — all running unattended in GitHub Actions.

**Feed:** [szabadkai.github.io/podcastEngine](https://szabadkai.github.io/podcastEngine)

## How it works

The pipeline runs as a sequence of stages, each reading the previous stage's JSON output:

| Stage | File | What it does |
|-------|------|-------------|
| **collect** | `01-collect.ts` | Fetches RSS feeds + curated GitHub Issues, deduplicates, filters by recency |
| **analyze** | `02-analyze.ts` | AI clusters stories into 7-10 segments, ranks by relevance |
| **fact-check** | `03-fact-check.ts` | AI verifies claims, flags hype, adds skeptical angles where warranted |
| **script** | `04-script.ts` | AI writes a two-host conversational script (Alex & Jordan) |
| **tag** | `04b-tag.ts` | Adds expressive tags (`[laugh]`, `[chuckle]`) for TTS providers that support them |
| **recap** | `04c-recap.ts` | Distills episode into a continuity recap for future episodes |
| **pronunciation** | `04d-pronunciation.ts` | Scans for new acronyms, auto-extends the pronunciation map via AI |
| **audio** | `05-audio.ts` | Synthesizes speech with configurable TTS backend, concatenates and normalizes |
| **publish** | `06-publish.ts` | Uploads MP3 to GitHub Releases, updates RSS feed and manifest |

Each stage is idempotent — if its output file already exists, it skips. You can re-run a failed pipeline without repeating completed work.

## Setup

```bash
npm install
cp .env.example .env
# Fill in OPENROUTER_API_KEY (required) and ELEVENLABS_API_KEY (if using ElevenLabs)
```

### Requirements

- Node.js 22+
- ffmpeg (for audio concatenation and loudness normalization)
- An [OpenRouter](https://openrouter.ai) API key
- A TTS provider API key (see below)

## Running

```bash
# Full pipeline
npm run pipeline

# Dry run (skips audio + publish)
npm run dry-run

# Individual stages
npm run collect
npm run analyze
npm run script
npm run audio
# etc.
```

Override the episode date:

```bash
EPISODE_DATE=2026-05-29 npm run pipeline
```

## Curated links

Want a specific article covered? Create a GitHub Issue with the `episode-link` label:

- **Title:** Short description (e.g., "Bambu Lab open-sources firmware")
- **Body:** URL on the first line, optional editorial note below
- **Label:** `episode-link`

The collect stage picks up all open `episode-link` issues, fetches page metadata, and merges them into the story pool. Curated stories bypass the 7-day freshness filter and are flagged as editor picks so the AI prioritizes them. Issues close automatically after the episode is processed.

## TTS providers

Configured via `ttsProvider` in `src/config.ts`:

| Provider | Cost | Quality | Notes |
|----------|------|---------|-------|
| **elevenlabs** | Paid | Best | Default. Requires `ELEVENLABS_API_KEY` |
| **edge** | Free | Good | Microsoft neural voices, no API key needed |
| **chatterbox** | Free | Good | Local PyTorch model, supports expressive tags |
| **kokoro** | Free | Good | Local ONNX model, needs `scripts/setup-kokoro.sh` |
| **piper** | Free | Fair | Lightest, fully offline |

### Pronunciation normalization

Acronyms like FDM, SLA, PETG are rewritten to phonetic forms before TTS so they sound natural (e.g., `PETG` becomes `pee-tee-gee`). The map lives in `data/pronunciation.json` and is automatically extended by the pronunciation stage (04d) whenever new acronyms appear in a script.

## Project structure

```
src/
  01-collect.ts          # RSS + curated link collection
  02-analyze.ts          # AI story clustering
  03-fact-check.ts       # AI fact-checking
  04-script.ts           # AI script generation
  04b-tag.ts             # Expressive tag injection
  04c-recap.ts           # Continuity recap
  04d-pronunciation.ts   # Acronym pronunciation auto-extension
  05-audio.ts            # TTS synthesis + audio processing
  06-publish.ts          # GitHub Release + RSS feed
  pipeline.ts            # Stage orchestrator
  config.ts              # All configuration
  lib/
    ai.ts                # OpenRouter chat wrapper
    audio.ts             # ffmpeg concat + loudnorm
    curated-fetch.ts     # GitHub Issues inbox
    pronunciation.ts     # TTS pronunciation normalization
    rss-fetch.ts         # RSS feed parser
    storage.ts           # JSON I/O helpers
    types.ts             # Shared TypeScript interfaces
    ...
prompts/                 # AI system prompts for each stage
data/
  seen-urls.json         # Deduplication history
  pronunciation.json     # Acronym pronunciation map
episodes/
  manifest.json          # Published episode index
  feed.xml               # Podcast RSS feed
  recaps/                # Per-episode continuity recaps
pages/                   # GitHub Pages site (landing page + transcripts)
```

## CI

The GitHub Actions workflow (`.github/workflows/weekly-episode.yml`) runs every Friday at 6:00 AM UTC. It can also be triggered manually with an optional date override and dry-run flag.

Required secrets: `OPENROUTER_API_KEY`, `ELEVENLABS_API_KEY`. The workflow uses the default `GITHUB_TOKEN` for publishing releases and processing curated link issues.
