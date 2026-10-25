#!/usr/bin/env python3
"""Render one PNG per video state from a plan JSON. Usage: render_frames.py plan.json"""
import json, sys, os
from PIL import Image, ImageDraw, ImageFont

W, H = 1280, 720
FD = "/usr/share/fonts/truetype/dejavu/"
def font(sz, bold=False): return ImageFont.truetype(FD + ("DejaVuSans-Bold.ttf" if bold else "DejaVuSans.ttf"), sz)

plan = json.load(open(sys.argv[1]))
outdir = plan["frames_dir"]; os.makedirs(outdir, exist_ok=True)
cfg = plan["map"]  # {image|null, px_per_m, origin_px|null, size}

def load_map():
    if cfg.get("image") and os.path.exists(cfg["image"]):
        return Image.open(cfg["image"]).convert("RGB")
    s = cfg["size"]; im = Image.new("RGB", (s, s), (226, 232, 220)); d = ImageDraw.Draw(im)
    c = s // 2; ppm = cfg["px_per_m"]
    d.rectangle([0, c - 6*ppm, s, c + 6*ppm], fill=(70, 72, 78))   # E-W road
    d.rectangle([c - 6*ppm, 0, c + 6*ppm, s], fill=(70, 72, 78))   # N-S road
    for i in range(0, s, 40):
        d.rectangle([i, c-1, i+20, c+1], fill=(240, 220, 90)); d.rectangle([c-1, i, c+1, i+20], fill=(240, 220, 90))
    d.rectangle([c - 22*ppm, c - 14*ppm, c - 16*ppm, c - 9*ppm], fill=(60, 120, 170))  # shelter-ish block
    d.text((c - 22*ppm, c - 14*ppm - 16), "shelter (placeholder)", fill=(30, 60, 90), font=font(12))
    d.text((8, 8), "EXHIBIT 4 - placeholder map (N up)  1 grid = 10 m", fill=(40, 40, 40), font=font(14, True))
    for g in range(0, s, 10*ppm):
        d.line([g, 0, g, s], fill=(200, 205, 195)); d.line([0, g, s, g], fill=(200, 205, 195))
    return im
MAP = load_map()
ORIGIN = cfg.get("origin_px") or [MAP.width / 2, MAP.height / 2]

def world_to_px(x, z): return (ORIGIN[0] + x * cfg["px_per_m"], ORIGIN[1] + z * cfg["px_per_m"])

def wrap(d, text, f, maxw):
    lines, cur = [], ""
    for w in text.split():
        t = (cur + " " + w).strip()
        if d.textlength(t, font=f) <= maxw: cur = t
        else: lines.append(cur); cur = w
    if cur: lines.append(cur)
    return lines

def role(sp):
    s = sp.lower()
    if "witness" in s: return "Deponent (fictional witness)"
    if "reporter" in s: return "Court Reporter"
    return "Examining Counsel" if any(k in s for k in ("attorney", "counsel", "esq")) else "Participant"

def base(caption):
    im = Image.new("RGB", (W, H), (22, 26, 33)); d = ImageDraw.Draw(im)
    for y in range(H):  # subtle vertical gradient
        v = int(18 + 14 * y / H); d.line([0, y, W, y], fill=(v, v + 4, v + 12))
    d.rectangle([0, 0, W, 40], fill=(176, 20, 20))
    t = "SIMULATED DEPOSITION — FICTIONAL WITNESS — AI-GENERATED FOR DEMO"
    d.text((W/2, 20), t, fill=(255, 255, 255), font=font(21, True), anchor="mm")
    d.rectangle([0, 40, W, 80], fill=(0, 0, 0))
    d.text((16, 60), caption, fill=(235, 235, 235), font=font(18, True), anchor="lm")
    return im, d

def speaker_card(im, d, speaker, cx, cy, active=True):
    cw, ch = 440, 250
    x0, y0 = cx - cw//2, cy - ch//2
    d.rounded_rectangle([x0, y0, x0+cw, y0+ch], 14, fill=(38, 46, 60), outline=(90, 160, 255) if active else (70, 80, 95), width=3)
    d.ellipse([cx-42, y0+26, cx+42, y0+110], fill=(95, 108, 130))                 # head
    d.pieslice([cx-80, y0+112, cx+80, y0+260], 180, 360, fill=(95, 108, 130))     # shoulders
    d.rectangle([x0, y0+ch-58, x0+cw, y0+ch], fill=(12, 16, 22))
    d.text((cx, y0+ch-40), speaker, fill=(255, 255, 255), font=font(22, True), anchor="mm")
    d.text((cx, y0+ch-16), role(speaker), fill=(160, 175, 195), font=font(15), anchor="mm")
    d.rectangle([x0+14, y0+12, x0+14+9, y0+21], fill=(220, 40, 40)) if active else None
    d.text((x0+30, y0+16), "SPEAKING", fill=(220, 220, 220), font=font(12, True), anchor="lm") if active else None

def draw_exhibit(im, d, mark, box):
    bx, by, bw, bh = box
    s = min(bw / MAP.width, bh / MAP.height)
    m = MAP.resize((int(MAP.width * s), int(MAP.height * s)), Image.LANCZOS)
    ox, oy = bx + (bw - m.width)//2, by + (bh - m.height)//2
    d.rectangle([ox-4, oy-4, ox+m.width+4, oy+m.height+4], fill=(240, 240, 240))
    im.paste(m, (ox, oy))
    px, py = world_to_px(mark["x_m"], mark["z_m"])
    px, py = ox + px * s, oy + py * s
    r = 15
    d.ellipse([px-r-6, py-r-6, px+r+6, py+r+6], outline=(210, 20, 20), width=4)   # pen circle
    d.line([px-r, py-r, px+r, py+r], fill=(210, 20, 20), width=5)                  # pen X
    d.line([px-r, py+r, px+r, py-r], fill=(210, 20, 20), width=5)
    d.text((ox + m.width/2, oy - 14), "EXHIBIT 4  —  witness's pen mark", fill=(255, 255, 255), font=font(15, True), anchor="mm")

def subtitle(d, text):
    f = font(32, True); lines = wrap(d, text, f, 1180)
    lh = 42; h = lh * len(lines) + 20; y0 = H - 24 - h
    d.rounded_rectangle([40, y0, W-40, H-24], 10, fill=(0, 0, 0))
    for i, l in enumerate(lines):
        d.text((W/2, y0 + 10 + lh*i + lh/2), l, fill=(255, 255, 255), font=f, anchor="mm")
    return y0

for st in plan["states"]:
    im, d = base(plan["caption"])
    if st.get("exhibit"):
        draw_exhibit(im, d, st["exhibit"], (30, 112, 700, 400))
        speaker_card(im, d, st["speaker"], 1000, 250)
        if st["exhibit"].get("note"):
            d.text((1000, 400), "[ " + st["exhibit"]["note"] + " ]", fill=(255, 200, 120), font=font(14), anchor="mm")
    else:
        speaker_card(im, d, st["speaker"], W//2, 280)
    subtitle(d, st["text"])
    im.save(os.path.join(outdir, st["file"]))
print("rendered", len(plan["states"]), "frames")
