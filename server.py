"""PixelKit production server and password-gated local BiRefNet inference."""

from __future__ import annotations

import asyncio
import base64
import gc
import hmac
import io
import json
import os
from collections import Counter
from pathlib import Path
from typing import Annotated

import cv2
import numpy as np
from fastapi import FastAPI, File, Form, Header, HTTPException, UploadFile
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from PIL import Image, ImageOps
from pydantic import BaseModel


ROOT = Path(__file__).resolve().parent
PASSWORD = os.environ.get("PIXELKIT_BIREFNET_PASSWORD", "ciao")
MAX_UPLOAD_BYTES = 50 * 1024 * 1024
MAX_SOURCE_PIXELS = 80_000_000
MODELS = {
    "General Use (Light)": "ZhengPeng7/BiRefNet",
    "General Use (Light 2K)": "ZhengPeng7/BiRefNet_lite-2K",
    "General Use (Heavy)": "ZhengPeng7/BiRefNet_lite",
    "Matting": "ZhengPeng7/BiRefNet-matting",
    "Portrait": "ZhengPeng7/BiRefNet-portrait",
    "General Use (Dynamic)": "ZhengPeng7/BiRefNet_dynamic",
}
RESOLUTIONS = {"1024x1024": 1024, "2048x2048": 2048, "2304x2304": 2304}
FORMATS = {"png": ("PNG", "image/png"), "webp": ("WEBP", "image/webp"), "gif": ("GIF", "image/gif")}

app = FastAPI(title="PixelKit BiRefNet", docs_url=None, redoc_url=None)
inference_lock = asyncio.Lock()
loaded_model = None
loaded_model_id = None


def authorized(candidate: str | None) -> bool:
    return bool(candidate) and hmac.compare_digest(candidate, PASSWORD)


class UnlockBody(BaseModel):
    password: str


@app.post("/api/birefnet/unlock")
def unlock(body: UnlockBody):
    if not authorized(body.password):
        raise HTTPException(status_code=401, detail="Incorrect BiRefNet password")
    return {"ok": True}


def load_model(model_id: str):
    global loaded_model, loaded_model_id
    if loaded_model is not None and loaded_model_id == model_id:
        return loaded_model
    loaded_model = None
    loaded_model_id = None
    gc.collect()
    import torch
    from transformers import AutoModelForImageSegmentation

    torch.set_num_threads(min(os.cpu_count() or 1, 8))
    torch.set_float32_matmul_precision("high")
    loaded_model = AutoModelForImageSegmentation.from_pretrained(
        model_id, trust_remote_code=True, dtype=torch.float32
    ).to("cpu").eval()
    loaded_model_id = model_id
    return loaded_model


def refine_foreground(image: Image.Image, mask: Image.Image, radius: int = 90) -> Image.Image:
    """Official BiRefNet/fast-foreground-estimation CPU refinement recipe."""
    rgb = np.asarray(image, dtype=np.float32) / 255.0
    alpha = np.asarray(mask, dtype=np.float32)[:, :, None] / 255.0

    def pass_once(fg, bg, r):
        blurred_alpha = cv2.blur(alpha, (r, r))
        if blurred_alpha.ndim == 2:
            blurred_alpha = blurred_alpha[:, :, None]
        blurred_fg = cv2.blur(fg * alpha, (r, r)) / (blurred_alpha + 1e-5)
        blurred_bg = cv2.blur(bg * (1 - alpha), (r, r)) / (1 - blurred_alpha + 1e-5)
        estimate = blurred_fg + alpha * (rgb - alpha * blurred_fg - (1 - alpha) * blurred_bg)
        return np.clip(estimate, 0, 1), blurred_bg

    foreground, background = pass_once(rgb, rgb, radius)
    foreground, _ = pass_once(foreground, background, 6)
    return Image.fromarray((foreground * 255).astype(np.uint8), "RGB")


