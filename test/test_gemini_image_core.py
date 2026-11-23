"""Offline regression checks for the Gemini image preset."""

import base64
import io
import json
import unittest
from unittest.mock import patch

import httpx
from google import genai
from google.genai import types
from PIL import Image

from scripts.gemini_image_core import GeminiCore


class GeminiImageCoreTest(unittest.IsolatedAsyncioTestCase):
    async def test_pro_preset_uses_the_stable_model_on_generate_content(self):
        image_bytes = io.BytesIO()
        Image.new("RGB", (32, 32), color="blue").save(image_bytes, "PNG")
        encoded = base64.b64encode(image_bytes.getvalue()).decode()
        requests = []

        def respond(request):
            requests.append(request)
            return httpx.Response(
                200,
                json={
                    "candidates": [
                        {
                            "content": {
                                "role": "model",
                                "parts": [
                                    {
                                        "inlineData": {
                                            "mimeType": "image/png",
                                            "data": encoded,
                                        }
                                    }
                                ],
                            }
                        }
                    ]
                },
            )

        with httpx.Client(transport=httpx.MockTransport(respond)) as transport:
            with genai.Client(
                api_key="test-key",
                vertexai=False,
                http_options=types.HttpOptions(httpx_client=transport),
            ) as client:
                with patch("google.genai.Client", return_value=client):
                    core = GeminiCore.from_preset("pro", api_key="test-key")
                    image = await core.generate_image("Draw a blue diagram", 1536, 1024)

        self.assertEqual(image.getpixel((0, 0)), (0, 0, 255))
        self.assertEqual(core.vlm_model, "gemini-3.1-pro-preview")
        self.assertEqual(len(requests), 1)
        request = requests[0]
        self.assertEqual(request.url.host, "generativelanguage.googleapis.com")
        self.assertTrue(request.url.path.endswith("/gemini-3-pro-image:generateContent"))
        config = json.loads(request.content)["generationConfig"]
        self.assertEqual(config["responseModalities"], ["IMAGE"])
        self.assertEqual(config["imageConfig"], {"aspectRatio": "3:2", "imageSize": "2K"})

    def test_explicit_models_and_other_presets_keep_their_routes(self):
        with patch("google.genai.Client"):
            pro = GeminiCore.from_preset("pro", api_key="test-key", image_model="custom-image")
            free = GeminiCore.from_preset("free", api_key="test-key")
            ultra = GeminiCore.from_preset("ultra", api_key="test-key")

        self.assertEqual(pro.image_model, "custom-image")
        self.assertEqual(free.image_model, "gemini-2.5-flash-image")
        self.assertEqual(ultra.image_api, "generate_images")
