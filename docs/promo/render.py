#!/usr/bin/env python3
"""Render the DevOne film from captured app screens. Requires Pillow and FFmpeg."""

import argparse
from array import array
from functools import lru_cache
import math
from pathlib import Path
import random
import subprocess
import sys
import time
import wave

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parents[2]
OUT = Path(__file__).resolve().parent
W, H, FPS, DURATION = 1920, 1080, 30, 42
INK = (10, 10, 10)
PAPER = (250, 250, 250)
SIGNAL = (182, 242, 58)
MUTED = (149, 153, 146)
FONT = '/usr/share/fonts/adwaita-sans-fonts/AdwaitaSans-Regular.ttf'
MONO = '/usr/share/fonts/adwaita-mono-fonts/AdwaitaMono-Regular.ttf'
SCREENS = {}


@lru_cache(maxsize=90)
def font(size, bold=False, mono=False):
    f = ImageFont.truetype(MONO if mono else FONT, size)
    if bold and not mono:
        f.set_variation_by_name('Bold')
    return f


def ease(v):
    return 1 - (1 - max(0, min(1, v))) ** 4


def smooth(v):
    v = max(0, min(1, v))
    return v * v * (3 - 2 * v)


def label(im, text, xy, size=24, color=PAPER, bold=False, mono=False):
    ImageDraw.Draw(im).text(xy, text, font=font(size, bold, mono), fill=color, anchor='lt')


def centered(im, text, y, size=80, color=PAPER, bold=True):
    d = ImageDraw.Draw(im)
    f = font(size, bold)
    d.text((W / 2, y), text, font=f, fill=color, anchor='mt')


def load_assets():
    for p in (OUT / 'screens').glob('*.png'):
        if p.stem not in ('login', 'connections'):
            source = Image.open(p).convert('RGB')
            # Frame below the public-demo banner; retain the app's own chrome and UI.
            SCREENS[p.stem] = source.crop((0, 32, source.width, min(1034, source.height)))
    expected = {'board', 'list', 'calendar', 'git', 'database', 'sql', 'erd', 'api', 'docs', 'drawings', 'pipelines', 'terminal'}
    missing = expected - SCREENS.keys()
    if missing:
        raise RuntimeError(f'Missing app captures: {sorted(missing)}')


def make_backdrop():
    tiny = Image.new('RGB', (192, 108))
    pix = tiny.load()
    for y in range(108):
        for x in range(192):
            glow = math.exp(-(((x - 142) / 60) ** 2 + ((y - 55) / 50) ** 2))
            pix[x, y] = (int(10 + glow * 6), int(11 + glow * 12), int(10 + glow * 3))
    bg = tiny.resize((W, H), Image.Resampling.BILINEAR)
    d = ImageDraw.Draw(bg)
    for x in range(0, W, 64):
        d.line((x, 0, x, H), fill=(21, 24, 19))
    for y in range(0, H, 64):
        d.line((0, y, W, y), fill=(21, 24, 19))
    return bg


BG = make_backdrop()


@lru_cache(maxsize=60)
def prepared(name, width, angle=0):
    src = SCREENS[name]
    height = round(src.height * width / src.width)
    image = src.resize((width, height), Image.Resampling.LANCZOS).convert('RGBA')
    mask = Image.new('L', image.size)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, width - 1, height - 1), radius=18, fill=255)
    image.putalpha(mask)
    ImageDraw.Draw(image).rounded_rectangle((0, 0, width - 1, height - 1), radius=18, outline=(87, 96, 77), width=2)
    if angle:
        image = image.rotate(angle, resample=Image.Resampling.BICUBIC, expand=True)
    return image


def panel(im, name, x, y, width=1320, angle=0, opacity=1):
    image = prepared(name, width, angle)
    if opacity < 1:
        image = image.copy()
        image.putalpha(image.getchannel('A').point(lambda a: int(a * max(0, opacity))))
    x, y = round(x), round(y)
    d = ImageDraw.Draw(im)
    d.rounded_rectangle((x + 8, y + 22, x + image.width + 18, y + image.height + 30), radius=24, fill=(4, 6, 3))
    im.paste(image, (x, y), image)


