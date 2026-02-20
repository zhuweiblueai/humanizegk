#!/usr/bin/env python3
import argparse
import base64
import json
import mimetypes
import os
import re
import sys
import time
from datetime import datetime, timedelta

import xai_sdk
from PIL import Image


def to_plain(obj):
    if obj is None:
        return None
    if isinstance(obj, (str, int, float, bool)):
        return obj
    if isinstance(obj, list):
        return [to_plain(item) for item in obj]
    if isinstance(obj, dict):
        return {k: to_plain(v) for k, v in obj.items()}
    if hasattr(obj, "model_dump"):
        try:
            return to_plain(obj.model_dump())
        except Exception:
            pass
    if hasattr(obj, "dict"):
        try:
            return to_plain(obj.dict())
        except Exception:
            pass
    if hasattr(obj, "__dict__"):
        try:
            return to_plain(vars(obj))
        except Exception:
            pass
    return str(obj)


def object_getattr_safe(obj, name):
    try:
        return getattr(obj, name)
    except Exception:
        return None


def extract_url_from_any(data, visited=None):
    if data is None:
        return None

    if visited is None:
        visited = set()
    obj_id = id(data)
    if obj_id in visited:
        return None
    visited.add(obj_id)

    if isinstance(data, str):
        if data.startswith("http://") or data.startswith("https://"):
            return data
        return None
    if isinstance(data, dict):
        if isinstance(data.get("url"), str):
            return data.get("url")
        for key in ("video", "response", "result", "data"):
            found = extract_url_from_any(data.get(key), visited)
            if found:
                return found
        for value in data.values():
            found = extract_url_from_any(value, visited)
            if found:
                return found
        return None
    if isinstance(data, list):
        for item in data:
            found = extract_url_from_any(item, visited)
            if found:
                return found
        return None

    direct_url = object_getattr_safe(data, "url")
    if isinstance(direct_url, str):
        return direct_url

    for attr in ("video", "response", "result", "data"):
        found = extract_url_from_any(object_getattr_safe(data, attr), visited)
        if found:
            return found

    dict_method = object_getattr_safe(data, "dict")
    if callable(dict_method):
        try:
            found = extract_url_from_any(dict_method(), visited)
            if found:
                return found
        except Exception:
            pass

    dump_method = object_getattr_safe(data, "model_dump")
    if callable(dump_method):
        try:
            found = extract_url_from_any(dump_method(), visited)
            if found:
                return found
        except Exception:
            pass

    return None


def extract_request_id_from_any(data):
    if data is None:
        return None
    if isinstance(data, dict):
        value = data.get("request_id")
        if isinstance(value, str):
            return value
        for key in ("response", "result", "data"):
            nested = extract_request_id_from_any(data.get(key))
            if nested:
                return nested
        return None

    value = object_getattr_safe(data, "request_id")
    if isinstance(value, str):
        return value

    for attr in ("response", "result", "data"):
        nested = extract_request_id_from_any(object_getattr_safe(data, attr))
        if nested:
            return nested
    return None


def is_transient_xai_error(error):
    text = str(error)
    return (
        "StatusCode.INTERNAL" in text
        or "grpc_status:13" in text
        or "Unable to process your request" in text
    )


def call_with_retry(func, retries=3, base_sleep_seconds=2):
    last_error = None
    for attempt in range(retries):
        try:
            return func()
        except Exception as error:
            last_error = error
            if not is_transient_xai_error(error) or attempt == retries - 1:
                raise
            time.sleep(base_sleep_seconds * (attempt + 1))
    raise last_error


def parse_aspect_ratio(value):
    if not isinstance(value, str):
        return None
    match = re.fullmatch(r"\s*(\d+)\s*:\s*(\d+)\s*", value)
    if not match:
        return None
    w = int(match.group(1))
    h = int(match.group(2))
    if w <= 0 or h <= 0:
        return None
    return (w, h)


