#!/usr/bin/env python3
"""Compose the recorded DevOne walkthrough with a cursor, click pulses, and camera tracking."""

from array import array
from functools import lru_cache
import json
import math
from pathlib import Path
import subprocess
import sys
import wave

from PIL import Image, ImageDraw
import render as brand

OUT = Path(__file__).resolve().parent
RAW = Path('/tmp/devone-promo/interactions')
RECORDINGS = OUT / 'recordings'
FPS = 30
ORDER = ['board', 'git', 'database', 'api', 'docs', 'terminal']
COPY = {
    'board': ('Plan the next thing.', 'Open a task. Edit it. See it your way.'),
    'git': ('Then make it happen.', 'Open files. Write code. Review your changes.'),
    'database': ('Find the answer.', 'Type a query. Run it. Explore the schema.'),
    'api': ('Keep the API close.', 'Switch requests. Inspect bodies and headers.'),
    'docs': ('Keep the context, too.', 'Documentation and architecture beside the work.'),
    'terminal': ('Stay in the flow.', 'Pipelines and terminal, right here.')
}
CLIPS = []


def prepare():
    RECORDINGS.mkdir(exist_ok=True)
    at = 0.0
    for name in ORDER:
        timeline = RECORDINGS / f'{name}.json'
        source = RAW / name
        if (source / 'timeline.json').exists():
            data = json.loads((source / 'timeline.json').read_text())
            timeline.write_text(json.dumps(data))
            subprocess.run(['ffmpeg', '-y', '-hide_banner', '-loglevel', 'error', '-framerate', str(data['fps']),
                            '-i', str(source / '%05d.jpg'), '-frames:v', str(len(data['frames'])),
                            '-c:v', 'libopenh264', '-b:v', '16M', '-pix_fmt', 'yuv420p',
                            '-movflags', '+faststart', str(RECORDINGS / f'{name}.mp4')], check=True)
        else:
            data = json.loads(timeline.read_text())
            source.mkdir(parents=True, exist_ok=True)
            subprocess.run(['ffmpeg', '-y', '-hide_banner', '-loglevel', 'error',
                            '-i', str(RECORDINGS / f'{name}.mp4'), '-q:v', '2', '-start_number', '0',
                            str(source / '%05d.jpg')], check=True)
        # A camera controller keeps the real cursor inside the frame while easing between actions.
        cameras = []
        cx, cy, zoom = 960.0, 540.0, 1.0
        for item in data['frames']:
            px, py = item['cursor']
            desired_zoom = min(1.7, 1 + (item['zoom'] - 1) * 2.3)
            zoom += (desired_zoom - zoom) * 0.14
            target_x, target_y = item['focus']
            half_w, half_h = 1920 / zoom / 2, 1048 / zoom / 2
            # Follow long journeys to controls outside the current focus area.
            target_x = max(px - half_w + 110, min(px + half_w - 110, target_x))
            target_y = max(py - half_h + 80, min(py + half_h - 80, target_y))
            target_x = max(half_w, min(1920 - half_w, target_x))
            target_y = max(32 + half_h, min(1080 - half_h, target_y))
            cx += (target_x - cx) * 0.15
            cy += (target_y - cy) * 0.15
            cameras.append([cx, cy, zoom])
        CLIPS.append({'name': name, 'start': at, 'duration': len(data['frames']) / data['fps'],
                      'data': data, 'source': source, 'camera': cameras})
        at += CLIPS[-1]['duration']
    return at + 3.0


@lru_cache(maxsize=4)
def raw_frame(name, number):
    return Image.open(RAW / name / f'{number:05d}.jpg').convert('RGB')


def interpolate(a, b, progress):
    return [x + (y - x) * progress for x, y in zip(a, b)]