LOGO = Image.open(ROOT / 'public/logo-512.png').convert('RGBA')
# Preserve the exact Prompt mascot from the brand asset, with a transparent surround.
LOGO.putalpha(LOGO.convert('L').point(lambda p: 255 if p > 130 else 0))


@lru_cache(maxsize=30)
def logo(size, dark=False):
    mark = LOGO.resize((size, size), Image.Resampling.LANCZOS)
    if dark:
        fill = Image.new('RGBA', mark.size, INK)
        fill.putalpha(mark.getchannel('A'))
        return fill
    return mark


def mark(im, x, y, size=100, dark=False):
    asset = logo(size, dark)
    im.paste(asset, (round(x), round(y)), asset)


def chrome(im, t, section='DEVONE / PRODUCT FILM'):
    mark(im, 85, 38, 63)
    label(im, 'DevOne', (153, 55), 30, bold=True)
    label(im, section, (W - 610, 59), 18, MUTED, mono=True)
    d = ImageDraw.Draw(im)
    d.line((96, H - 57, W - 96, H - 57), fill=(53, 59, 45), width=2)
    d.line((96, H - 57, 96 + (W - 192) * t / DURATION, H - 57), fill=SIGNAL, width=3)
    label(im, 'LESS SWITCHING. MORE SHIPPING.', (96, H - 40), 15, MUTED, mono=True)
    label(im, f'{min(42, int(t)):02d} / 42', (W - 174, H - 40), 15, MUTED, mono=True)


def title_lines(im, lines, local, x=96, y=265, size=86, gap=99):
    for i, line in enumerate(lines):
        e = ease((local - i * 0.10) / 0.65)
        label(im, line, (x + (1 - e) * -70, y + i * gap + (1 - e) * 55), size,
              SIGNAL if i == len(lines) - 1 else PAPER, bold=True)


FEATURES = [
    (7, 13, '01 / PROJECT WORK', ['PLAN.', 'TRACK.', 'DELIVER.'],
     ['Your work, at a glance.', 'Board. List. Calendar.'], ['board', 'list', 'calendar']),
    (13, 17, '02 / GIT WORKBENCH', ['CODE.', 'COMMIT.', 'CONNECT.'],
     ['Branches, files, and pull requests.', 'GitHub + GitLab.'], ['git']),
    (17, 21, '03 / DATABASE', ['QUERY.', 'EXPLORE.', 'UNDERSTAND.'],
     ['Tables, SQL, and generated ERDs.', 'PostgreSQL + MySQL.'], ['database', 'sql', 'erd']),
    (21, 25, '04 / API CLIENT', ['REQUEST.', 'TEST.', 'REPEAT.'],
     ['Collections and environments.', 'Your APIs, in project context.'], ['api']),
    (25, 29, '05 / DOCS + DRAWINGS', ['THINK.', 'DOCUMENT.', 'CREATE.'],
     ['Write the context. Sketch the idea.', 'Keep it beside the work.'], ['docs', 'drawings']),
    (29, 33, '06 / DEVOPS', ['BUILD.', 'DEPLOY.', 'OPERATE.'],
     ['Pipeline visibility. Server access.', 'CI/CD + SSH, in one workspace.'], ['pipelines', 'terminal'])
]


