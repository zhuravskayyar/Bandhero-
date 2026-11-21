"""Pixel-art genre emblems for Band Hero, 32x32 each, aliased drawing + auto outline + top-left light."""
import sys, math
from PIL import Image, ImageDraw

OUT = sys.argv[1]
N = 32
INK = (18, 12, 22, 255)
ORDER = ['rand', 'lofi', 'pop', 'rock', 'newwave', 'metal', 'jazz', 'chanson', 'chanson_ua', 'reggae', 'industrial']

def C(h, a=255):
    h = h.lstrip('#'); return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16), a)

def canvas():
    im = Image.new('RGBA', (N, N), (0, 0, 0, 0)); return im, ImageDraw.Draw(im)

def thick(d, pts, w, col):
    for a, b in zip(pts, pts[1:]):
        d.line([a, b], fill=col, width=w)
        r = w / 2 - .5
        d.ellipse([b[0] - r, b[1] - r, b[0] + r, b[1] + r], fill=col)

def rand():
    im, d = canvas()
    d.rectangle([6, 8, 25, 27], fill=C('b9b1c8'))          # shadow side
    d.rectangle([5, 5, 23, 23], fill=C('f4efe6'))
    d.rectangle([5, 5, 23, 6], fill=C('ffffff'))
    for x, y in [(8, 8), (18, 8), (13, 13), (8, 18), (18, 18)]:
        d.rectangle([x, y, x + 2, y + 2], fill=C('d2453f'))
    return im

def lofi():
    im, d = canvas()
    d.ellipse([3, 5, 28, 30], fill=C('1d1a26'))
    for r in (11, 8):
        d.ellipse([15.5 - r, 17.5 - r, 15.5 + r, 17.5 + r], outline=C('3a3546'))
    d.arc([5, 7, 26, 28], 200, 250, fill=C('8a86a0'))     # groove shine
    d.ellipse([11, 13, 20, 22], fill=C('f2a65a'))
    d.ellipse([14, 16, 17, 19], fill=C('1d1a26'))
    d.ellipse([20, 1, 30, 11], fill=C('ffe7a8'))           # moon
    d.ellipse([17, 0, 26, 9], fill=(0, 0, 0, 0))
    return im

def pop():
    im, d = canvas()
    thick(d, [(14, 17), (8, 27)], 4, C('3b3548'))          # handle
    d.rectangle([12, 15, 17, 18], fill=C('ff6fa8'))         # ring
    d.ellipse([10, 4, 22, 16], fill=C('c9c4d6'))
    for x in range(12, 21, 3):
        d.line([(x, 6), (x, 14)], fill=C('8d87a3'))
    for y in range(7, 15, 3):
        d.line([(11, y), (21, y)], fill=C('8d87a3'))
    for cx, cy, s in [(26, 6, 3), (5, 9, 2), (25, 20, 2)]:
        d.line([(cx - s, cy), (cx + s, cy)], fill=C('ffe066'))
        d.line([(cx, cy - s), (cx, cy + s)], fill=C('ffe066'))
    return im

def rock():
    im, d = canvas()
    thick(d, [(16, 16), (26, 4)], 3, C('6b4429'))           # neck
    d.rectangle([24, 1, 29, 5], fill=C('2b2230'))           # headstock
    d.ellipse([4, 15, 15, 26], fill=C('d43c3c'))
    d.ellipse([9, 11, 19, 21], fill=C('d43c3c'))
    d.ellipse([9, 18, 14, 23], fill=C('f4efe6'))            # pickguard
    d.rectangle([12, 16, 15, 18], fill=C('1d1a26'))         # pickup
    d.line([(6, 25), (25, 4)], fill=C('e9e4f0'))            # string highlight
    return im

def newwave():
    im, d = canvas()
    d.rectangle([2, 7, 29, 25], fill=C('2fa8b5'))
    d.rectangle([2, 7, 29, 8], fill=C('6fe3e0'))
    d.rectangle([5, 10, 26, 19], fill=C('ff6fa8'))
    d.rectangle([5, 10, 26, 11], fill=C('ffd0e4'))
    for cx in (11, 20):
        d.ellipse([cx - 3, 12, cx + 3, 18], fill=C('1d1a26'))
        d.ellipse([cx - 1, 14, cx + 1, 16], fill=C('f4efe6'))
    d.polygon([(8, 25), (10, 21), (21, 21), (23, 25)], fill=C('1f6d78'))
    return im

def metal():
    im, d = canvas()
    d.polygon([(4, 3), (9, 10), (7, 12)], fill=C('e9e0cf'))   # horns
    d.polygon([(27, 3), (22, 10), (24, 12)], fill=C('e9e0cf'))
    d.ellipse([7, 6, 24, 22], fill=C('f2ead9'))
    d.rectangle([10, 19, 21, 26], fill=C('f2ead9'))
    d.rectangle([10, 13, 14, 17], fill=C('1d1a26'))
    d.rectangle([17, 13, 21, 17], fill=C('1d1a26'))
    d.point([(12, 15), (19, 15)], fill=C('ff3b3b'))
    d.polygon([(15, 18), (17, 18), (16, 20)], fill=C('1d1a26'))
    for x in (12, 15, 18):
        d.line([(x, 23), (x, 26)], fill=C('9c9384'))
    return im