def pointer(im, x, y, clicks, local):
    d = ImageDraw.Draw(im)
    pressed = False
    for event in clicks:
        age = local - event['time']
        if 0 <= age < 0.42:
            pressed = age < 0.12
            radius = 10 + 50 * (age / 0.42)
            brightness = 1 - age / 0.42
            color = tuple(round(c * brightness + 10 * (1 - brightness)) for c in brand.SIGNAL)
            d.ellipse((event['x'] - radius, event['y'] - radius, event['x'] + radius, event['y'] + radius),
                      outline=color, width=3)
    scale = 0.85 if pressed else 1.0
    points = [(0, 0), (0, 35), (9, 26), (16, 42), (23, 39), (16, 23), (29, 23)]
    shadow = [(x + a * scale + 3, y + b * scale + 4) for a, b in points]
    points = [(x + a * scale, y + b * scale) for a, b in points]
    d.polygon(shadow, fill=(5, 5, 5))
    d.polygon(points, fill=brand.PAPER, outline=(15, 15, 15), width=2)


def compose(t, duration):
    footage_end = duration - 3
    if t >= footage_end:
        return brand.ending(36 + t - footage_end)
    clip = next(c for c in CLIPS if c['start'] <= t < c['start'] + c['duration'])
    local = t - clip['start']
    data = clip['data']
    position = local * data['fps']
    index = min(len(data['frames']) - 1, int(position))
    following = min(len(data['frames']) - 1, index + 1)
    fraction = position - index
    cx, cy, zoom = interpolate(clip['camera'][index], clip['camera'][following], fraction)
    px, py = interpolate(data['frames'][index]['cursor'], data['frames'][following]['cursor'], fraction)
    native = raw_frame(clip['name'], index)
    rw, rh = 1920 / zoom, 1048 / zoom
    x0 = max(0, min(1920 - rw, cx - rw / 2))
    y0 = max(32, min(1080 - rh, cy - rh / 2))
    screen = native.transform((1800, 982), Image.Transform.EXTENT,
                              (x0, y0, x0 + rw, y0 + rh), Image.Resampling.BICUBIC)
    sx, sy = 1800 / rw, 982 / rh
    click_positions = []
    for click in data['clicks']:
        click_positions.append({'x': (click['x'] - x0) * sx, 'y': (click['y'] - y0) * sy,
                                'time': click['frame'] / data['fps']})
    pointer(screen, (px - x0) * sx, (py - y0) * sy, click_positions, local)
    # The actual interface fills the composition; small captions leave the interaction visible.
    im = brand.BG.copy()
    mask = Image.new('L', screen.size)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, 1799, 981), 16, fill=255)
    im.paste(screen, (60, 46), mask)
    d = ImageDraw.Draw(im)
    d.rounded_rectangle((60, 46, 1859, 1027), 16, outline=(77, 86, 65), width=2)
    brand.mark(im, 60, -3, 50)
    brand.label(im, 'DevOne', (112, 13), 23, brand.PAPER, True)
    brand.label(im, 'ONE WORKSPACE. A REAL WORKFLOW.', (1150, 17), 17, brand.MUTED, mono=True)
    title, subtitle = COPY[clip['name']]
    brand.label(im, title, (70, 1044), 25, brand.SIGNAL, True)
    brand.label(im, subtitle, (470, 1048), 20, brand.PAPER)
    brand.label(im, f'{ORDER.index(clip["name"]) + 1:02d} / 06', (1740, 1049), 17, brand.MUTED, mono=True)
    # Very brief black dissolve at editorial cuts, preserving natural cursor movement in each clip.
    edge = min(local, clip['duration'] - local)
    if edge < 0.10 and clip['start'] > 0:
        alpha = max(0, min(1, edge / 0.10))
        im = Image.blend(Image.new('RGB', im.size, brand.INK), im, alpha)
    if t < 0.3:
        im = Image.blend(Image.new('RGB', im.size, brand.INK), im, t / 0.3)
    return im


