"""
gemini_image_core.py — Distilled core Gemini API functions from PaperBanana.

Two essential capabilities:
  1. VLM: Send text (+ optional images) → get text back (planning, critique, etc.)
  2. Image Gen: Send text prompt → get image back

Model tiers (all work with free GOOGLE_API_KEY from aistudio.google.com):

  PRESETS["free"]  — gemini-2.5-flash + gemini-2.5-flash-image (fastest, free)
  PRESETS["pro"]   — gemini-3.1-pro-preview + gemini-3-pro-image (best quality)
  PRESETS["ultra"] — gemini-3.1-pro-preview + imagen-4.0-ultra (highest res images)
  PRESETS["nano"]  — gemini-2.5-flash + nano-banana-pro-preview (academic diagrams)

Usage:
    from gemini_image_core import GeminiCore

    # Free tier (default)
    core = GeminiCore()

    # Pro tier
    core = GeminiCore.from_preset("pro")

    # Ultra images + pro VLM
    core = GeminiCore.from_preset("ultra")

    # Generate an image from a text prompt
    img = await core.generate_image("A NeurIPS-style diagram of a transformer")
    img.save("output.png")

    # Ask VLM to analyze/plan/critique (text-only)
    response = await core.vlm("Describe a 2-panel layout for this method: ...")

    # Ask VLM with an image (e.g., critique a generated diagram)
    from PIL import Image
    img = Image.open("diagram.png")
    critique = await core.vlm("Critique this diagram for accuracy", images=[img])

    # Full pipeline: prompt → plan → style → render → critique → refine
    result = await core.pipeline(
        source_context="Method description with LaTeX...",
        caption="Figure 1. Overview of our method.",
        iterations=2,
    )
    result["image"].save("figure1.png")

Requires:
    pip install google-genai pillow tenacity
    export GOOGLE_API_KEY="your-key"  # free from https://aistudio.google.com/app/apikey
"""

from __future__ import annotations

import asyncio
import base64
import io
import json
import os
from pathlib import Path
from typing import Optional

from PIL import Image
from tenacity import retry, stop_after_attempt, wait_exponential

# ---------------------------------------------------------------------------
# Model presets
# ---------------------------------------------------------------------------

PRESETS = {
    "free": {
        "vlm_model": "gemini-2.5-flash",
        "image_model": "gemini-2.5-flash-image",
        "image_api": "generate_content",  # uses generateContent with IMAGE modality
    },
    "pro": {
        "vlm_model": "gemini-3.1-pro-preview",
        "image_model": "gemini-3-pro-image",
        "image_api": "generate_content",
    },
    "ultra": {
        "vlm_model": "gemini-3.1-pro-preview",
        "image_model": "imagen-4.0-ultra-generate-001",
        "image_api": "generate_images",  # uses Imagen API (generate_images)
    },
    "nano": {
        "vlm_model": "gemini-2.5-flash",
        "image_model": "nano-banana-pro-preview",
        "image_api": "generate_content",
    },
}

# ---------------------------------------------------------------------------
# Core wrapper
# ---------------------------------------------------------------------------