def jazz():
    im, d = canvas()
    gold, dark = C('f0b43c'), C('b07a1e')
    thick(d, [(19, 2), (19, 5), (17, 8)], 2, C('3b3548'))    # neck/mouthpiece
    thick(d, [(17, 8), (15, 20), (14, 25)], 4, gold)
    thick(d, [(14, 25), (17, 28), (22, 27), (24, 23)], 4, gold)
    d.polygon([(21, 23), (28, 15), (29, 18), (26, 25)], fill=gold)   # bell
    d.line([(22, 22), (27, 16)], fill=C('fff0b0'))
    for y in (11, 15, 19):
        d.rectangle([12, y, 14, y + 1], fill=dark)
    d.line([(15, 9), (13, 21)], fill=C('fff0b0'))
    return im

def chanson():
    im, d = canvas()
    d.rectangle([2, 8, 9, 26], fill=C('b8323a'))            # left box
    d.rectangle([22, 8, 29, 26], fill=C('b8323a'))
    d.rectangle([2, 8, 9, 9], fill=C('e2606a')); d.rectangle([22, 8, 29, 9], fill=C('e2606a'))
    for i, x in enumerate(range(10, 22)):
        d.line([(x, 9), (x, 25)], fill=C('2a2230') if i % 2 else C('f2ead9'))
    for y in range(11, 25, 3):
        d.point([(5, y), (7, y)], fill=C('f2ead9'))
        d.point([(25, y), (27, y)], fill=C('1d1a26'))
    return im

def chanson_ua():
    im, d = canvas()
    wood, light = C('a5652c'), C('d99a52')
    d.ellipse([5, 10, 26, 30], fill=wood)
    d.polygon([(9, 13), (16, 1), (22, 13)], fill=wood)
    d.ellipse([8, 13, 23, 27], fill=light)
    d.ellipse([13, 18, 18, 23], fill=C('3a2414'))
    for x in range(11, 22, 2):
        d.line([(16, 3), (x, 27)], fill=C('f6ecd0'))
    d.rectangle([14, 0, 17, 2], fill=C('3a2414'))
    d.rectangle([2, 27, 7, 30], fill=C('ffd23c')); d.rectangle([24, 27, 29, 30], fill=C('2f6fd1'))  # ribbon
    return im

def reggae():
    im, d = canvas()
    for y0, col in [(0, 'd8433a'), (11, 'f2c33a'), (21, '3aa55a')]:
        d.rectangle([3, max(3, y0 + 3), 28, min(28, y0 + 13)], fill=C(col))
    mask = Image.new('L', (N, N), 0); ImageDraw.Draw(mask).ellipse([3, 3, 28, 28], fill=255)
    bg = Image.new('RGBA', (N, N), (0, 0, 0, 0)); bg.paste(im, (0, 0), mask); im = bg; d = ImageDraw.Draw(im)
    thick(d, [(14, 28), (15, 20), (18, 12)], 2, C('3b2416'))             # palm trunk
    for pts in [[(18, 12), (11, 9), (7, 12)], [(18, 12), (23, 7), (28, 9)], [(18, 12), (17, 5), (13, 3)], [(18, 12), (25, 14), (27, 19)]]:
        thick(d, pts, 2, C('1d3a1f'))
    return im

def industrial():
    im, d = canvas()
    cx, cy = 16, 16
    for k in range(8):                                     # 8 square teeth
        a = k / 8 * 2 * math.pi
        ux, uy, vx, vy = math.cos(a), math.sin(a), -math.sin(a), math.cos(a)
        pts = [(cx + ux * r + vx * s, cy + uy * r + vy * s) for r, s in ((8, -2.6), (14, -2.2), (14, 2.2), (8, 2.6))]
        d.polygon(pts, fill=C('8b8f98'))
    d.ellipse([cx - 10, cy - 10, cx + 10, cy + 10], fill=C('8b8f98'))
    d.ellipse([cx - 6, cy - 6, cx + 6, cy + 6], fill=C('4a4d56'))
    d.ellipse([cx - 3, cy - 3, cx + 3, cy + 3], fill=C('ff7a2a'))
    d.arc([cx - 9, cy - 9, cx + 9, cy + 9], 200, 290, fill=C('cfd3da'))
    return im

def outline(im):
    a = im.getchannel('A'); px = a.load(); out = im.copy(); op = out.load()
    for y in range(N):
        for x in range(N):
            if px[x, y] > 0: continue
            for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                X, Y = x + dx, y + dy
                if 0 <= X < N and 0 <= Y < N and px[X, Y] > 0:
                    op[x, y] = INK; break
    return out

icons = [outline(globals()[k]()) for k in ORDER]
sheet = Image.new('RGBA', (N * len(icons), N), (0, 0, 0, 0))
for i, ic in enumerate(icons): sheet.paste(ic, (i * N, 0))
sheet.save(OUT, optimize=True)
print('saved', OUT, sheet.size)
