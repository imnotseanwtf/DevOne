#!/usr/bin/env python3
"""Record real pointer and keyboard interactions through Firefox Marionette.

Start Firefox with the temporary profile configured on port 2829, then run:
python3 docs/promo/record_interactions.py board
Use --inspect to list the current page's controls without recording.
"""

import base64
import io
import json
from pathlib import Path
import socket
import sys
import time

from PIL import Image

OUT = Path('/tmp/devone-promo/interactions')
BASE_FILE = Path('/tmp/devone-promo/project-url.txt')
FPS = 15
POINTER = 'promo-mouse'


class Browser:
    def __init__(self, port=2829):
        self.socket = socket.create_connection(('127.0.0.1', port), timeout=60)
        self.serial = 0
        self.receive()
        self.command('WebDriver:NewSession', {'capabilities': {}})
        self.command('WebDriver:SetWindowRect', {'width': 1920, 'height': 1166})

    def receive(self):
        length = b''
        while (c := self.socket.recv(1)) != b':':
            if not c:
                raise RuntimeError('Browser disconnected')
            length += c
        data = b''
        while len(data) < int(length):
            data += self.socket.recv(int(length) - len(data))
        return json.loads(data)

    def command(self, name, parameters=None):
        self.serial += 1
        data = json.dumps([0, self.serial, name, parameters or {}]).encode()
        self.socket.sendall(str(len(data)).encode() + b':' + data)
        result = self.receive()
        if result[2]:
            raise RuntimeError(result[2])
        value = result[3]
        return value.get('value', value) if isinstance(value, dict) else value

    def js(self, script):
        return self.command('WebDriver:ExecuteScript', {'script': script, 'args': [], 'newSandbox': True,
                                                     'sandbox': 'default', 'line': 0, 'filename': 'interaction-capture'})

    def navigate(self, path):
        self.command('WebDriver:Navigate', {'url': BASE_FILE.read_text() + path})
        time.sleep(2)

    def element(self, selector):
        result = self.command('WebDriver:FindElement', {'using': 'css selector', 'value': selector})
        return result.get('element-6066-11e4-a52e-4f735466cecf', result.get('ELEMENT'))

    def keys(self, selector, text):
        self.command('WebDriver:ElementSendKeys', {'id': self.element(selector), 'text': text, 'value': list(text)})

    def actions(self, actions):
        self.command('WebDriver:PerformActions', {'actions': [{'type': 'pointer', 'id': POINTER,
                     'parameters': {'pointerType': 'mouse'}, 'actions': actions}]})

    def close(self):
        self.command('WebDriver:DeleteSession')
        self.socket.close()


def text_element(text, exact=True):
    # Prefer actual interactive controls; fall back to the smallest matching text element.
    check = f'e.textContent.trim() === {json.dumps(text)}' if exact else f'e.textContent.includes({json.dumps(text)})'
    return f'([...[...document.querySelectorAll("button,a,[role=button],[role=tab],[role=menuitem],[role=option]")], ...document.querySelectorAll("p,h3,span,label")].find(e=>e.getBoundingClientRect().width>0 && ({check})))'