def soundtrack(duration, closing_seconds=3):
    audio_out = OUT / 'walkthrough-audio'
    audio_out.mkdir(exist_ok=True)
    brand.OUT = audio_out
    brand.DURATION = math.ceil(duration)
    brand.CUTS = [clip['start'] for clip in CLIPS[1:]] + [duration - closing_seconds]
    brand.score()
    with wave.open(str(audio_out / 'soundtrack.wav'), 'rb') as source:
        rate = source.getframerate()
        pcm = array('h', source.readframes(source.getnframes()))
    if sys.byteorder != 'little':
        pcm.byteswap()
    # Lower the music under the dry mouse clicks; keep enough headroom for the mix.
    for i in range(len(pcm)):
        pcm[i] = round(pcm[i] * 0.74)
    for clip in CLIPS:
        for event in clip['data']['clicks']:
            begin = int((clip['start'] + event['frame'] / clip['data']['fps']) * rate)
            for j in range(int(rate * 0.045)):
                at = (begin + j) * 2
                if at + 1 >= len(pcm):
                    break
                value = round(math.sin(math.tau * (1200 * j / rate + 4400 * (j / rate) ** 2)) *
                              math.exp(-j / rate * 125) * 4700)
                pcm[at] = max(-32767, min(32767, pcm[at] + value))
                pcm[at + 1] = max(-32767, min(32767, pcm[at + 1] + value))
    # The music resolves and fades with the actual film duration, including its final brand hold.
    end = min(len(pcm) // 2, math.ceil(duration * rate))
    for j in range(max(0, end - rate), end):
        factor = (end - j) / rate
        pcm[j * 2] = round(pcm[j * 2] * factor)
        pcm[j * 2 + 1] = round(pcm[j * 2 + 1] * factor)
    if sys.byteorder != 'little':
        pcm.byteswap()
    destination = audio_out / 'mixed.wav'
    with wave.open(str(destination), 'wb') as output:
        output.setparams((2, 2, rate, 0, 'NONE', 'not compressed'))
        output.writeframes(pcm.tobytes())
    return destination


def main():
    duration = prepare()
    poster_time = 2.8
    compose(poster_time, duration).save(OUT / 'walkthrough-poster.png')
    sheet = Image.new('RGB', (1440, 882), brand.INK)
    samples = [3.9, 7.7, CLIPS[1]['start'] + 5.3, CLIPS[2]['start'] + 7.8,
               CLIPS[2]['start'] + 9.5, CLIPS[3]['start'] + 2.7,
               CLIPS[4]['start'] + 5.7, CLIPS[5]['start'] + 8.1, duration - 1]
    for i, at in enumerate(samples):
        x, y = (i % 3) * 480, (i // 3) * 294
        sheet.paste(compose(at, duration).resize((480, 270), Image.Resampling.LANCZOS), (x, y))
        brand.label(sheet, f'{at:.1f}s', (x + 12, y + 275), 14, brand.SIGNAL, mono=True)
    sheet.save(OUT / 'walkthrough-storyboard.jpg', quality=95)
    if '--preview-only' in sys.argv:
        return
    audio = soundtrack(duration)
    destination = OUT / 'devone-walkthrough.mp4'
    command = ['ffmpeg', '-y', '-hide_banner', '-loglevel', 'warning', '-f', 'rawvideo', '-pixel_format', 'rgb24',
               '-video_size', '1920x1080', '-framerate', str(FPS), '-i', 'pipe:0', '-i', str(audio),
               '-c:v', 'libopenh264', '-b:v', '18M', '-g', '60', '-pix_fmt', 'yuv420p',
               '-c:a', 'aac', '-b:a', '256k', '-movflags', '+faststart', '-t', str(duration),
               '-metadata', 'title=DevOne — A real workflow',
               '-metadata', 'comment=Real browser clicks and keyboard input, edited with camera tracking and cursor highlights.', str(destination)]
    process = subprocess.Popen(command, stdin=subprocess.PIPE)
    try:
        for i in range(round(duration * FPS)):
            process.stdin.write(compose(i / FPS, duration).tobytes())
            if i % (FPS * 5) == 0:
                print(f'Walkthrough rendered {i / FPS:.1f}/{duration:.1f}s', flush=True)
    finally:
        process.stdin.close()
    if process.wait() != 0:
        raise RuntimeError('Video encoding failed')
    (OUT / 'walkthrough-metadata.json').write_text(json.dumps({
        'duration': duration, 'fps': FPS, 'size': [1920, 1080], 'native_capture_fps': 15,
        'actual_clicks': sum(len(clip['data']['clicks']) for clip in CLIPS),
        'chapters': [{'name': c['name'], 'start': c['start'], 'duration': c['duration']} for c in CLIPS]
    }, indent=2))
    print('Exported', destination, flush=True)


if __name__ == '__main__':
    main()