def feature(im, t, spec):
    start, end, eyebrow, lines, body, names = spec
    u = t - start
    e = ease(u / 0.7)
    d = ImageDraw.Draw(im)
    d.ellipse((980, -220, 2420, 1220), outline=(54, 73, 25), width=2)
    d.ellipse((1025, -175, 2375, 1175), outline=(34, 43, 24), width=1)
    index = min(len(names) - 1, int(u / ((end - start) / len(names))))
    slot = (end - start) / len(names)
    sub = u - index * slot
    entering = ease(sub / 0.45)
    panel(im, names[index], 650 + (1 - entering) * 140, 238 + 14 * math.sin(u * 0.8), 1300)
    label(im, eyebrow, (96, 174), 22, SIGNAL, mono=True)
    size = 69 if lines[-1] == 'UNDERSTAND.' else (77 if lines[1] == 'DOCUMENT.' else 86)
    title_lines(im, lines, u, size=size)
    for i, line in enumerate(body):
        label(im, line, (98, 639 + i * 42 + (1 - e) * 30), 26, MUTED)
    d.line((98, 754, 530, 754), fill=(62, 69, 51), width=2)
    labels = {'board': 'BOARD', 'list': 'LIST', 'calendar': 'CALENDAR', 'database': 'TABLES', 'sql': 'SQL', 'erd': 'ERD',
              'docs': 'DOCS', 'drawings': 'DRAWINGS', 'pipelines': 'PIPELINES', 'terminal': 'SSH TERMINAL', 'git': 'GIT', 'api': 'API'}
    x = 98
    for i, name in enumerate(names):
        active = i == index
        text = labels[name]
        width = int(font(18, mono=True).getlength(text)) + 28
        d.rounded_rectangle((x, 790, x + width, 831), 8, fill=SIGNAL if active else (27, 31, 23))
        label(im, text, (x + 14, 802), 18, INK if active else MUTED, mono=True)
        x += width + 10
    label(im, 'ONE PROJECT. ALL THE CONTEXT.', (98, 922), 18, MUTED, mono=True)
    chrome(im, t, eyebrow)


def intro(t):
    im = BG.copy()
    names = ['board', 'git', 'api', 'database']
    poses = [(-175, -78, 10), (1260, -105, -8), (-230, 695, -8), (1220, 720, 9)]
    gather = smooth((t - 2.9) / 1.1)
    for i, (name, pose) in enumerate(zip(names, poses)):
        x, y, rotation = pose
        wobble = math.sin(t * 1.3 + i) * 16
        x = x * (1 - gather) + 620 * gather
        y = y * (1 - gather) + 335 * gather
        panel(im, name, x, y + wobble, 690, rotation, 0.7 * (1 - gather))
    # A quiet center leaves the headline legible while panels move at the edges.
    curtain = Image.new('RGBA', (W, H))
    ImageDraw.Draw(curtain).rounded_rectangle((390, 277, 1530, 760), radius=32, fill=(10, 12, 9, 238))
    im.paste(curtain, (0, 0), curtain)
    if t < 2:
        local = t
        e = ease(local / 0.6)
        centered(im, 'Too many tabs.', 350 + (1 - e) * 50, 133)
        centered(im, 'Too little flow.', 518 + (1 - e) * 70, 133, SIGNAL)
        centered(im, 'YOUR PROJECT DESERVES BETTER.', 729, 22, MUTED, False)
    else:
        e = ease((t - 2) / 0.5)
        centered(im, 'Less switching.', 350 + (1 - e) * 60, 126)
        centered(im, 'More shipping.', 518 + (1 - e) * 80, 126, SIGNAL)
        centered(im, 'BRING THE WHOLE PROJECT TOGETHER.', 729, 22, MUTED, False)
    chrome(im, t)
    return im


def reveal(t):
    im = BG.copy()
    u = t - 4
    e = ease(u / 0.8)
    d = ImageDraw.Draw(im)
    cx, cy = 1370, 500
    for radius in (270, 325, 380):
        d.ellipse((cx - radius, cy - radius, cx + radius, cy + radius), outline=(54, 71, 30), width=2)
    for i in range(8):
        a = i * math.tau / 8 + u * 0.15
        px, py = cx + 325 * math.cos(a), cy + 325 * math.sin(a)
        d.ellipse((px - 5, py - 5, px + 5, py + 5), fill=SIGNAL)
    mark(im, cx - 245, cy - 245 + 70 * (1 - e), 490)
    label(im, 'MEET YOUR DEVELOPER WORKSPACE', (98, 231), 23, SIGNAL, mono=True)
    label(im, 'DevOne', (90, 330 + 90 * (1 - e)), 182, PAPER, True)
    label(im, 'Every tool.', (98, 553), 80, PAPER, True)
    label(im, 'One place.', (98, 650), 80, SIGNAL, True)
    label(im, 'Built around your project.', (101, 813), 32, MUTED)
    chrome(im, t)
    return im