class Recorder:
    def __init__(self, browser, name):
        self.browser = browser
        self.path = OUT / name
        self.path.mkdir(parents=True, exist_ok=True)
        self.frames = []
        self.cursor = [980, 650]
        self.clicks = []
        self.focus = [960, 540]
        self.zoom = 1.0
        self.name = name

    def frame(self):
        started = time.monotonic()
        encoded = self.browser.command('WebDriver:TakeScreenshot', {'id': None, 'full': False, 'scroll': False})
        im = Image.open(io.BytesIO(base64.b64decode(encoded))).convert('RGB')
        path = self.path / f'{len(self.frames):05d}.jpg'
        im.save(path, quality=95, subsampling=0)
        self.frames.append({'file': path.name, 'cursor': self.cursor.copy(), 'focus': self.focus.copy(), 'zoom': self.zoom})
        remaining = 1 / FPS - (time.monotonic() - started)
        if remaining > 0:
            time.sleep(remaining)

    def hold(self, seconds):
        for _ in range(round(seconds * FPS)):
            self.frame()

    def target(self, expression):
        script = f'const e={expression}; if(!e) return null; const r=e.getBoundingClientRect(); return {{x:r.x+r.width/2,y:r.y+r.height/2,w:r.width,h:r.height,text:e.textContent.slice(0,100)}};'
        result = None
        deadline = time.monotonic() + 10
        while result is None and time.monotonic() < deadline:
            result = self.browser.js(script)
            if result is None:
                self.hold(0.15)
        if not result:
            raise RuntimeError(f'Control not found: {expression}')
        return result

    def move(self, x, y, seconds=0.6):
        origin = self.cursor.copy()
        steps = max(1, round(seconds * FPS))
        for i in range(steps):
            v = (i + 1) / steps
            e = v * v * (3 - 2 * v)
            self.cursor = [origin[0] + (x - origin[0]) * e, origin[1] + (y - origin[1]) * e]
            self.browser.actions([{'type': 'pointerMove', 'duration': 0, 'x': round(self.cursor[0]), 'y': round(self.cursor[1]), 'origin': 'viewport'}])
            self.frame()

    def click(self, expression, hold=0.4, focus=None, zoom=None):
        target = self.target(expression)
        self.move(target['x'], target['y'])
        self.clicks.append({'frame': len(self.frames), 'x': self.cursor[0], 'y': self.cursor[1], 'text': target['text']})
        self.browser.actions([{'type': 'pointerDown', 'button': 0}, {'type': 'pointerUp', 'button': 0}])
        if focus:
            self.focus = list(focus)
        if zoom:
            self.zoom = zoom
        self.hold(hold)
        print(self.name, 'clicked', target['text'].strip()[:70], flush=True)

    def text(self, value, **kwargs):
        self.click(text_element(value), **kwargs)

    def css(self, selector, **kwargs):
        self.click(f'document.querySelector({json.dumps(selector)})', **kwargs)

    def type(self, selector, text, clear=False, interval=0.07):
        if clear:
            # Firefox WebDriver's control modifier and selection command.
            self.browser.keys(selector, '\ue009a\ue000')
            self.frame()
        for char in text:
            self.browser.keys(selector, '\ue007' if char == '\n' else char)
            self.hold(interval)

    def save(self):
        if not self.frames:
            return
        metadata = {'name': self.name, 'fps': FPS, 'duration': len(self.frames) / FPS,
                    'frames': self.frames, 'clicks': self.clicks}
        (self.path / 'timeline.json').write_text(json.dumps(metadata))
        print(f'Saved {self.name}: {len(self.frames)} frames, {len(self.clicks)} real clicks', flush=True)


