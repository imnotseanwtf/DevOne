#!/usr/bin/env python3
"""Render project setup, the feature tour, and an open-source contribution invitation."""

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
OUTRO = 7.0
CUES = {
    'project': [(0, 'Start with a project.', 'Choose your repository. Name your workspace.')],
    'board': [(0, 'This is your board.', 'Plan your work. Keep every task moving.')],
    'git': [(0, 'This is your Git workspace.', 'Open files. Write code. Review your changes.')],
    'database': [(0, 'This is your database.', 'Query your data. Understand your schema.')],
    'api': [(0, 'This is your API client.', 'Your requests, organized by project.')],
    'docs': [(0, 'This is your docs hub.', 'Keep the knowledge beside the work.'),
             (3.4, 'This is your drawing canvas.', 'Turn ideas into architecture.')],
    'terminal': [(0, 'These are your pipelines.', 'See what is building and shipping.'),
                 (2.27, 'This is your terminal.', 'Run commands right inside the workspace.')]
}


def prepare():
    walkthrough.ORDER[:] = ['project', 'board', 'git', 'database', 'api', 'docs', 'terminal']
    walkthrough.COPY['project'] = ('Start with a project.', 'Choose your repository. Name your workspace.')
    walkthrough.CLIPS.clear()
    duration = walkthrough.prepare() - 3 + INTRO + OUTRO
    for clip in walkthrough.CLIPS:
        clip['start'] += INTRO
    return duration


def ending(t):
    im = Image.new('RGB', (1920, 1080), brand.SIGNAL)
    d = ImageDraw.Draw(im)
    for radius in (330, 430, 535):
        d.ellipse((1430 - radius, 495 - radius, 1430 + radius, 495 + radius),
                  outline=(154, 212, 43), width=2)
    brand.mark(im, 1125 + 80 * (1 - brand.ease(t / 0.7)), 213, 550, True)
    brand.label(im, 'YOUR WORK. YOUR WORKSPACE.', (100, 127), 24, brand.INK, mono=True)
    brand.label(im, 'DevOne', (88, 272 + 80 * (1 - brand.ease(t / 0.7))), 178, brand.INK, True)
    offset = round(24 * (1 - brand.ease(t / 0.55)))
    brand.label(im, 'DevOne is', (99, 493 + offset), 78, brand.INK, True)
    brand.label(im, 'open source.', (99, 590 + offset), 78, brand.INK, True)
    brand.label(im, 'Feel free to contribute.', (103, 727), 47, brand.INK, True)
    d.rounded_rectangle((100, 822, 1645, 914), 16, fill=brand.INK)
    brand.label(im, 'github.com/imnotseanwtf/devone', (134, 851), 38, brand.SIGNAL, mono=True)
    brand.label(im, 'Ideas, issues, docs, code — every contribution helps.', (104, 943), 25, brand.INK)
    brand.label(im, 'DESKTOP + WEB', (104, 982), 21, brand.INK, mono=True)
    brand.label(im, 'EVERY TOOL. ONE PLACE.', (1459, 982), 21, brand.INK, mono=True)
    return im


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
    if t >= duration - OUTRO:
        return ending(t - (duration - OUTRO))
    im = walkthrough.compose(t, duration - OUTRO + 3)
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
    brand.label(im, f'{walkthrough.ORDER.index(clip["name"]) + 1:02d} / {len(walkthrough.ORDER):02d}',
                (1740, 1049), 17, brand.MUTED, mono=True)
    callout(im, title, description, local - start, finish - start)
    return im


def main():
    duration = prepare()
    compose(1.6, duration).save(OUT / 'story-poster.png')
    sheet = Image.new('RGB', (1440, 1176), brand.INK)
    samples = [1.6, 4.4, 7.4, INTRO + 2.0, INTRO + walkthrough.CLIPS[0]['duration'] - 1.0,
               walkthrough.CLIPS[1]['start'] + 1.9, walkthrough.CLIPS[2]['start'] + 1.5,
               walkthrough.CLIPS[3]['start'] + 1.6, walkthrough.CLIPS[4]['start'] + 1.7,
               walkthrough.CLIPS[5]['start'] + 4.4, walkthrough.CLIPS[6]['start'] + 3.7,
               duration - 2.0]
    for i, t in enumerate(samples):
        x, y = (i % 3) * 480, (i // 3) * 294
        sheet.paste(compose(t, duration).resize((480, 270), Image.Resampling.LANCZOS), (x, y))
        brand.label(sheet, f'{t:.1f}s', (x + 12, y + 275), 14, brand.SIGNAL, mono=True)
    sheet.save(OUT / 'story-storyboard.jpg', quality=95)
    if '--preview-only' in sys.argv:
        print('Story preview saved.', flush=True)
        return
    audio = walkthrough.soundtrack(duration, closing_seconds=OUTRO)
    destination = OUT / 'devone-promo-story.mp4'
    pending = OUT / 'devone-promo-story.pending.mp4'
    command = ['ffmpeg', '-y', '-hide_banner', '-loglevel', 'warning', '-f', 'rawvideo',
               '-pixel_format', 'rgb24', '-video_size', '1920x1080', '-framerate', '30', '-i', 'pipe:0',
               '-i', str(audio), '-c:v', 'libopenh264', '-b:v', '18M', '-g', '60', '-pix_fmt', 'yuv420p',
               '-af', 'loudnorm=I=-16:TP=-1.5:LRA=9', '-c:a', 'aac', '-b:a', '256k', '-ar', '48000',
               '-movflags', '+faststart', '-t', str(duration), '-metadata', 'title=DevOne — Too many projects?',
               '-metadata', 'comment=Real app interactions with project setup, nine feature introductions, music, click effects, and an open-source contribution invitation.',
               str(pending)]
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
    subprocess.run(['ffmpeg', '-v', 'error', '-i', str(pending), '-f', 'null', '-'], check=True)
    pending.replace(destination)
    (OUT / 'story-metadata.json').write_text(json.dumps({
        'duration': duration, 'fps': 30, 'size': [1920, 1080], 'opening_seconds': INTRO,
        'closing_seconds': OUTRO,
        'closing_message': 'DevOne is open source. Feel free to contribute.',
        'contribution_url': 'https://github.com/imnotseanwtf/devone',
        'project_setup_note': 'Public-demo capture of repository selection and project naming; saving new projects is disabled in the demo.',
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
