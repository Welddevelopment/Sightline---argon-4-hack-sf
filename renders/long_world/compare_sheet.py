# Build renders/long_world/compare_sheet.png: left = single-response world (long/), right = current world_v2 (v2/).
# Usage: python3 renders/long_world/compare_sheet.py
import os
from PIL import Image, ImageDraw, ImageFont

D = os.path.dirname(os.path.abspath(__file__))
VIEWS = [('overhead', 'Overhead'), ('oblique', 'Oblique of crossover'), ('chase_veh_A', 'Chase veh_A'),
         ('wit_B', 'Witness B eye'), ('wit_A', 'Witness A eye')]
TW, TH, GAP, HDR, LAB = 960, 540, 12, 70, 34
F = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'
big, small = ImageFont.truetype(F, 30), ImageFont.truetype(F, 22)
W = TW * 2 + GAP * 3
H = HDR + len(VIEWS) * (TH + LAB + GAP) + GAP
sheet = Image.new('RGB', (W, H), (24, 24, 28))
d = ImageDraw.Draw(sheet)
d.text((GAP, 18), 'LEFT: single-response world (world_long.js, 63k tokens, v1)', font=big, fill=(255, 210, 120))
d.text((TW + GAP * 2, 18), 'RIGHT: current asset-library world (world_v2.js)', font=big, fill=(140, 210, 255))
y = HDR
for key, label in VIEWS:
    for col, sub in enumerate(['long', 'v2']):
        x = GAP + col * (TW + GAP)
        d.text((x, y + 4), f'{label}  t=9.9 s', font=small, fill=(230, 230, 230))
        p = os.path.join(D, sub, key + '.png')
        im = Image.open(p).convert('RGB').resize((TW, TH), Image.LANCZOS) if os.path.exists(p) else Image.new('RGB', (TW, TH), (80, 0, 0))
        sheet.paste(im, (x, y + LAB))
    y += TH + LAB + GAP
sheet.save(os.path.join(D, 'compare_sheet.png'), optimize=True)
print(os.path.join(D, 'compare_sheet.png'), sheet.size)
