#!/usr/bin/env python3
"""Check the story's timeline boundaries without encoding the full film."""
import render_story as story

assert 'project' in story.CUES, 'Project setup must appear before the tool tour'
assert story.OUTRO >= 6, 'Leave enough time to read the contribution invitation'
duration = story.prepare()
clips = story.walkthrough.CLIPS
assert clips[0]['name'] == 'project'
assert clips[0]['start'] == story.INTRO
for previous, following in zip(clips, clips[1:]):
    assert abs(previous['start'] + previous['duration'] - following['start']) < 1e-8
assert abs(clips[-1]['start'] + clips[-1]['duration'] - (duration - story.OUTRO)) < 1e-8
for t in [0, story.INTRO - 1/30, *[c['start'] + 1/30 for c in clips],
          duration - story.OUTRO, duration - 1/30]:
    frame = story.compose(t, duration)
    assert frame.size == (1920, 1080) and frame.mode == 'RGB'
print(f'Story boundaries passed: {duration:.3f}s, {len(clips)} recorded chapters.')
