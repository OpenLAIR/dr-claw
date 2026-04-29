#!/usr/bin/env python3
# /// script
# requires-python = ">=3.10"
# dependencies = [
#     "google-genai>=1.0.0",
#     "openai>=1.40.0",
#     "pillow>=10.0.0",
# ]
# ///
"""
Generate images using OpenAI gpt-image-2 (default) or Google Gemini (fallback).

Provider selection (auto, the default):
  1. If OPENAI_API_KEY is available -> OpenAI (gpt-image-2)
  2. Else if --api-key or GEMINI_API_KEY is available -> Gemini (gemini-3.1-flash-image-preview)
  3. Else -> error listing both fix options

If auto picks OpenAI and the call itself fails (quota, moderation, network),
the script transparently falls back to Gemini when a Gemini key is available.
Use --provider to force a specific provider (no fallback is performed when the
provider is set explicitly).

Usage:
    uv run generate_image.py --prompt "..." --filename "out.png"
        [--resolution 1K|2K|4K]
        [--provider auto|openai|gemini]
        [--model MODEL]
        [--openai-api-key KEY | --gemini-api-key KEY | --api-key KEY]
"""

import argparse
import base64
import os
import sys
from io import BytesIO
from pathlib import Path


DEFAULT_MODELS = {
    "openai": "gpt-image-2",
    "gemini": "gemini-3.1-flash-image-preview",
}

# OpenAI gpt-image-2 supports larger non-square sizes within its limits.
OPENAI_SIZE_MAP = {
    "1K": "1024x1024",
    "2K": "2048x2048",
    "4K": "3840x2160",
}


def get_openai_key(provided: str | None) -> str | None:
    return provided or os.environ.get("OPENAI_API_KEY")


def get_gemini_key(provided: str | None) -> str | None:
    return provided or os.environ.get("GEMINI_API_KEY")


def _fatal_missing_key(which: str | None) -> None:
    if which == "openai":
        print("Error: --provider openai requires an OpenAI API key.", file=sys.stderr)
        print("  Set OPENAI_API_KEY or pass --openai-api-key KEY.", file=sys.stderr)
    elif which == "gemini":
        print("Error: --provider gemini requires a Gemini API key.", file=sys.stderr)
        print("  Set GEMINI_API_KEY or pass --gemini-api-key KEY.", file=sys.stderr)
    else:
        print("Error: No API key found for image generation.", file=sys.stderr)
        print("Please either:", file=sys.stderr)
        print("  1. Set OPENAI_API_KEY (default provider: gpt-image-2)", file=sys.stderr)
        print("  2. Set GEMINI_API_KEY (fallback provider: gemini-3.1-flash-image-preview)", file=sys.stderr)
        print("  3. Pass --openai-api-key KEY, --gemini-api-key KEY, or --api-key KEY", file=sys.stderr)
    sys.exit(1)


def resolve_provider(args) -> tuple[str, str]:
    """Pick a provider and API key from flags + env vars.

    The generic --api-key flag remains backward-compatible with the original
    Gemini-only script: under auto it is used as a Gemini key unless an OpenAI
    key is provided explicitly or via OPENAI_API_KEY.
    """
    if args.provider == "openai":
        key = get_openai_key(args.openai_api_key or args.api_key)
        if not key:
            _fatal_missing_key("openai")
        return "openai", key

    if args.provider == "gemini":
        key = get_gemini_key(args.gemini_api_key or args.api_key)
        if not key:
            _fatal_missing_key("gemini")
        return "gemini", key

    # auto
    openai_key = get_openai_key(args.openai_api_key)
    if openai_key:
        return "openai", openai_key
    gemini_key = get_gemini_key(args.gemini_api_key or args.api_key)
    if gemini_key:
        return "gemini", gemini_key
    _fatal_missing_key(None)
    raise SystemExit(1)  # unreachable; for type-checkers


def save_pil_as_png(image, output_path: Path) -> None:
    """Normalize a PIL image to RGB and save as PNG, flattening alpha over white."""
    from PIL import Image as PILImage

    if image.mode == "RGBA":
        rgb = PILImage.new("RGB", image.size, (255, 255, 255))
        rgb.paste(image, mask=image.split()[3])
        rgb.save(str(output_path), "PNG")
    elif image.mode == "RGB":
        image.save(str(output_path), "PNG")
    else:
        image.convert("RGB").save(str(output_path), "PNG")


def generate_with_openai(
    api_key: str,
    model: str,
    prompt: str,
    input_image_path: str | None,
    resolution: str,
    output_path: Path,
) -> None:
    from openai import OpenAI
    from PIL import Image as PILImage

    size = OPENAI_SIZE_MAP.get(resolution, "1024x1024")

    client = OpenAI(api_key=api_key)

    if input_image_path:
        print(f"Editing image via OpenAI ({model}, size={size})...")
        with open(input_image_path, "rb") as fh:
            result = client.images.edit(
                model=model,
                image=fh,
                prompt=prompt,
                size=size,
            )
    else:
        print(f"Generating image via OpenAI ({model}, size={size})...")
        result = client.images.generate(
            model=model,
            prompt=prompt,
            size=size,
        )

    if not result.data:
        raise RuntimeError("OpenAI returned no image data")
    b64 = result.data[0].b64_json
    if not b64:
        raise RuntimeError("OpenAI response missing b64_json payload")
    image_bytes = base64.b64decode(b64)
    image = PILImage.open(BytesIO(image_bytes))
    save_pil_as_png(image, output_path)


