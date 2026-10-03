#!/usr/bin/env python3
"""Add a relatable opening, feature introductions, and an audible music mix to the approved walkthrough."""

from functools import lru_cache
import json
from pathlib import Path
import subprocess
import sys

from PIL import Image, ImageDraw, ImageFilter
import render as brand
import render_walkthrough as walkthrough

OUT = Path(__file__).resolve().parent
INTRO = 8.5
CUES = {
    'board': [(0, 'This is your board.', 'Plan your work. Keep every task moving.')],
    'git': [(0, 'This is your Git workspace.', 'Open files. Write code. Review your changes.')],
    'database': [(0, 'This is your database.', 'Query your data. Understand your schema.')],
    'api': [(0, 'This is your API client.', 'Your requests, organized by project.')],
    'docs': [(0, 'This is your docs hub.', 'Keep the knowledge beside the work.'),
             (3.4, 'This is your drawing canvas.', 'Turn ideas into architecture.')],
    'terminal': [(0, 'These are your pipelines.', 'See what is building and shipping.'),
                 (2.27, 'This is your terminal.', 'Run commands right inside the workspace.')]
}


@lru_cache(maxsize=1)
def intro_background():
    native = walkthrough.raw_frame('board', 0)
    native = native.crop((0, 32, 1920, 1080)).resize((1920, 1080), Image.Resampling.LANCZOS)
    native = native.filter(ImageFilter.GaussianBlur(6))
    return Image.blend(brand.BG, native, 0.20)


