#!/usr/bin/env python3
"""Erzeugt alle Android-Icons und Startbildschirme aus dem AleNote-Logo.

Aufruf (im Projektordner):  python3 scripts/make-android-icons.py
Benötigt Pillow (pip install pillow).

Logo (wie src/ui/sidebar.js): abgerundetes Quadrat mit Farbverlauf #7c5cff → #c05cff,
darin ein weißes „A“ aus Linien (Pfad im 32er-Raster: 10,22 → 16,9 → 22,22 und 12.5,17 → 19.5,17).
"""
import os
from PIL import Image, ImageDraw

ROOT = os.path.join(os.path.dirname(__file__), '..', 'android', 'app', 'src', 'main', 'res')
C1, C2 = (0x7C, 0x5C, 0xFF), (0xC0, 0x5C, 0xFF)
DARK = (0x17, 0x17, 0x1C)
SS = 4  # Überabtastung für glatte Kanten
DENSITIES = {'mdpi': 1, 'hdpi': 1.5, 'xhdpi': 2, 'xxhdpi': 3, 'xxxhdpi': 4}


def gradient(size):
    """Diagonaler Farbverlauf von oben links nach unten rechts."""
    w = h = size
    small = Image.new('RGB', (64, 64))
    px = small.load()
    for y in range(64):
        for x in range(64):
            t = (x + y) / 126
            px[x, y] = tuple(round(C1[i] + (C2[i] - C1[i]) * t) for i in range(3))
    return small.resize((w, h), Image.BILINEAR)


def draw_a(draw, x0, y0, unit, color=(255, 255, 255, 255)):
    """Zeichnet das „A“ (Pfad im 32er-Raster) mit runden Enden."""
    width = 2.4 * unit
    p = lambda x, y: (x0 + x * unit, y0 + y * unit)
    for seg in [[(10, 22), (16, 9), (22, 22)], [(12.5, 17), (19.5, 17)]]:
        pts = [p(*q) for q in seg]
        draw.line(pts, fill=color, width=round(width), joint='curve')
        r = width / 2
        for (x, y) in pts:
            draw.ellipse([x - r, y - r, x + r, y + r], fill=color)


def logo(size, shape='square'):
    """Fertiges Logo (für alte Android-Versionen und den Startbildschirm)."""
    S = size * SS
    img = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    mask = Image.new('L', (S, S), 0)
    md = ImageDraw.Draw(mask)
    if shape == 'round':
        md.ellipse([S * 2 / 32, S * 2 / 32, S * 30 / 32, S * 30 / 32], fill=255)
    else:
        md.rounded_rectangle([S * 2 / 32, S * 2 / 32, S * 30 / 32, S * 30 / 32], radius=S * 8 / 32, fill=255)
    img.paste(gradient(S), (0, 0), mask)
    draw_a(ImageDraw.Draw(img), 0, 0, S / 32)
    return img.resize((size, size), Image.LANCZOS)


def adaptive_layers(size):
    """Hintergrund (Verlauf, randlos) und Vordergrund (weißes A in der sicheren Zone, 66 von 108 dp)."""
    S = size * SS
    bg = gradient(S).resize((size, size), Image.LANCZOS)
    fg = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    # Das A (Raster 32) so skalieren, dass es gut in die sichere Zone passt
    unit = S * 0.58 / 32
    off = (S - 32 * unit) / 2
    draw_a(ImageDraw.Draw(fg), off, off + unit * 0.5, unit)
    return bg, fg.resize((size, size), Image.LANCZOS)


def save(img, *parts):
    path = os.path.join(ROOT, *parts)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    img.save(path, optimize=True)


def main():
    for name, f in DENSITIES.items():
        legacy = round(48 * f)
        save(logo(legacy, 'square'), f'mipmap-{name}', 'ic_launcher.png')
        save(logo(legacy, 'round'), f'mipmap-{name}', 'ic_launcher_round.png')
        bg, fg = adaptive_layers(round(108 * f))
        save(bg, f'mipmap-{name}', 'ic_launcher_background.png')
        save(fg, f'mipmap-{name}', 'ic_launcher_foreground.png')

    # Adaptive Icons (Android 8+), inkl. einfarbiger Variante für „Designsymbole“ (Android 13+)
    xml = '''<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@mipmap/ic_launcher_background"/>
    <foreground android:drawable="@mipmap/ic_launcher_foreground"/>
    <monochrome android:drawable="@mipmap/ic_launcher_foreground"/>
</adaptive-icon>
'''
    for n in ('ic_launcher.xml', 'ic_launcher_round.xml'):
        with open(os.path.join(ROOT, 'mipmap-anydpi-v26', n), 'w', encoding='utf-8') as fh:
            fh.write(xml)

    # Startbildschirm: dunkler Hintergrund wie die App, Logo in der Mitte
    splash_dirs = {'drawable': (480, 320)}
    for d in os.listdir(ROOT):
        if d.startswith('drawable-') and os.path.exists(os.path.join(ROOT, d, 'splash.png')):
            splash_dirs[d] = Image.open(os.path.join(ROOT, d, 'splash.png')).size
    for d, (w, h) in splash_dirs.items():
        img = Image.new('RGB', (w, h), DARK)
        s = round(min(w, h) * 0.30)
        lg = logo(s)
        img.paste(lg, ((w - s) // 2, (h - s) // 2), lg)
        save(img, d, 'splash.png')
    print('Icons und Startbildschirme erzeugt in', os.path.normpath(ROOT))


if __name__ == '__main__':
    main()