class GeminiCore:
    """Minimal wrapper around Google Gemini for VLM + image generation."""

    def __init__(
        self,
        api_key: Optional[str] = None,
        vlm_model: str = "gemini-2.5-flash",
        image_model: str = "gemini-2.5-flash-image",
        image_api: str = "generate_content",
    ):
        from google import genai

        self.api_key = api_key or os.environ.get("GOOGLE_API_KEY")
        if not self.api_key:
            raise ValueError(
                "No API key. Set GOOGLE_API_KEY env var or pass api_key=. "
                "Free key: https://aistudio.google.com/app/apikey"
            )
        self.client = genai.Client(api_key=self.api_key)
        self.vlm_model = vlm_model
        self.image_model = image_model
        self.image_api = image_api  # "generate_content" or "generate_images"

    @classmethod
    def from_preset(cls, preset: str = "free", **kwargs) -> "GeminiCore":
        """Create from a named preset: 'free', 'pro', 'ultra', 'nano'."""
        if preset not in PRESETS:
            raise ValueError(f"Unknown preset '{preset}'. Choose: {list(PRESETS)}")
        cfg = {**PRESETS[preset], **kwargs}
        return cls(**cfg)

    # --- VLM: text (+images) → text ---

    @retry(stop=stop_after_attempt(5), wait=wait_exponential(min=2, max=60))
    async def vlm(
        self,
        prompt: str,
        images: Optional[list[Image.Image]] = None,
        system_prompt: Optional[str] = None,
        temperature: float = 0.7,
        max_tokens: int = 4096,
        json_mode: bool = False,
    ) -> str:
        """Send text (+ optional images) to Gemini VLM, get text back.

        Args:
            prompt: The user prompt.
            images: Optional list of PIL Image objects to include.
            system_prompt: Optional system instruction.
            temperature: Sampling temperature (0.0-2.0).
            max_tokens: Max output tokens.
            json_mode: If True, request JSON response format.

        Returns:
            Model response text.
        """
        from google.genai import types

        contents = []

        # Add images first (if any)
        if images:
            for img in images:
                buf = io.BytesIO()
                img.save(buf, format="PNG")
                contents.append(
                    types.Part.from_bytes(data=buf.getvalue(), mime_type="image/png")
                )

        # Add text prompt
        contents.append(prompt)

        config = types.GenerateContentConfig(
            temperature=temperature,
            max_output_tokens=max_tokens,
        )
        if system_prompt:
            config.system_instruction = system_prompt
        if json_mode:
            config.response_mime_type = "application/json"

        response = self.client.models.generate_content(
            model=self.vlm_model,
            contents=contents,
            config=config,
        )
        return response.text

    # --- Image Gen: text → image ---

    @retry(stop=stop_after_attempt(3), wait=wait_exponential(min=1, max=10))
    async def generate_image(
        self,
        prompt: str,
        width: int = 1792,
        height: int = 1024,
        seed: Optional[int] = None,
    ) -> Image.Image:
        """Generate an image from a text prompt.

        Automatically routes to the correct API based on image_model:
        - Gemini models (gemini-*, nano-banana-*): uses generate_content
        - Imagen models (imagen-*): uses generate_images

        Args:
            prompt: Detailed description of the image to generate.
            width: Target width (used for aspect ratio selection).
            height: Target height (used for aspect ratio selection).
            seed: Optional seed for reproducibility.

        Returns:
            PIL Image object.
        """
        if self.image_api == "generate_images":
            return await self._generate_via_imagen(prompt, width, height, seed)
        else:
            return await self._generate_via_content(prompt, width, height)

    async def _generate_via_content(
        self, prompt: str, width: int, height: int
    ) -> Image.Image:
        """Image gen via generateContent API (Gemini native image models)."""
        from google.genai import types

        aspect = self._aspect_ratio(width, height)
        size = self._resolution_tier(width, height)

        config = types.GenerateContentConfig(
            response_modalities=["IMAGE"],
            image_config=types.ImageConfig(
                aspect_ratio=aspect,
                image_size=size,
            ),
        )

        response = self.client.models.generate_content(
            model=self.image_model,
            contents=prompt,
            config=config,
        )

        return self._extract_image_from_content(response)

    async def _generate_via_imagen(
        self, prompt: str, width: int, height: int, seed: Optional[int]
    ) -> Image.Image:
        """Image gen via Imagen API (generate_images endpoint)."""
        from google.genai import types

        config = types.GenerateImagesConfig(number_of_images=1)

        response = self.client.models.generate_images(
            model=self.image_model,
            prompt=prompt,
            config=config,
        )

        gi = response.generated_images[0]
        # google-genai Image → PIL via internal _pil_image
        if hasattr(gi.image, "_pil_image"):
            return gi.image._pil_image
        # Fallback: use image_bytes
        if hasattr(gi.image, "image_bytes") and gi.image.image_bytes:
            return Image.open(io.BytesIO(gi.image.image_bytes))
        raise RuntimeError("Could not extract PIL image from Imagen response")

    @staticmethod
    def _extract_image_from_content(response) -> Image.Image:
        """Extract PIL Image from a generateContent response."""
        candidate = response.candidates[0]
        part = candidate.content.parts[0]

        genai_img = part.as_image()

        # google-genai Image wraps PIL internally
        if hasattr(genai_img, "_pil_image"):
            return genai_img._pil_image
        # Try image_bytes
        if hasattr(genai_img, "image_bytes") and genai_img.image_bytes:
            return Image.open(io.BytesIO(genai_img.image_bytes))
        # Try as PIL directly (older SDK versions)
        if isinstance(genai_img, Image.Image):
            return genai_img
        raise RuntimeError("Could not extract PIL image from response")

    @staticmethod
    def _aspect_ratio(width: int, height: int) -> str:
        ratio = width / height
        if ratio > 1.6:
            return "16:9"
        elif ratio > 1.3:
            return "3:2"
        elif ratio > 0.8:
            return "1:1"
        elif ratio > 0.55:
            return "2:3"
        else:
            return "9:16"

    @staticmethod
    def _resolution_tier(width: int, height: int) -> str:
        max_dim = max(width, height)
        if max_dim <= 1024:
            return "1K"
        elif max_dim <= 2048:
            return "2K"
        else:
            return "4K"

    # --- Mini pipeline: plan → style → render → critique → refine ---

    async def pipeline(
        self,
        source_context: str,
        caption: str,
        iterations: int = 2,
        output_dir: Optional[str] = None,
    ) -> dict:
        """Full pipeline: plan → style → render → critique → refine.

        Args:
            source_context: Method description (the SOP prompt or raw text).
            caption: Figure caption.
            iterations: Max critique-refine iterations.
            output_dir: Optional directory to save intermediate files.

        Returns:
            dict with keys: "image" (PIL Image), "description" (str),
            "critique" (str or None), "iterations_used" (int).
        """
        if output_dir:
            Path(output_dir).mkdir(parents=True, exist_ok=True)

        # Phase 1: Plan
        plan = await self.vlm(
            prompt=(
                "I need a detailed visual description for a scientific diagram.\n\n"
                f"## Methodology\n{source_context}\n\n"
                f"## Caption\n{caption}\n\n"
                "Describe every visual element: layout, boxes, arrows, colors, "
                "labels, math notation, flow direction. Be specific about "
                "spatial arrangement and styling. Use natural language for "
                "colors (e.g., 'soft sky blue', not hex codes)."
            ),
            temperature=0.7,
        )

        # Phase 1: Style refinement
        description = await self.vlm(
            prompt=(
                "You are a visual designer for top-tier AI conferences.\n\n"
                "Refine this diagram description for professional NeurIPS/ICML "
                "aesthetics. Use soft pastel tones, clean sans-serif labels, "
                "rounded rectangles, and clear data flow. Preserve ALL content "
                "and math. Output ONLY the refined description.\n\n"
                f"## Description\n{plan}"
            ),
            temperature=0.5,
        )

        # Phase 2: Iterative render + critique
        image = None
        critique_text = None
        iterations_used = 0

        for i in range(iterations):
            iterations_used = i + 1

            # Render
            render_prompt = (
                "You are an expert scientific diagram illustrator. Generate a "
                "high-quality diagram. Do not include figure titles in the image. "
                "All text must be clear, readable English. Use EXACT label names "
                f"from the description.\n\n{description}"
            )
            image = await self.generate_image(render_prompt)

            if output_dir:
                image.save(Path(output_dir) / f"iter_{i + 1}.png")

            # Critique
            critique_json = await self.vlm(
                prompt=(
                    "Critique this scientific diagram.\n\n"
                    f"## Methodology\n{source_context}\n\n"
                    f"## Caption\n{caption}\n\n"
                    f"## Description\n{description}\n\n"
                    "Check: (1) fidelity to methodology, (2) typos/garbled text, "
                    "(3) missing elements, (4) visual clarity.\n\n"
                    'Return JSON: {"critic_suggestions": ["..."], '
                    '"revised_description": "..." or null if publication-ready}'
                ),
                images=[image],
                temperature=0.3,
                json_mode=True,
            )

            try:
                critique = json.loads(critique_json)
            except json.JSONDecodeError:
                break

            critique_text = "; ".join(critique.get("critic_suggestions", []))

            if not critique.get("revised_description"):
                break

            description = critique["revised_description"]

        if output_dir and image:
            image.save(Path(output_dir) / "final.png")

        return {
            "image": image,
            "description": description,
            "critique": critique_text,
            "iterations_used": iterations_used,
        }