def record(name, b, r):
    if name == 'project':
        origin = BASE_FILE.read_text().strip().split('/projects/')[0]
        b.command('WebDriver:Navigate', {'url': origin + '/projects'})
        time.sleep(2)
        r.hold(0.6)
        r.css('button[data-sidebar="menu-button"]', hold=0.5, focus=(400, 320), zoom=1.10)
        r.text('Create project', hold=1.1, focus=(960, 540), zoom=1.24)
        r.css('[role=dialog] button[role=combobox]', hold=0.6)
        r.click(text_element('acme/web-app'), hold=0.6)
        r.css('#fab-project-name', hold=0.2)
        r.type('#fab-project-name', 'Acme web app', clear=True, interval=0.09)
        # Public-demo saving is disabled: show setup without inventing a successful submission.
        target = r.target(text_element('Create project & link'))
        r.move(target['x'], target['y'], 0.5)
        r.hold(1.5)
    elif name == 'board':
        b.navigate('/issues')
        r.hold(0.7)
        r.click(text_element('Redesign the pricing page', False), hold=0.8, focus=(960, 540), zoom=1.24)
        r.css('#modal-title', hold=0.2)
        r.type('#modal-title', 'Ship the new pricing page', clear=True)
        r.text('Save changes', hold=0.9, focus=(850, 510), zoom=1.04)
        r.text('List', hold=0.8, focus=(840, 400), zoom=1.10)
        r.text('Calendar', hold=1.1, focus=(1030, 530), zoom=1.03)
    elif name == 'git':
        b.navigate('/git')
        r.hold(0.3)
        r.text('src', hold=0.25, focus=(730, 470), zoom=1.17)
        r.text('app', hold=0.25)
        r.text('page.tsx', hold=0.7, focus=(990, 400), zoom=1.25)
        r.css('.cm-content[contenteditable=true]', hold=0.1)
        b.keys('.cm-content[contenteditable=true]', '\ue009\ue011\ue000')
        r.type('.cm-content[contenteditable=true]', '// Ready to ship.\n')
        r.hold(0.7)
        r.css('button[aria-label="Source control"]', hold=0.7, focus=(880, 455), zoom=1.08)
    elif name == 'database':
        b.navigate('/database')
        r.hold(0.2)
        r.click(text_element('Acme production', False), hold=0.6, focus=(880, 400), zoom=1.04)
        r.click(text_element('acme', False), hold=0.7)
        r.text('SQL editor', hold=0.4, focus=(1030, 460), zoom=1.20)
        r.css('.cm-content[contenteditable=true]', hold=0.1)
        r.type('.cm-content[contenteditable=true]', 'SELECT * FROM orders LIMIT 5;', clear=True, interval=0.06)
        r.text('Run', hold=1.0, focus=(1070, 700), zoom=1.14)
        r.text('ERD', hold=1.2, focus=(1090, 600), zoom=1.03)
    elif name == 'api':
        b.navigate('/api')
        r.hold(0.3)
        r.click(text_element('Create an order', False), hold=0.65, focus=(940, 460), zoom=1.1)
        r.text('Body', hold=0.8, focus=(925, 510), zoom=1.30)
        r.move(1130, 560, 0.45)
        r.hold(0.7)
        r.click(text_element('List orders', False), hold=0.6, focus=(900, 390), zoom=1.15)
        r.click(text_element('Headers', False), hold=0.7)
    elif name == 'docs':
        b.navigate('/docs')
        r.hold(0.3)
        r.click(text_element('Release checklist', False), hold=0.7, focus=(1000, 465), zoom=1.20)
        r.move(1080, 485, 0.6)
        r.hold(0.7)
        r.text('Drawings', hold=1.2, focus=(1100, 615), zoom=1.06)
        r.move(1190, 585, 0.7)
        r.hold(0.8)
    elif name == 'terminal':
        b.navigate('/devops')
        r.hold(0.3)
        r.text('Recent runs', hold=0.8, focus=(1110, 500), zoom=1.10)
        r.text('Terminal', hold=0.6, focus=(930, 540), zoom=1.04)
        r.click(text_element('Production web', False), hold=0.7, focus=(1150, 485), zoom=1.14)
        r.move(770, 535, 0.4)
        r.type('.xterm-helper-textarea', 'docker compose ps\n', interval=0.09)
        r.hold(1.1)
        r.type('.xterm-helper-textarea', 'git status\n', interval=0.09)
        r.hold(1.0)
    else:
        raise ValueError(name)


if __name__ == '__main__':
    browser = Browser()
    recorder = None
    try:
        if sys.argv[1] == '--quit':
            browser.command('Marionette:Quit', {'flags': ['eForceQuit']})
            browser.socket.close()
            browser = None
        elif sys.argv[1] == '--inspect':
            print(browser.js('return {url:location.href, viewport:[innerWidth,innerHeight],controls:[...document.querySelectorAll("button,a,input,select,[role=button],[contenteditable=true]")].filter(e=>e.getBoundingClientRect().width>0).map(e=>({tag:e.tagName,text:e.textContent.slice(0,100),label:e.getAttribute("aria-label"),id:e.id,href:e.getAttribute("href"),rect:e.getBoundingClientRect().toJSON()}))};'))
        else:
            for scene_name in sys.argv[1:]:
                recorder = Recorder(browser, scene_name)
                record(scene_name, browser, recorder)
                recorder.save()
                recorder = None
    finally:
        if recorder:
            recorder.save()
        if browser:
            browser.close()