def montage(t):
    im = BG.copy()
    u = t - 33
    names = ['board', 'git', 'database', 'api', 'docs', 'drawings', 'pipelines', 'terminal']
    for i, name in enumerate(names):
        row, col = divmod(i, 4)
        x = -54 + col * 510
        y = 90 + row * 545
        drift = math.sin(u + i) * 20
        panel(im, name, x + drift, y + (1 - ease((u - i * 0.025) / 0.7)) * 130, 485, 3 if i % 2 else -3, 0.54)
    overlay = Image.new('RGBA', (W, H))
    ImageDraw.Draw(overlay).rounded_rectangle((296, 286, 1624, 778), 30, fill=(10, 12, 9, 246), outline=(76, 94, 52), width=2)
    im.paste(overlay, (0, 0), overlay)
    centered(im, 'Every tool.', 347, 141)
    centered(im, 'One place.', 513, 141, SIGNAL)
    centered(im, 'BOARD / GIT / DATA / API / DOCS / DRAWINGS / CI/CD / SSH', 720, 23, MUTED, False)
    chrome(im, t)
    return im


def ending(t):
    u = t - 36
    e = ease(u / 0.7)
    im = Image.new('RGB', (W, H), SIGNAL)
    d = ImageDraw.Draw(im)
    # Oversized contour lines bring the identity home without hiding the CTA.
    for r in (330, 430, 535):
        d.ellipse((1430 - r, 495 - r, 1430 + r, 495 + r), outline=(154, 212, 43), width=2)
    mark(im, 1125 + 80 * (1 - e), 213, 550, True)
    label(im, 'YOUR WORK. YOUR WORKSPACE.', (100, 127), 24, INK, mono=True)
    label(im, 'DevOne', (88, 272 + (1 - e) * 80), 178, INK, True)
    label(im, 'Bring the whole', (99, 493), 78, INK, True)
    label(im, 'project home.', (99, 590), 78, INK, True)
    label(im, 'Self-hosted. Open source. Yours.', (103, 727), 32, INK)
    d.rounded_rectangle((100, 822, 745, 914), 16, fill=INK)
    label(im, 'Try DevOne', (134, 844), 40, PAPER, True)
    label(im, 'dev-one.site', (384, 857), 26, SIGNAL, mono=True)
    # A small drawn arrow is motion artwork, separate from application icons.
    x = 698 + math.sin(u * 2) * 5
    d.line((x - 15, 868, x + 15, 868), fill=SIGNAL, width=3)
    d.line((x + 4, 857, x + 15, 868, x + 4, 879), fill=SIGNAL, width=3)
    label(im, 'DESKTOP + WEB', (104, 982), 21, INK, mono=True)
    label(im, 'EVERY TOOL. ONE PLACE.', (W - 461, 982), 21, INK, mono=True)
    return im


def scene(t):
    if t < 4:
        return intro(t)
    if t < 7:
        return reveal(t)
    for spec in FEATURES:
        if spec[0] <= t < spec[1]:
            im = BG.copy()
            feature(im, t, spec)
            return im
    if t < 36:
        return montage(t)
    return ending(t)


CUTS = [2, 4, 7, 9, 11, 13, 17, 21, 25, 27, 29, 31, 33, 36]


