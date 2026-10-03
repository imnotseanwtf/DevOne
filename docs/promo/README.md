# DevOne promotional film

## Latest cut: opening story and feature introductions

[`devone-promo-story.mp4`](devone-promo-story.mp4) keeps the real clicks and typing
from the interaction-led cut and adds an opening about juggling projects:
“Too many projects?” → “Ever feel a little lost?” → “Meet DevOne.”

Eight animated captions introduce the board, Git workspace, database, API client,
docs hub, drawing canvas, pipelines, and terminal. Each caption includes a short
benefit, then clears to let the interaction continue. The original electronic
music is mixed more prominently, with click effects aligned to the recorded input
and a −16 LUFS loudness target.

- [`story-poster.png`](story-poster.png) — latest cover image.
- [`story-storyboard.jpg`](story-storyboard.jpg) — latest contact sheet.
- [`render_story.py`](render_story.py) — opening, captions, and music mix source.
- [`story-metadata.json`](story-metadata.json) — caption timing and export details.

Re-render from the same bundled browser recordings:

```sh
python3 docs/promo/render_story.py --preview-only
python3 docs/promo/render_story.py
```

The latest export fully decodes with FFmpeg without errors. FFprobe verifies
58.766667 seconds, 1,763 frames, 1920 × 1080 at 30 fps, H.264 video, and 48 kHz
stereo AAC audio. Measured integrated audio loudness is −16.13 LUFS. Exported
frames were inspected for the opening and all eight feature captions, and the
input timelines retain the original 25 clicks.

## Revised cut: real website interactions

[`devone-walkthrough.mp4`](devone-walkthrough.mp4) is the revised, interaction-led
film. It shows real Firefox pointer and keyboard input in the live DevOne demo:
opening and editing a task, switching board views, opening a Git file and typing
code, typing and running SQL, viewing an ERD, switching API requests and tabs,
opening documentation and drawings, checking pipelines, and typing commands into
the app's sample terminal.

The actual interface fills most of the frame. An enlarged cursor and subtle
click pulses follow the recorded input; an animated camera tracks the interaction.
Small chapter captions and a three-second closing brand card retain the promo format.

- [`walkthrough-poster.png`](walkthrough-poster.png) — revised cover image.
- [`walkthrough-storyboard.jpg`](walkthrough-storyboard.jpg) — revised contact sheet.
- [`recordings/`](recordings/) — six original browser recordings and input timelines.
- [`record_interactions.py`](record_interactions.py) — actual-browser capture source.
- [`render_walkthrough.py`](render_walkthrough.py) — revised composition source.
- [`walkthrough-metadata.json`](walkthrough-metadata.json) — export and chapter details.

The native browser captures are 1920 × 1080 at 15 fps. The composition is exported
at 30 fps, with interpolated cursor and camera movement. Public-demo sample data
is used throughout; terminal commands run in DevOne's own simulated demo shell.
The demo banner is cropped out of the final composition but retained in the source
recordings. No API requests are sent to external services and no Git changes are pushed.

Re-render the revised cut from the bundled recordings:

The revised export was fully decoded with FFmpeg without errors. FFprobe verifies
50.266667 seconds, 1,508 frames, 1920 × 1080 at 30 fps, H.264 video, and 48 kHz
stereo AAC audio. Its encoded audio peak is −3.9 dBFS. The source timelines contain
25 real browser clicks across six recorded workflows, and frames from the final
MP4 were inspected.

```sh
python3 docs/promo/render_walkthrough.py --preview-only
python3 docs/promo/render_walkthrough.py
```

The renderer reuses available capture frames or extracts them from the bundled
MP4 recordings into `/tmp/devone-promo/interactions`. Re-capturing requires an
authenticated temporary demo workspace and Firefox Marionette on port 2829.

## Original typography-led cut

**Every tool. One place.** A 42-second product film with actual DevOne screens,
kinetic typography, layered panels, beat-synchronized transitions, the Prompt
mascot, and an original electronic soundtrack.

- [`devone-promo.mp4`](devone-promo.mp4) — 1920 × 1080, 30 fps, H.264 / AAC stereo.
- [`poster.png`](poster.png) — full-resolution cover image.
- [`storyboard.jpg`](storyboard.jpg) — contact sheet of the film.
- [`soundtrack.wav`](soundtrack.wav) — original 48 kHz stereo music and effects.
- [`render.py`](render.py) — editable rendering source.
- [`screens/`](screens/) — original app captures used in the composition.

## Story

| Time | Scene |
| --- | --- |
| 0–4 s | Too many tabs → less switching, more shipping |
| 4–7 s | DevOne identity and Prompt mascot |
| 7–13 s | Board, list, and calendar |
| 13–17 s | Git workbench |
| 17–21 s | Database tables, SQL results, and ERD |
| 21–25 s | API client |
| 25–29 s | Documentation and architecture drawings |
| 29–33 s | Pipelines and terminal |
| 33–36 s | Whole-workspace montage |
| 36–42 s | Brand reveal and `dev-one.site` call to action |

## Sources

The screenshots were captured on 2026-10-03 from a temporary sample account in
the public DevOne demo at https://www.dev-one.site. They show the real running
interface with seeded sample project data. The terminal is the app's simulated
demo terminal; its simulation label remains in the captured screen. These are
screen captures animated in the film, rather than continuous browser recordings.
The original public-demo banner is outside the composition's screenshot crop.

The creative brief comes from `README.md`, the landing-page feature copy,
`docs/brand-board.png`, the feature implementations, and the actual demo.
The mascot is taken from `public/logo-512.png`. The film uses the brand's
Ink (`#0a0a0a`), Paper (`#fafafa`), and Signal (`#b6f23a`) palette. Typography
uses locally installed Adwaita Sans and Adwaita Mono. All music and transition
sounds were synthesized for this film; no stock media or licensed tracks were used.

## Re-render

Requires Python 3.10+, Pillow, FFmpeg with `libopenh264` and `aac`, and Adwaita
Sans / Mono fonts at the paths configured near the top of `render.py`.
No application dependencies or app configuration changes are required.

```sh
python3 docs/promo/render.py --preview-only
python3 docs/promo/render.py
```

Adjust `FEATURES`, the composition functions, or the soundtrack in `render.py`.
To regenerate the music after editing it:

```sh
python3 docs/promo/render.py --audio-only
python3 docs/promo/render.py
```

## Export verification

The delivered MP4 decodes completely with FFmpeg without errors. FFprobe
reports exactly 42.000 seconds, 1,260 video frames, 1920 × 1080 at 30 fps,
H.264 video, and 48 kHz stereo AAC audio. The encoded audio peaks at −1.3 dBFS.
Representative frames were also extracted from the exported MP4 and inspected.