def sample_border_palette(image: Image.Image, max_colors: int = 4) -> list[list[int]]:
    """Find dominant opaque matte colors around a sprite sheet's border."""
    rgba = np.asarray(image.convert("RGBA"), dtype=np.uint8)
    border = np.concatenate((rgba[0], rgba[-1], rgba[:, 0], rgba[:, -1]), axis=0)
    border = border[border[:, 3] > 127, :3]
    if not len(border):
        return [[255, 255, 255]]
    step = max(1, len(border) // 512)
    quantized = np.minimum(255, np.round(border[::step] / 16) * 16).astype(np.uint8)
    ranked = [list(color) for color, _ in Counter(map(tuple, quantized)).most_common()]
    picked: list[list[int]] = []
    for color in ranked:
        if all(sum((int(a) - int(b)) ** 2 for a, b in zip(color, old)) > 38 ** 2 for old in picked):
            picked.append([int(v) for v in color])
        if len(picked) >= max_colors:
            break
    return picked or [[int(v) for v in np.median(border, axis=0)]]


def recover_soft_shadows(source: Image.Image, cutout: Image.Image, backgrounds: list[list[int]],
                         strength: float = 100, tolerance: int = 12) -> Image.Image:
    """Add neutral matte darkening outside the AI subject as translucent black."""
    src = np.asarray(source.convert("RGBA"), dtype=np.float32)
    out = np.asarray(cutout.convert("RGBA"), dtype=np.float32).copy()
    source_alpha = src[:, :, 3] / 255.0
    subject_alpha = out[:, :, 3] / 255.0
    rgb = src[:, :, :3]
    luma = rgb[:, :, 0] * 0.2126 + rgb[:, :, 1] * 0.7152 + rgb[:, :, 2] * 0.0722
    darkness = np.zeros(subject_alpha.shape, dtype=np.float32)
    for bg in backgrounds:
        bg_arr = np.asarray(bg[:3], dtype=np.float32)
        bg_luma = float(bg_arr @ np.asarray([0.2126, 0.7152, 0.0722]))
        if bg_luma < 8:
            continue
        scale = luma / bg_luma
        neutral = (scale < 1) & (np.max(np.abs(rgb - scale[:, :, None] * bg_arr), axis=2) <= tolerance)
        candidate = np.maximum(0, (1 - scale) - 0.03) / 0.97
        darkness = np.maximum(darkness, np.where(neutral, candidate, 0))

    # AI alpha protects the subject. The remaining matte darkening is
    # un-composited as black so it behaves like a real multiply shadow over
    # checkerboards, game scenes, and exported transparent atlases.
    shadow_alpha = np.minimum(1, darkness * max(0, strength) / 100.0) * source_alpha * (1 - subject_alpha)
    final_alpha = subject_alpha + shadow_alpha
    safe = np.maximum(final_alpha, 1e-6)
    out[:, :, :3] *= (subject_alpha / safe)[:, :, None]
    out[:, :, 3] = final_alpha * 255
    return Image.fromarray(np.clip(out, 0, 255).astype(np.uint8), "RGBA")


def encode_image(image: Image.Image, output_format: str) -> tuple[str, str]:
    fmt, mime = FORMATS[output_format]
    output = io.BytesIO()
    if fmt == "PNG":
        image.save(output, fmt, optimize=True)
    elif fmt == "WEBP":
        image.save(output, fmt, lossless=True, quality=100, method=6)
    else:
        # GIF has 1-bit transparency; PNG/WebP are preferable for soft shadows.
        image.save(output, fmt, save_all=False, transparency=0)
    return "data:" + mime + ";base64," + base64.b64encode(output.getvalue()).decode("ascii"), mime


def infer(source: Image.Image, model_name: str, resolution: str, refine: bool,
          output_mask: bool, mask_only: bool, output_format: str,
          recover_shadows: bool = False, shadow_strength: float = 100,
          shadow_tolerance: int = 12, background_samples: list[list[int]] | None = None,
          shadow_auto_sample: bool = True):
    import torch
    from torchvision.transforms import Normalize, ToTensor

    size = RESOLUTIONS[resolution]
    model = load_model(MODELS[model_name])
    source_rgb = source.convert("RGB")
    resized = source_rgb.resize((size, size), Image.Resampling.LANCZOS)
    tensor = ToTensor()(resized)
    tensor = Normalize([0.485, 0.456, 0.406], [0.229, 0.224, 0.225])(tensor).unsqueeze(0)
    with torch.inference_mode():
        prediction = model(tensor)[-1].sigmoid().float().cpu()[0].squeeze()
    mask_array = (prediction.clamp(0, 1).numpy() * 255).astype(np.uint8)
    mask = Image.fromarray(mask_array, "L").resize(source.size, Image.Resampling.BILINEAR)
    source_alpha = source.getchannel("A") if source.mode == "RGBA" else Image.new("L", source.size, 255)
    mask = Image.fromarray(
        ((np.asarray(mask, dtype=np.float32) / 255) * (np.asarray(source_alpha, dtype=np.float32) / 255) * 255).astype(np.uint8), "L"
    )

    if mask_only:
        result = mask.convert("RGBA")
    else:
        foreground = refine_foreground(source_rgb, mask) if refine else source_rgb
        result = foreground.convert("RGBA")
        result.putalpha(mask)
        if recover_shadows:
            samples = sample_border_palette(source) if shadow_auto_sample or not background_samples else background_samples
            result = recover_soft_shadows(source, result, samples, shadow_strength, shadow_tolerance)
            mask = result.getchannel("A")

    image_uri, image_mime = encode_image(result, output_format)
    mask_uri = encode_image(mask.convert("RGBA"), "png")[0] if output_mask and not mask_only else None
    return {"image": image_uri, "imageMime": image_mime, "mask": mask_uri,
            "width": source.width, "height": source.height}


@app.post("/api/birefnet/remove")
async def remove_background(
    image: Annotated[UploadFile, File()],
    model: Annotated[str, Form()] = "Matting",
    operating_resolution: Annotated[str, Form()] = "1024x1024",
    refine_foreground_enabled: Annotated[bool, Form()] = True,
    output_mask: Annotated[bool, Form()] = True,
    mask_only: Annotated[bool, Form()] = False,
    output_format: Annotated[str, Form()] = "png",
    recover_soft_shadows_enabled: Annotated[bool, Form()] = True,
    shadow_strength: Annotated[float, Form()] = 100,
    shadow_tolerance: Annotated[int, Form()] = 12,
    shadow_auto_sample: Annotated[bool, Form()] = True,
    background_samples: Annotated[str, Form()] = "[]",
    x_pixelkit_password: Annotated[str | None, Header()] = None,
):
    if not authorized(x_pixelkit_password):
        raise HTTPException(status_code=401, detail="Incorrect BiRefNet password")
    if model not in MODELS or operating_resolution not in RESOLUTIONS or output_format not in FORMATS:
        raise HTTPException(status_code=422, detail="Unsupported BiRefNet option")
    if operating_resolution == "2304x2304" and model != "General Use (Dynamic)":
        raise HTTPException(status_code=422, detail="2304x2304 requires General Use (Dynamic)")
    payload = await image.read(MAX_UPLOAD_BYTES + 1)
    if len(payload) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="Image exceeds the 50 MB limit")
    try:
        source = ImageOps.exif_transpose(Image.open(io.BytesIO(payload))).convert("RGBA")
        if source.width * source.height > MAX_SOURCE_PIXELS:
            raise HTTPException(status_code=413, detail="Image exceeds the 80 megapixel limit")
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=415, detail="Could not decode this image") from exc
    try:
        samples = json.loads(background_samples)
        if not isinstance(samples, list) or any(not isinstance(c, list) or len(c) < 3 for c in samples):
            raise ValueError
        samples = [[max(0, min(255, int(v))) for v in c[:3]] for c in samples[:8]]
    except (TypeError, ValueError, json.JSONDecodeError) as exc:
        raise HTTPException(status_code=422, detail="Invalid background samples") from exc
    if not 0 <= shadow_tolerance <= 64 or not 0 <= shadow_strength <= 200:
        raise HTTPException(status_code=422, detail="Invalid soft-shadow settings")

    async with inference_lock:  # one job at a time on this 15 GiB CPU host
        try:
            return await asyncio.to_thread(
                infer, source, model, operating_resolution, refine_foreground_enabled,
                output_mask, mask_only, output_format,
                recover_soft_shadows_enabled and not mask_only, shadow_strength,
                shadow_tolerance, samples, shadow_auto_sample
            )
        except Exception as exc:
            raise HTTPException(status_code=500, detail=f"BiRefNet inference failed: {exc}") from exc


DIST = ROOT / "dist"
if DIST.exists():
    app.mount("/assets", StaticFiles(directory=DIST / "assets"), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    def frontend(path: str):
        candidate = (DIST / path).resolve()
        if candidate.is_file() and DIST.resolve() in candidate.parents:
            return FileResponse(candidate)
        return FileResponse(DIST / "index.html")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=int(os.environ.get("PORT", "8000")))