def frame(t):
    im = scene(t)
    # Beat-synced graphic slits, never a full-screen white flash.
    for cut in CUTS:
        delta = t - cut
        if 0 <= delta < 0.18:
            d = ImageDraw.Draw(im)
            x = int((delta / 0.18) * (W + 180) - 180)
            d.polygon([(x, 0), (x + 85, 0), (x + 265, H), (x + 180, H)], fill=SIGNAL)
    return im


def score():
    """Original E-minor electronic score and transition sounds; no stock assets."""
    sr = 48000
    n = DURATION * sr
    left, right = array('f', [0]) * n, array('f', [0]) * n
    rng = random.Random(19)

    def add(start, length, voice, gain=1, pan=0):
        begin = int(start * sr)
        size = min(int(length * sr), n - begin)
        gl, gr = gain * (0.75 - pan * 0.25), gain * (0.75 + pan * 0.25)
        for j in range(max(0, size)):
            value = voice(j / sr, j)
            left[begin + j] += value * gl
            right[begin + j] += value * gr

    for beat in range(math.ceil(DURATION * 2)):
        at = beat * 0.5
        if at < 4 or at >= DURATION - 4:
            continue
        level = 0.68 if at >= 7 else 0.40
        def kick(t, j):
            phase = math.tau * (46 * t + 110 * 0.027 * (1 - math.exp(-t / 0.027)))
            return math.sin(phase) * math.exp(-t * 12) + 0.15 * rng.uniform(-1, 1) * math.exp(-t * 160)
        add(at, 0.42, kick, level)
        if beat % 2:
            def snare(t, j):
                return (rng.uniform(-1, 1) * 0.75 + math.sin(math.tau * 180 * t) * 0.25) * math.exp(-t * 26)
            add(at, 0.20, snare, 0.24)
        for off in (0.0, 0.25):
            def hat(t, j):
                return rng.uniform(-1, 1) * math.exp(-t * 90)
            add(at + off, 0.085, hat, 0.10 if off == 0 else 0.14, -0.5 if beat % 2 else 0.5)

    bass = [41.2034, 65.4064, 55.0, 61.7354]
    for step in range(math.ceil(DURATION * 4)):
        at = 4 + step * 0.25
        if at >= DURATION - 6:
            break
        f = bass[int((at - 4) / 4) % 4]
        if step % 8 in (3, 7):
            f *= 2
        def voice(t, j, f=f):
            phase = math.tau * f * t
            return (math.sin(phase) + 0.28 * math.sin(phase * 2) + 0.10 * math.sin(phase * 3)) * min(1, t * 160) * math.exp(-t * 16)
        add(at, 0.23, voice, 0.24)

    melody = [329.6276, 493.8833, 587.3295, 391.9954, 329.6276, 659.2551, 493.8833, 440.0]
    for i in range(math.ceil(DURATION * 4)):
        at = 4 + i * 0.25
        if at >= DURATION - 6:
            break
        f = melody[i % len(melody)]
        def pluck(t, j, f=f):
            phase = math.tau * f * t
            return (math.sin(phase) + 0.22 * math.sin(phase * 2) + 0.08 * math.sin(phase * 4)) * min(1, t * 300) * math.exp(-t * 8)
        gain = 0.09 if at < 7 else 0.13
        add(at, 0.7, pluck, gain, -0.5 if i % 2 else 0.5)
        add(at + 0.375, 0.55, pluck, gain * 0.28, 0.8 if i % 2 else -0.8)

    chords = [[164.8138, 195.9977, 246.9417], [130.8128, 164.8138, 195.9977],
              [110, 130.8128, 164.8138], [123.4708, 146.8324, 184.9972]]
    for bar in range(math.ceil(DURATION / 4)):
        at = bar * 4
        chord = chords[bar % 4] if at < DURATION - 6 else chords[0]
        def pad(t, j, chord=chord):
            fade = min(1, t / 0.9) * min(1, (6 - t) / 1.6)
            return sum(math.sin(math.tau * f * t) + 0.3 * math.sin(math.tau * f * 1.002 * t) for f in chord) / 4 * fade
        add(at, min(6, DURATION - at), pad, 0.075 if at < DURATION - 6 else 0.11, -0.1)

    for cut in CUTS:
        start = max(0, cut - 0.20)
        def whoosh(t, j):
            env = math.sin(math.pi * t / 0.4) ** 2
            return (rng.uniform(-1, 1) * 0.65 + 0.35 * math.sin(math.tau * (240 * t + 1800 * t * t))) * env
        add(start, 0.40, whoosh, 0.105)
    # Resolve to E on the brand CTA.
    for f in (164.8138, 329.6276, 493.8833, 659.2551):
        def bell(t, j, f=f):
            return math.sin(math.tau * f * t) * math.exp(-t * 1.1) * min(1, t * 100)
        add(DURATION - 6, 5.9, bell, 0.11)

    peak = max(max(abs(x) for x in left), max(abs(x) for x in right))
    normalization = min(1.25, 0.86 / peak)
    pcm = array('h')
    for i in range(n):
        fade = min(1, i / (sr * 0.35), (n - i) / (sr * 1.6))
        pcm.append(round(left[i] * normalization * fade * 32767))
        pcm.append(round(right[i] * normalization * fade * 32767))
    if sys.byteorder != 'little':
        pcm.byteswap()
    with wave.open(str(OUT / 'soundtrack.wav'), 'wb') as output:
        output.setparams((2, 2, sr, 0, 'NONE', 'not compressed'))
        output.writeframes(pcm.tobytes())
    print(f'Original score: {DURATION}s stereo, peak {peak * normalization:.3f}', flush=True)


