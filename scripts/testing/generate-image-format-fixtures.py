#!/usr/bin/env python3
"""用自行绘制的英文短句生成图片翻译端到端测试夹具，不依赖外部图片素材。"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont
import PIL


ROOT = Path(__file__).resolve().parent
DEFAULT_OUTPUT = ROOT / "image-format-fixtures"


def draw_image(label: str, *, transparent: bool = False, icon: bool = False) -> Image.Image:
    """确保各格式有独特句子，避免跨格式测试复用同一翻译缓存。"""
    size = (256, 256) if icon else (512, 256)
    image = Image.new("RGBA", size, (0, 0, 0, 0) if transparent else (255, 255, 255, 255))
    draw = ImageDraw.Draw(image)
    color = (255, 255, 255, 255) if transparent else (0, 0, 0, 255)
    if icon:
        lines = [("Hello reader", 34, 30), ("Please read", 36, 102), ("this icon message", 27, 158)]
    else:
        lines = [("Hello reader", 46, 42), (f"Please read this {label} message", 29, 136)]
    for text, font_size, top in lines:
        font = ImageFont.load_default(size=font_size)
        box = draw.textbbox((0, 0), text, font=font)
        left = (size[0] - (box[2] - box[0])) // 2 - box[0]
        draw.text((left, top), text, fill=color, font=font)
    return image


def palette_gif(image: Image.Image, *, transparent: bool) -> Image.Image:
    if not transparent:
        return image.convert("RGB").quantize(colors=128)
    # GIF 支持二值透明度。保留索引 0 给透明像素，索引 1 给清晰白字。
    alpha = image.getchannel("A")
    result = Image.new("P", image.size, 0)
    result.putpalette([0, 0, 0, 255, 255, 255] + [0] * (768 - 6))
    result.paste(1, mask=alpha.point(lambda value: 255 if value >= 128 else 0))
    result.info["transparency"] = 0
    return result


def generate(output_dir: Path) -> dict:
    output_dir.mkdir(parents=True, exist_ok=True)
    fixtures = []
    specs = [
        ("webp", "WEBP", "image/webp", "WebP", False, False),
        ("gif", "GIF", "image/gif", "GIF", False, False),
        ("bmp", "BMP", "image/bmp", "BMP", False, False),
        ("avif", "AVIF", "image/avif", "AVIF", False, False),
        ("ico", "ICO", "image/x-icon", "icon", False, False),
        ("webp-transparent-white", "WEBP", "image/webp", "clear WebP", True, False),
        ("gif-transparent-white", "GIF", "image/gif", "clear GIF", True, False),
        ("avif-transparent-white", "AVIF", "image/avif", "clear AVIF", True, False),
        ("gif-animated", "GIF", "image/gif", "moving GIF", False, True),
        ("webp-animated", "WEBP", "image/webp", "moving WebP", False, True),
    ]
    for name, image_format, mime, label, transparent, animated in specs:
        image = draw_image(label, transparent=transparent, icon=image_format == "ICO")
        path = output_dir / f"{name}.{image_format.lower()}"
        kwargs = {}
        if image_format == "BMP":
            image = image.convert("RGB")
        if image_format == "WEBP":
            kwargs.update(lossless=True, method=6)
        if image_format == "AVIF":
            kwargs.update(quality=100, subsampling="4:4:4", max_threads=1)
        if image_format == "ICO":
            # 一般 Windows 多尺寸 ICO，同时包含可供 OCR 读取的 256 像素版本。
            kwargs.update(sizes=[(16, 16), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
        if animated:
            # 两帧文字、位置和背景明显不同，可发现 OCR 与重绘使用不同帧的问题。
            second_frame = Image.new("RGBA", image.size, (220, 240, 255, 255))
            second_draw = ImageDraw.Draw(second_frame)
            second_draw.text((36, 72), "Another reader", fill="black", font=ImageFont.load_default(size=42))
            second_draw.text((36, 166), f"This is the second {image_format} frame", fill="black", font=ImageFont.load_default(size=31))
            frames = [image, second_frame]
            if image_format == "GIF":
                frames = [palette_gif(frame, transparent=False) for frame in frames]
            image = frames[0]
            kwargs.update(save_all=True, append_images=frames[1:], duration=800, loop=0)
        elif image_format == "GIF":
            image = palette_gif(image, transparent=transparent)
            if transparent:
                kwargs.update(transparency=0)
        image.save(path, format=image_format, **kwargs)
        encoded = path.read_bytes()
        with Image.open(path) as saved:
            width, height = saved.size
            frames = getattr(saved, "n_frames", 1)
            corner_alpha = saved.convert("RGBA").getpixel((0, 0))[3]
            if frames != (2 if animated else 1):
                raise RuntimeError(f"{name}: encoded frame count is {frames}")
            if transparent != (corner_alpha == 0):
                raise RuntimeError(f"{name}: transparency did not survive encoding")
        fixtures.append({
            "name": name,
            "tag": "baseline" if name in {"webp", "gif", "bmp", "avif", "ico"} else "variant",
            "format": image_format.lower(),
            "file": path.name,
            "mime": mime,
            "width": width,
            "height": height,
            "expectedSource": ["Hello reader", f"Please read this {label} message"],
            "transparentCorner": transparent,
            "transparentProbe": {"x": 0, "y": 0} if transparent else None,
            "frames": frames,
            "durationMs": 800 if animated else None,
            "firstFrameProbe": {"x": 0, "y": 0, "rgba": [255, 255, 255, 255]} if animated else None,
            "bytes": len(encoded),
            "sha256": hashlib.sha256(encoded).hexdigest(),
        })
    manifest = {
        "version": 1,
        "generator": "../generate-image-format-fixtures.py",
        "pillowVersion": PIL.__version__,
        "fixtures": fixtures,
    }
    (output_dir / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n")
    return manifest


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()
    manifest = generate(args.output_dir)
    print(json.dumps({"fixtures": len(manifest["fixtures"]), "outputDir": str(args.output_dir)}))
