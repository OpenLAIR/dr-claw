---
name: inno-figure-gen
description: >
  Generate/edit images with OpenAI gpt-image-2 by default, falling back to
  Gemini (gemini-3.1-flash-image-preview) when OPENAI_API_KEY is unset.
  Supports text-to-image + image-to-image; 1K/2K/4K; use --input-image for
  editing, --provider to force a provider, --model to override the model.
---

# Image Generation & Editing (GPT Image default, Gemini fallback)

Generate new images or edit existing ones. The script picks a provider based on which API keys are available:

1. **OpenAI** `gpt-image-2` — used when `OPENAI_API_KEY` is set (default).
2. **Gemini** `gemini-3.1-flash-image-preview` — used when only `GEMINI_API_KEY` is set.

When both keys are set, OpenAI is picked by default; force Gemini with `--provider gemini`. If an auto-selected OpenAI call fails at runtime (quota, moderation, network), the script transparently falls back to Gemini when a Gemini key is available.

## Usage

The script is at `scripts/generate_image.py` **relative to this skill's directory** (the directory containing this `SKILL.md`). Resolve the full path from the skill's location before running. Do not hardcode `~/.codex/...`, because the skill may be installed in a different location.

Keep the distinction clear:
- The **script path** tells you where to find `generate_image.py`.
- The **output path** is controlled by the current working directory plus `--filename`.
- Run from the user's working directory so relative filenames save output there, not in the skill directory.

**Generate new image:**
```bash
uv run <this-skill-directory>/scripts/generate_image.py --prompt "your image description" --filename "output-name.png" [--resolution 1K|2K|4K] [--provider auto|openai|gemini] [--model MODEL] [--openai-api-key KEY | --gemini-api-key KEY]
```

**Edit existing image:**
```bash
uv run <this-skill-directory>/scripts/generate_image.py --prompt "editing instructions" --filename "output-name.png" --input-image "path/to/input.png" [--resolution 1K|2K|4K] [--provider auto|openai|gemini] [--model MODEL] [--openai-api-key KEY | --gemini-api-key KEY]
```

**Important:** Always run from the user's current working directory so images are saved where the user is working, not in the skill directory.

## Default Workflow (draft → iterate → final)

Goal: fast iteration without burning time on 4K until the prompt is correct.

- Draft (1K): quick feedback loop
  - `uv run <this-skill-directory>/scripts/generate_image.py --prompt "<draft prompt>" --filename "yyyy-mm-dd-hh-mm-ss-draft.png" --resolution 1K`
- Iterate: adjust prompt in small diffs; keep filename new per run
  - If editing: keep the same `--input-image` for every iteration until you’re happy.
- Final (4K): only when prompt is locked
  - `uv run <this-skill-directory>/scripts/generate_image.py --prompt "<final prompt>" --filename "yyyy-mm-dd-hh-mm-ss-final.png" --resolution 4K`

## Resolution Options

The script accepts three resolution tiers (uppercase K required):

- **1K** (default) - ~1024px
- **2K** - ~2048px
- **4K** - ~4096px (Gemini) / **3840×2160 landscape** under OpenAI

Map user requests to API parameters:
- No mention of resolution → `1K`
- "low resolution", "1080", "1080p", "1K" → `1K`
- "2K", "2048", "normal", "medium resolution" → `2K`
- "high resolution", "high-res", "hi-res", "4K", "ultra" → `4K`

**OpenAI 4K note:** `gpt-image-2` supports non-square 4K outputs within its size limits. `--resolution 4K` with OpenAI maps to `3840×2160`.

## Provider & Model Selection

Two providers are available:

| Provider | Default model                        | When chosen                                                  |
| -------- | ------------------------------------ | ------------------------------------------------------------ |
| OpenAI   | `gpt-image-2`                        | `--provider auto` (default) when `OPENAI_API_KEY` is set, or `--provider openai` |
| Gemini   | `gemini-3.1-flash-image-preview`     | `--provider auto` when only `GEMINI_API_KEY` is set, or `--provider gemini`, or as runtime fallback from a failed auto-OpenAI call |

Override either default with `--model`. Note: the model name is provider-specific; passing a Gemini model name while the script falls back to Gemini automatically will not preserve a user-specified OpenAI model (each provider uses its own default during fallback).

Common model options:
- **OpenAI:** `gpt-image-2` (default)
- **Gemini:** `gemini-3.1-flash-image-preview` (default, fast), `gemini-3-pro-image-preview` (higher quality, slower)

## API Keys

The script resolves provider-specific keys first, while preserving the original Gemini-only `--api-key` behavior:

1. Explicit, provider-specific flags: `--openai-api-key KEY`, `--gemini-api-key KEY`
2. Generic `--api-key KEY` — kept for backward compatibility with the original Gemini-only script. Under `auto`, it is treated as a Gemini key unless an OpenAI key is provided by `--openai-api-key` or `OPENAI_API_KEY`. Under explicit `--provider openai`, it is treated as an OpenAI key; under explicit `--provider gemini`, it is treated as a Gemini key.
3. Environment variables: `OPENAI_API_KEY`, `GEMINI_API_KEY`

When `--provider auto` is selected and OpenAI fails at runtime, fallback to Gemini requires `--gemini-api-key`, `--api-key`, or the `GEMINI_API_KEY` env var.

If no key is resolvable for the chosen provider, the script exits with a clear error message listing both ways to fix it.

## Preflight + Common Failures (fast fixes)

- Preflight:
  - `command -v uv` (must exist)
  - At least one of: `test -n "$OPENAI_API_KEY" -o -n "$GEMINI_API_KEY"` (or pass `--openai-api-key`, `--gemini-api-key`, or backward-compatible `--api-key`)
  - If editing: `test -f "path/to/input.png"`

- Common failures:
  - `Error: No API key found...` → set `OPENAI_API_KEY` or `GEMINI_API_KEY`, or pass an explicit `--*-api-key` flag
  - `Error loading input image:` → wrong path / unreadable file; verify `--input-image` points to a real image
  - `[warn] OpenAI call failed (...); falling back to Gemini.` → informational; a Gemini key was available and produced the image. Investigate the OpenAI error separately (quota, moderation, network)
  - "quota/permission/403" style errors with no fallback → no Gemini key available, or user used `--provider openai` (explicit provider disables fallback). Try a different key, or drop the explicit provider to enable fallback

## Filename Generation

Generate filenames with the pattern: `yyyy-mm-dd-hh-mm-ss-name.png`

**Format:** `{timestamp}-{descriptive-name}.png`
- Timestamp: Current date/time in format `yyyy-mm-dd-hh-mm-ss` (24-hour format)
- Name: Descriptive lowercase text with hyphens
- Keep the descriptive part concise (1-5 words typically)
- Use context from user's prompt or conversation
- If unclear, use random identifier (e.g., `x9k2`, `a7b3`)

Examples:
- Prompt "A serene Japanese garden" → `2025-11-23-14-23-05-japanese-garden.png`
- Prompt "sunset over mountains" → `2025-11-23-15-30-12-sunset-mountains.png`
- Prompt "create an image of a robot" → `2025-11-23-16-45-33-robot.png`
- Unclear context → `2025-11-23-17-12-48-x9k2.png`

## Image Editing

When the user wants to modify an existing image:
1. Check if they provide an image path or reference an image in the current directory
2. Use `--input-image` parameter with the path to the image
3. The prompt should contain editing instructions (e.g., "make the sky more dramatic", "remove the person", "change to cartoon style")
4. Common editing tasks: add/remove elements, change style, adjust colors, blur background, etc.

## Prompt Handling

**For generation:** Pass user's image description as-is to `--prompt`. Only rework if clearly insufficient.

**For editing:** Pass editing instructions in `--prompt` (e.g., "add a rainbow in the sky", "make it look like a watercolor painting")

Preserve user's creative intent in both cases.

## Prompt Templates (high hit-rate)

Use templates when the user is vague or when edits must be precise.

- Generation template:
  - “Create an image of: <subject>. Style: <style>. Composition: <camera/shot>. Lighting: <lighting>. Background: <background>. Color palette: <palette>. Avoid: <list>.”

- Editing template (preserve everything else):
  - “Change ONLY: <single change>. Keep identical: subject, composition/crop, pose, lighting, color palette, background, text, and overall style. Do not add new objects. If text exists, keep it unchanged.”

## Output

- Saves PNG to current directory (or specified path if filename includes directory)
- Script outputs the full path to the generated image
- **Do not read the image back** - just inform the user of the saved path

## Examples

**Generate new image (auto provider):**
```bash
uv run <this-skill-directory>/scripts/generate_image.py --prompt "A serene Japanese garden with cherry blossoms" --filename "2025-11-23-14-23-05-japanese-garden.png" --resolution 2K
```

**Force Gemini:**
```bash
uv run <this-skill-directory>/scripts/generate_image.py --prompt "A serene Japanese garden with cherry blossoms" --filename "2025-11-23-14-23-05-japanese-garden-4k.png" --resolution 4K --provider gemini
```

**Edit existing image (auto provider):**
```bash
uv run <this-skill-directory>/scripts/generate_image.py --prompt "make the sky more dramatic with storm clouds" --filename "2025-11-23-14-25-30-dramatic-sky.png" --input-image "original-photo.jpg" --resolution 2K
```