def previews():
    frame(38.2).save(OUT / 'poster.png')
    times = [1.1, 4.8, 8.3, 13.9, 18.3, 22.4, 27.5, 31.6, 38.2]
    sheet = Image.new('RGB', (1440, 882), INK)
    for i, t in enumerate(times):
        shot = frame(t).resize((480, 270), Image.Resampling.LANCZOS)
        x, y = (i % 3) * 480, (i // 3) * 294
        sheet.paste(shot, (x, y))
        ImageDraw.Draw(sheet).text((x + 12, y + 275), f'{t:04.1f}s', font=font(14, mono=True), fill=SIGNAL)
    sheet.save(OUT / 'storyboard.jpg', quality=93)
    print('Poster and visual storyboard saved.', flush=True)


def render():
    audio = OUT / 'soundtrack.wav'
    if not audio.exists():
        score()
    destination = OUT / 'devone-promo.mp4'
    command = ['ffmpeg', '-y', '-hide_banner', '-loglevel', 'warning',
               '-f', 'rawvideo', '-pixel_format', 'rgb24', '-video_size', f'{W}x{H}', '-framerate', str(FPS), '-i', 'pipe:0',
               '-i', str(audio), '-c:v', 'libopenh264', '-b:v', '14M', '-g', '60',
               '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '256k', '-ar', '48000',
               '-movflags', '+faststart', '-t', str(DURATION),
               '-metadata', 'title=DevOne — Every tool. One place.',
               '-metadata', 'comment=Actual DevOne demo app captures; original motion design and synthesized score.', str(destination)]
    process = subprocess.Popen(command, stdin=subprocess.PIPE)
    started = time.monotonic()
    try:
        for i in range(FPS * DURATION):
            process.stdin.write(frame(i / FPS).tobytes())
            if i % (FPS * 3) == 0:
                print(f'Rendered {i / FPS:04.1f}/{DURATION}s; elapsed {time.monotonic() - started:.1f}s', flush=True)
    finally:
        process.stdin.close()
    if process.wait() != 0:
        raise RuntimeError('FFmpeg failed')
    print(f'Exported {destination}', flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--preview-only', action='store_true')
    parser.add_argument('--audio-only', action='store_true')
    args = parser.parse_args()
    load_assets()
    if args.audio_only:
        score()
    else:
        previews()
        if not args.preview_only:
            render()