def generate_with_gemini(
    api_key: str,
    model: str,
    prompt: str,
    input_image_pil,
    resolution: str,
    output_path: Path,
) -> None:
    from google import genai
    from google.genai import types
    from PIL import Image as PILImage

    client = genai.Client(api_key=api_key)

    if input_image_pil is not None:
        contents = [input_image_pil, prompt]
        print(f"Editing image via Gemini ({model}, resolution={resolution})...")
    else:
        contents = prompt
        print(f"Generating image via Gemini ({model}, resolution={resolution})...")

    response = client.models.generate_content(
        model=model,
        contents=contents,
        config=types.GenerateContentConfig(
            response_modalities=["TEXT", "IMAGE"],
            image_config=types.ImageConfig(image_size=resolution),
        ),
    )

    image_saved = False
    for part in response.parts:
        if part.text is not None:
            print(f"Model response: {part.text}")
        elif part.inline_data is not None:
            image_data = part.inline_data.data
            if isinstance(image_data, str):
                image_data = base64.b64decode(image_data)
            image = PILImage.open(BytesIO(image_data))
            save_pil_as_png(image, output_path)
            image_saved = True

    if not image_saved:
        raise RuntimeError("No image was generated in the Gemini response")


def load_input_image_if_any(args) -> tuple[object, str]:
    """Open the input image (if any) and derive an effective resolution.

    Returns (pil_image_or_None, resolution). When the user left the resolution
    at the default of 1K, we scale the request up to match the input image.
    """
    if not args.input_image:
        return None, args.resolution

    from PIL import Image as PILImage

    try:
        pil = PILImage.open(args.input_image)
    except Exception as e:
        print(f"Error loading input image: {e}", file=sys.stderr)
        sys.exit(1)

    print(f"Loaded input image: {args.input_image}")
    resolution = args.resolution
    if resolution == "1K":  # default value — auto-detect from input dims
        width, height = pil.size
        max_dim = max(width, height)
        if max_dim >= 3000:
            resolution = "4K"
        elif max_dim >= 1500:
            resolution = "2K"
        print(f"Auto-detected resolution: {resolution} (from input {width}x{height})")
    return pil, resolution


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Generate/edit images with OpenAI gpt-image-2 (default) or Gemini (fallback)."
    )
    parser.add_argument("--prompt", "-p", required=True, help="Image description/prompt")
    parser.add_argument("--filename", "-f", required=True, help="Output filename")
    parser.add_argument("--input-image", "-i", help="Optional input image path for editing")
    parser.add_argument(
        "--resolution", "-r",
        choices=["1K", "2K", "4K"],
        default="1K",
        help="Output resolution: 1K (default), 2K, or 4K",
    )
    parser.add_argument(
        "--provider",
        choices=["auto", "openai", "gemini"],
        default="auto",
        help="Provider to use. auto (default): OpenAI if OPENAI_API_KEY is set, else Gemini.",
    )
    parser.add_argument(
        "--api-key", "-k",
        help="Backward-compatible generic key: Gemini under auto/gemini, OpenAI under openai",
    )
    parser.add_argument("--openai-api-key", help="Explicit OpenAI API key (overrides --api-key for OpenAI)")
    parser.add_argument("--gemini-api-key", help="Explicit Gemini API key (overrides --api-key for Gemini)")
    parser.add_argument(
        "--model", "-m",
        default=None,
        help="Model override (default: gpt-image-2 for OpenAI, gemini-3.1-flash-image-preview for Gemini)",
    )

    args = parser.parse_args()

    provider, api_key = resolve_provider(args)
    model = args.model or DEFAULT_MODELS[provider]

    output_path = Path(args.filename)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    input_pil, effective_resolution = load_input_image_if_any(args)

    def _dispatch(prov: str, key: str, mdl: str) -> None:
        if prov == "openai":
            generate_with_openai(
                key, mdl, args.prompt, args.input_image, effective_resolution, output_path
            )
        else:
            generate_with_gemini(
                key, mdl, args.prompt, input_pil, effective_resolution, output_path
            )

    try:
        _dispatch(provider, api_key, model)
    except Exception as e:
        # Transparent fallback only when provider was auto-selected to OpenAI.
        # Explicit --provider openai respects the user's intent and does not fall back.
        if provider == "openai" and args.provider == "auto":
            gemini_key = get_gemini_key(args.gemini_api_key or args.api_key)
            if gemini_key:
                print(
                    f"[warn] OpenAI call failed ({e}); falling back to Gemini.",
                    file=sys.stderr,
                )
                try:
                    _dispatch("gemini", gemini_key, DEFAULT_MODELS["gemini"])
                except Exception as ge:
                    print(f"Error generating image (Gemini fallback): {ge}", file=sys.stderr)
                    sys.exit(1)
            else:
                print(f"Error generating image: {e}", file=sys.stderr)
                sys.exit(1)
        else:
            print(f"Error generating image: {e}", file=sys.stderr)
            sys.exit(1)

    print(f"\nImage saved: {output_path.resolve()}")


if __name__ == "__main__":
    main()
