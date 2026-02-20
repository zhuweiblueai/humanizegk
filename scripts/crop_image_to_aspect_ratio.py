import argparse
import json
import re
import sys
from PIL import Image


def parse_aspect_ratio(raw):
    match = re.fullmatch(r"\s*(\d+)\s*:\s*(\d+)\s*", str(raw or ""))
    if not match:
        return None
    w = int(match.group(1))
    h = int(match.group(2))
    if w <= 0 or h <= 0:
        return None
    return (w, h)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("input_path")
    parser.add_argument("output_path")
    parser.add_argument("aspect_ratio")
    args = parser.parse_args()

    parsed = parse_aspect_ratio(args.aspect_ratio)
    if not parsed:
        raise ValueError("aspect_ratio must be W:H")

    target_w_ratio, target_h_ratio = parsed
    target_aspect = target_w_ratio / target_h_ratio

    with Image.open(args.input_path) as img:
        src = img.convert("RGBA")
        src_w, src_h = src.size
        src_aspect = src_w / src_h

        left = 0
        top = 0
        right = src_w
        bottom = src_h
        cropped = False

        if abs(src_aspect - target_aspect) > 1e-6:
            if src_aspect > target_aspect:
                new_w = max(1, int(src_h * target_aspect))
                left = max(0, (src_w - new_w) // 2)
                right = min(src_w, left + new_w)
            else:
                new_h = max(1, int(src_w / target_aspect))
                top = max(0, (src_h - new_h) // 2)
                bottom = min(src_h, top + new_h)
            cropped = True

        out = src.crop((left, top, right, bottom))
        out.save(args.output_path, format="PNG")

        meta = {
            "applied": cropped,
            "source_width": src_w,
            "source_height": src_h,
            "output_width": int(out.size[0]),
            "output_height": int(out.size[1]),
            "target_aspect_ratio": f"{target_w_ratio}:{target_h_ratio}",
            "crop_box": [int(left), int(top), int(right), int(bottom)],
        }
        print(json.dumps(meta, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