def intro(t):
    im = intro_background().copy()
    if t < 3:
        local = t
        title, accent = 'Too many projects?', ''
        description = 'Too many tabs. Too much to keep track of.'
    elif t < 6:
        local = t - 3
        title, accent = 'Ever feel', 'a little lost?'
        description = "What is next? Where did you leave off?"
    else:
        local = t - 6
        title, accent = 'Meet DevOne.', ''
        description = 'Everything your project needs. Together.'
    e = brand.ease(local / 0.55)
    offset = round((1 - e) * 55)
    brand.mark(im, 80, 44, 76)
    brand.label(im, 'DevOne', (167, 70), 36, brand.PAPER, True)
    brand.label(im, 'FOR DEVELOPERS JUGGLING IT ALL', (106, 250), 25, brand.SIGNAL, mono=True)
    brand.label(im, title, (98, 359 + offset), 128, brand.PAPER, True)
    if accent:
        brand.label(im, accent, (98, 508 + offset), 128, brand.SIGNAL, True)
    elif t >= 6:
        brand.mark(im, 1405, 292 + offset, 350)
        brand.label(im, 'Less switching. More clarity.', (105, 535), 54, brand.SIGNAL, True)
    brand.label(im, description, (107, 720 + offset // 2), 40, brand.MUTED)
    d = ImageDraw.Draw(im)
    d.line((108, 896, 1812, 896), fill=(65, 78, 48), width=2)
    brand.label(im, 'EVERY TOOL. ONE PLACE.', (108, 934), 24, brand.MUTED, mono=True)
    for i in range(3):
        x = 1710 + i * 38
        active = i == min(2, int(t / 3))
        d.ellipse((x, 940, x + 12, 952), fill=brand.SIGNAL if active else (55, 61, 45))
    if t < 0.3:
        im = Image.blend(Image.new('RGB', im.size, brand.INK), im, t / 0.3)
    return im


def callout(im, title, description, age, length):
    if not 0 <= age < min(2.65, length):
        return
    end = min(2.65, length)
    opacity = brand.ease(age / 0.32) * (1 - brand.smooth((age - end + 0.36) / 0.36))
    offset = round((1 - brand.ease(age / 0.4)) * 48)
    layer = Image.new('RGBA', (1920, 1080))
    d = ImageDraw.Draw(layer)
    x, y = 106, 806 + offset
    width = max(820, round(brand.font(51, True).getlength(title)) + 95)
    d.rounded_rectangle((x, y, x + width, y + 178), radius=18, fill=(10, 12, 9, 242),
                        outline=(86, 107, 57, 255), width=2)
    d.rounded_rectangle((x, y + 22, x + 5, y + 156), radius=2, fill=brand.SIGNAL)
    d.text((x + 31, y + 26), title, font=brand.font(51, True), fill=brand.PAPER, anchor='lt')
    d.text((x + 33, y + 105), description, font=brand.font(28), fill=brand.SIGNAL, anchor='lt')
    layer.putalpha(layer.getchannel('A').point(lambda a: round(a * opacity)))
    im.paste(layer, (0, 0), layer)


def compose(t, duration):
    if t < INTRO:
        return intro(t)
    im = walkthrough.compose(t, duration)
    if t >= duration - 3:
        return im
    clip = next(c for c in walkthrough.CLIPS if c['start'] <= t < c['start'] + c['duration'])
    local = t - clip['start']
    cues = CUES[clip['name']]
    current = max(i for i, cue in enumerate(cues) if cue[0] <= local)
    start, title, description = cues[current]
    finish = cues[current + 1][0] if current + 1 < len(cues) else clip['duration']
    # Keep a clear feature label after the larger introduction disappears.
    ImageDraw.Draw(im).rectangle((60, 1036, 1859, 1079), fill=brand.INK)
    brand.label(im, title, (70, 1044), 25, brand.SIGNAL, True)
    brand.label(im, description, (600, 1048), 20, brand.PAPER)
    brand.label(im, f'{walkthrough.ORDER.index(clip["name"]) + 1:02d} / 06',
                (1740, 1049), 17, brand.MUTED, mono=True)
    callout(im, title, description, local - start, finish - start)
    return im


def main():
    duration = walkthrough.prepare() + INTRO
    for clip in walkthrough.CLIPS:
        clip['start'] += INTRO
    compose(1.6, duration).save(OUT / 'story-poster.png')
    sheet = Image.new('RGB', (1440, 882), brand.INK)
    samples = [1.6, 4.4, 7.4, INTRO + 1.9,
               walkthrough.CLIPS[1]['start'] + 1.5, walkthrough.CLIPS[2]['start'] + 1.6,
               walkthrough.CLIPS[3]['start'] + 1.7, walkthrough.CLIPS[4]['start'] + 4.4,
               walkthrough.CLIPS[5]['start'] + 3.7]
    for i, t in enumerate(samples):
        x, y = (i % 3) * 480, (i // 3) * 294
        sheet.paste(compose(t, duration).resize((480, 270), Image.Resampling.LANCZOS), (x, y))
        brand.label(sheet, f'{t:.1f}s', (x + 12, y + 275), 14, brand.SIGNAL, mono=True)
    sheet.save(OUT / 'story-storyboard.jpg', quality=95)
    if '--preview-only' in sys.argv:
        print('Story preview saved.', flush=True)
        return
    audio = walkthrough.soundtrack(duration)
    destination = OUT / 'devone-promo-story.mp4'
    command = ['ffmpeg', '-y', '-hide_banner', '-loglevel', 'warning', '-f', 'rawvideo',
               '-pixel_format', 'rgb24', '-video_size', '1920x1080', '-framerate', '30', '-i', 'pipe:0',
               '-i', str(audio), '-c:v', 'libopenh264', '-b:v', '18M', '-g', '60', '-pix_fmt', 'yuv420p',
               '-af', 'loudnorm=I=-16:TP=-1.5:LRA=9', '-c:a', 'aac', '-b:a', '256k', '-ar', '48000',
               '-movflags', '+faststart', '-t', str(duration), '-metadata', 'title=DevOne — Too many projects?',
               '-metadata', 'comment=Real app interactions with an opening story, eight feature introductions, music, and click effects.',
               str(destination)]
    process = subprocess.Popen(command, stdin=subprocess.PIPE)
    try:
        for i in range(round(duration * 30)):
            process.stdin.write(compose(i / 30, duration).tobytes())
            if i % 150 == 0:
                print(f'Story rendered {i / 30:.1f}/{duration:.1f}s', flush=True)
    finally:
        process.stdin.close()
    if process.wait() != 0:
        raise RuntimeError('Video encoding failed')
    (OUT / 'story-metadata.json').write_text(json.dumps({
        'duration': duration, 'fps': 30, 'size': [1920, 1080], 'opening_seconds': INTRO,
        'actual_clicks': sum(len(c['data']['clicks']) for c in walkthrough.CLIPS),
        'feature_introductions': [{'time': c['start'] + cue[0], 'title': cue[1], 'description': cue[2]}
                                 for c in walkthrough.CLIPS for cue in CUES[c['name']]],
        'music_loudness_target_lufs': -16,
        'chapters': [{'name': c['name'], 'start': c['start'], 'duration': c['duration']}
                     for c in walkthrough.CLIPS]
    }, indent=2))
    print('Exported', destination, flush=True)


if __name__ == '__main__':
    main()