def parse_hex_color(value):
    if not isinstance(value, str):
        return (255, 255, 255, 255)
    raw = value.strip().lstrip("#")
    if re.fullmatch(r"[0-9a-fA-F]{6}", raw):
        return (int(raw[0:2], 16), int(raw[2:4], 16), int(raw[4:6], 16), 255)
    if re.fullmatch(r"[0-9a-fA-F]{8}", raw):
        return (
            int(raw[0:2], 16),
            int(raw[2:4], 16),
            int(raw[4:6], 16),
            int(raw[6:8], 16),
        )
    return (255, 255, 255, 255)


def pad_image_to_aspect_ratio(input_path, aspect_ratio_value, out_dir, pad_hex):
    parsed = parse_aspect_ratio(aspect_ratio_value)
    if not parsed:
        return {"path": input_path, "padded": False, "reason": "invalid-aspect-ratio"}

    target_w_ratio, target_h_ratio = parsed
    with Image.open(input_path) as img:
        src = img.convert("RGBA")
        src_w, src_h = src.size
        src_aspect = src_w / src_h
        target_aspect = target_w_ratio / target_h_ratio

        if abs(src_aspect - target_aspect) <= 1e-3:
            return {
                "path": input_path,
                "padded": False,
                "original_width": src_w,
                "original_height": src_h,
                "target_width": src_w,
                "target_height": src_h,
            }

        if src_aspect > target_aspect:
            target_w = src_w
            target_h = int((src_w / target_aspect) + 0.999999)
        else:
            target_h = src_h
            target_w = int((src_h * target_aspect) + 0.999999)

        bg = Image.new("RGBA", (target_w, target_h), parse_hex_color(pad_hex))
        x = (target_w - src_w) // 2
        y = (target_h - src_h) // 2
        bg.paste(src, (x, y), src)

        out_path = os.path.join(out_dir, "reference_padded.png")
        bg.save(out_path, format="PNG")
        return {
            "path": out_path,
            "padded": True,
            "original_width": src_w,
            "original_height": src_h,
            "target_width": target_w,
            "target_height": target_h,
            "pad_color": pad_hex,
        }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("request_json_path")
    args = parser.parse_args()

    with open(args.request_json_path, "r", encoding="utf-8") as f:
        req = json.load(f)

    api_key = (req.get("api_key") or "").strip()
    if not api_key:
        raise ValueError("api_key is required")

    prompt = (req.get("prompt") or "").strip()
    if not prompt:
        raise ValueError("prompt is required")

    model = req.get("model") or "grok-imagine-video"
    image_path = req.get("image_path")
    image_pad_color = req.get("image_pad_color") or "FFFFFF"
    image_preprocess = {"padded": False}

    kwargs = {
        "prompt": prompt,
        "model": model,
    }

    if req.get("duration") is not None:
        kwargs["duration"] = int(req["duration"])
    if req.get("resolution"):
        kwargs["resolution"] = req["resolution"]
    if req.get("aspect_ratio"):
        kwargs["aspect_ratio"] = req["aspect_ratio"]

    if image_path:
        if req.get("aspect_ratio"):
            image_preprocess = pad_image_to_aspect_ratio(
                image_path, req.get("aspect_ratio"), os.path.dirname(args.request_json_path), image_pad_color
            )
            image_path = image_preprocess["path"]

        with open(image_path, "rb") as f:
            image_data = base64.b64encode(f.read()).decode("utf-8")
        mime = mimetypes.guess_type(image_path)[0] or "image/png"
        kwargs["image_url"] = f"data:{mime};base64,{image_data}"

    client = xai_sdk.Client(api_key=api_key)
    response = call_with_retry(lambda: client.video.generate(**kwargs))
    video_url = extract_url_from_any(response)
    request_id = extract_request_id_from_any(response)

    if not video_url and request_id:
        deadline = datetime.utcnow() + timedelta(minutes=10)
        while datetime.utcnow() < deadline:
            polled = call_with_retry(lambda: client.video.get(request_id))
            video_url = extract_url_from_any(polled)
            if video_url:
                response = polled
                break
            time.sleep(5)

    raw = to_plain(response)
    result = {
        "video_url": video_url or extract_url_from_any(raw),
        "request_id": request_id,
        "image_preprocess": image_preprocess,
        "raw": raw,
    }
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