# ---------------------------------------------------------------------------
# CLI convenience
# ---------------------------------------------------------------------------

def main():
    """Quick CLI for image generation and pipelines.

    Usage:
        python gemini_image_core.py "prompt" [output.png] [--preset pro]
        python gemini_image_core.py --pipeline prompt_file.md [output_dir] [--preset ultra]
        python gemini_image_core.py --list-presets
    """
    import sys

    args = [a for a in sys.argv[1:] if not a.startswith("--preset")]
    preset = "free"
    for i, a in enumerate(sys.argv):
        if a == "--preset" and i + 1 < len(sys.argv):
            preset = sys.argv[i + 1]

    if not args or args[0] == "--help":
        print("Usage:")
        print('  python gemini_image_core.py "prompt" [output.png] [--preset pro]')
        print("  python gemini_image_core.py --pipeline prompt.md [out_dir] [--preset ultra]")
        print("  python gemini_image_core.py --list-presets")
        print(f"\nPresets: {list(PRESETS.keys())}")
        sys.exit(0)

    if args[0] == "--list-presets":
        for name, cfg in PRESETS.items():
            print(f"  {name:6s}  VLM: {cfg['vlm_model']:30s}  Image: {cfg['image_model']}")
        sys.exit(0)

    core = GeminiCore.from_preset(preset)
    print(f"Using preset '{preset}': VLM={core.vlm_model}, Image={core.image_model}")

    if args[0] == "--pipeline":
        prompt_file = args[1]
        out_dir = args[2] if len(args) > 2 else "./pipeline_output"
        with open(prompt_file) as f:
            text = f.read()
        result = asyncio.run(
            core.pipeline(source_context=text, caption="", output_dir=out_dir)
        )
        print(f"Done. {result['iterations_used']} iterations. Output: {out_dir}/final.png")
    else:
        prompt = args[0]
        out_path = args[1] if len(args) > 1 else "output.png"
        image = asyncio.run(core.generate_image(prompt))
        image.save(out_path)
        print(f"Saved to {out_path} ({image.size[0]}x{image.size[1]})")


if __name__ == "__main__":
    main()
