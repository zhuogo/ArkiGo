"""Semantic navigation integration checks using real browser input, no app dependencies.

Run: python -X utf8 skills/arkigo/tests/browser-semantic.py
Requires development-only Python Playwright and its Chromium installation.
Generated HTML, screenshots, and the result report stay in .artifacts/canvas-engine/semantic.
"""
import json
import base64
import subprocess
import traceback
from pathlib import Path

from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[3]
ARTIFACTS = ROOT / '.artifacts/canvas-engine/semantic'
ARTIFACTS.mkdir(parents=True, exist_ok=True)
DEMO = ARTIFACTS / 'registration.html'


def state(page):
    return page.evaluate('window.arkigoCanvas.getState()')


def settled(page, view=None):
    page.wait_for_function('window.arkigoCanvas && !window.arkigoCanvas.getState().transitioning')
    if view is not None:
        assert state(page)['viewId'] == view, state(page)


def load(page, fragment=''):
    page.goto(DEMO.as_uri() + ('#' + fragment if fragment else ''))
    page.wait_for_function('window.arkigoCanvas !== undefined')
    page.wait_for_timeout(310)  # Initial resize and deliberate-navigation lock.


def camera_equal(actual, expected):
    for key in ('x', 'y', 'k'):
        assert abs(actual[key] - expected[key]) < .02, (actual, expected)


def clean_scene(page):
    expect(page.locator('.scene-ghost')).to_have_count(0)
    assert page.evaluate('''() => {
      const ids = [...document.querySelectorAll('[id]')].map(el => el.id);
      return new Set(ids).size === ids.length;
    }'''), 'Duplicate element IDs after navigation'


def select_module(page, node):
    page.locator(f'#nodes .node[data-id="{node}"]').click()
    assert state(page)['selected'] == node
    expect(page.locator('#module-actions')).to_be_visible()


def enter(page, node, view):
    select_module(page, node)
    page.locator('#enter-module').click()
    settled(page, view)


def return_to_parent(page):
    path = state(page)['path']
    assert len(path) > 1
    parent = path[-2]['viewId']
    page.locator(f'#breadcrumbs button[data-view-id="{parent}"]').click()
    settled(page, parent)


def point_on_node(page, node):
    box = page.locator(f'#nodes .node[data-id="{node}"]').bounding_box()
    return box['x'] + box['width'] / 2, box['y'] + box['height'] / 2


def wheel_to_view(page, delta, view, limit=30):
    for _ in range(limit):
        page.mouse.wheel(0, delta)
        page.wait_for_timeout(24)
        if state(page)['viewId'] == view:
            return
    raise AssertionError(f'Wheel failed to reach {view}: {state(page)}')


def click_roundtrip(page):
    load(page)
    assert page.locator('.header').bounding_box()['height'] == 56
    expect(page.locator('#view-tabs, #view-select')).to_have_count(0)
    expect(page.locator('#nav-back, #walk-start, #walkthrough')).to_have_count(0)
    expect(page.locator('#breadcrumbs [aria-current="location"]')).to_have_text('用户注册')
    assert 'walkIndex' not in state(page)
    page.locator('#viewport').focus()
    page.keyboard.press('ArrowRight')
    page.keyboard.press('ArrowDown')
    original = state(page)['camera']
    page.screenshot(path=str(ARTIFACTS / 'registration-top.png'))
    parents = []
    for node, view in [('users', 'users'), ('register', 'registration'), ('persist', 'persistence')]:
        parents.append((state(page)['viewId'], node, state(page)['camera']))
        enter(page, node, view)
    assert state(page)['depth'] == 3
    assert [item['viewId'] for item in state(page)['path']] == ['system', 'users', 'registration', 'persistence']
    expect(page.locator('#breadcrumbs [aria-current="location"]')).to_have_attribute('data-view-id', 'persistence')
    page.screenshot(path=str(ARTIFACTS / 'registration-inner.png'))
    for view, node, camera in reversed(parents):
        return_to_parent(page)
        settled(page, view)
        camera_equal(state(page)['camera'], camera)
        assert state(page)['selected'] == node
        expect(page.locator(f'#nodes .node[data-id="{node}"]')).to_be_focused()
    camera_equal(state(page)['camera'], original)
    expect(page.locator('#nav-back')).to_have_count(0)
    page.keyboard.press('Escape')
    settled(page, 'system')
    clean_scene(page)


def wheel_roundtrip(page):
    load(page)
    select_module(page, 'users')
    original = state(page)['camera']
    page.mouse.move(*point_on_node(page, 'users'))
    wheel_to_view(page, -120, 'users')
    # Continue through the transition and reverse direction without ending this burst.
    for i in range(16):
        page.mouse.wheel(0, -120 if i < 8 else 120)
        page.wait_for_timeout(35)
        assert state(page)['viewId'] == 'users', 'A single wheel burst crossed multiple levels'
    settled(page, 'users')
    assert state(page)['navigationCause'] == 'wheel'
    page.wait_for_timeout(310)
    wheel_to_view(page, 120, 'system')
    assert state(page)['selected'] == 'users'
    camera_equal(state(page)['camera'], original)
    # Returning into a selected source must not re-enter in the same burst.
    # Keep sending during the animation: waiting for it would exceed the wheel
    # idle threshold and deliberately begin a different gesture.
    for _ in range(10):
        page.mouse.wheel(0, -120)
        page.wait_for_timeout(30)
        assert state(page)['viewId'] == 'system'
    settled(page, 'system')
    clean_scene(page)


def programmatic_controls(page):
    load(page, 'persistence')
    for control in ('#actual', '#fit', '#reset'):
        page.locator(control).click()
        settled(page, 'persistence')
        assert state(page)['depth'] == 3
    # Ordinary leaf selection and zoom cannot invent a child view.
    page.locator('#nodes .node[data-id="password"]').click()
    page.keyboard.press('Escape')
    for _ in range(7):
        page.locator('#zoom-in').click()
    settled(page, 'persistence')
    clean_scene(page)


def deep_links(page):
    load(page, 'persistence')
    assert state(page)['depth'] == 3
    assert [item['viewId'] for item in state(page)['path']] == ['system', 'users', 'registration', 'persistence']
    assert [item['viaNodeId'] for item in state(page)['path'][1:]] == ['users', 'register', 'persist']
    page.locator('#breadcrumbs button[data-view-id="users"]').click()
    settled(page, 'users')
    assert state(page)['selected'] == 'register'
    assert state(page)['depth'] == 1
    page.evaluate("location.hash = 'registration'")
    page.wait_for_function("window.arkigoCanvas.getState().viewId === 'registration'")
    settled(page, 'registration')
    assert state(page)['depth'] == 2
    page.keyboard.press('Alt+ArrowLeft')
    settled(page, 'users')
    assert state(page)['selected'] == 'register'
    page.evaluate("location.hash = 'does-not-exist'")
    page.wait_for_function("window.arkigoCanvas.getState().viewId === 'system'")
    settled(page, 'system')
    assert state(page)['depth'] == 0
    # Browser back must use the actual recorded parent camera, not reconstruct a fit.
    load(page)
    page.locator('#viewport').focus()
    page.keyboard.press('ArrowLeft')
    original = state(page)['camera']
    enter(page, 'users', 'users')
    page.go_back()
    settled(page, 'system')
    camera_equal(state(page)['camera'], original)
    clean_scene(page)
    # A damaged percent-encoded external fragment must still open the root.
    load(page, '%E0%A4%A')
    settled(page, 'system')
    expect(page.locator('#load-state')).to_be_hidden()


def rapid_and_keyboard(page):
    load(page)
    for _ in range(3):
        select_module(page, 'users')
        page.locator('#enter-module').click()
        assert state(page)['viewId'] == 'users'
        page.keyboard.press('Escape')
        assert state(page)['viewId'] == 'system'
        assert not state(page)['transitioning']
        clean_scene(page)
    select_module(page, 'users')
    page.locator('#viewport').focus()
    page.keyboard.press('Enter')
    assert state(page)['viewId'] == 'users' and not state(page)['transitioning']
    page.locator('#nodes .node[data-id="register"]').focus()
    page.keyboard.press('Enter')  # First activation selects; second enters.
    assert state(page)['selected'] == 'register'
    page.keyboard.press('Enter')
    assert state(page)['viewId'] == 'registration' and not state(page)['transitioning']
    page.locator('#directory-open').click()
    page.keyboard.press('Escape')
    assert state(page)['viewId'] == 'registration', 'Escape should close a panel before navigating'
    page.keyboard.press('Alt+ArrowLeft')
    assert state(page)['viewId'] == 'users' and not state(page)['transitioning']
    page.emulate_media(reduced_motion='reduce')
    select_module(page, 'register')
    page.locator('#enter-module').click()
    assert state(page)['viewId'] == 'registration' and not state(page)['transitioning']
    page.locator('#breadcrumbs button[data-view-id="system"]').click()
    page.locator('#nodes .node[data-id="users"]').dblclick()
    assert state(page)['viewId'] == 'users' and not state(page)['transitioning']
    clean_scene(page)


def resize_restore(page):
    load(page)
    page.locator('#viewport').focus()
    page.keyboard.press('ArrowRight')
    original = state(page)['camera']
    old_box = page.locator('#viewport').bounding_box()
    enter(page, 'users', 'users')
    child_before = state(page)['camera']
    page.set_viewport_size({'width': 1100, 'height': 780})
    page.wait_for_timeout(120)
    child_after = state(page)['camera']
    new_box = page.locator('#viewport').bounding_box()
    for axis, dimension in [('x', 'width'), ('y', 'height')]:
        before_world = (old_box[dimension] / 2 - child_before[axis]) / child_before['k']
        after_world = (new_box[dimension] / 2 - child_after[axis]) / child_after['k']
        assert abs(before_world - after_world) < .02
    return_to_parent(page)
    settled(page, 'system')
    expected = dict(original)
    expected['x'] += (new_box['width'] - old_box['width']) / 2
    expected['y'] += (new_box['height'] - old_box['height']) / 2
    camera_equal(state(page)['camera'], expected)
    assert state(page)['selected'] == 'users'
    clean_scene(page)


def touch_on_card(page):
    load(page)
    select_module(page, 'users')
    before = state(page)
    stored = page.evaluate('JSON.stringify({...localStorage})')
    x, y = point_on_node(page, 'users')
    client = page.context.new_cdp_session(page)

    def touch(kind, positions):
        client.send('Input.dispatchTouchEvent', {
            'type': kind,
            'touchPoints': [{'x': px, 'y': py, 'id': i + 1} for i, (px, py) in enumerate(positions)],
        })

    # The first touch starts a pending node drag; the second must transfer to pinch.
    touch('touchStart', [(x - 25, y)])
    touch('touchMove', [(x - 18, y + 7)])
    touch('touchStart', [(x - 18, y + 7), (x + 25, y)])
    for distance in (32, 42, 52, 64):
        touch('touchMove', [(x - distance, y), (x + distance, y)])
    touch('touchEnd', [])
    settled(page)
    assert state(page)['layout'] == before['layout'], 'Pinch starting on card changed layout'
    assert page.evaluate('JSON.stringify({...localStorage})') == stored, 'Pinch persisted an unintended drag'
    assert state(page)['camera']['k'] > before['camera']['k']
    assert state(page)['viewId'] == 'system'
    assert not page.locator('.node.dragging').count()
    assert 'panning' not in page.locator('#viewport').get_attribute('class')
    # A cancelled single-touch drag must restore its authored position, too.
    page.wait_for_timeout(350)
    page.locator('#fit').click()
    x, y = point_on_node(page, 'users')
    touch('touchStart', [(x, y)])
    touch('touchMove', [(x + 12, y + 12)])
    touch('touchCancel', [])
    assert state(page)['layout'] == before['layout']
    assert page.evaluate('JSON.stringify({...localStorage})') == stored, 'Cancelled touch drag should not save a layout'
    expect(page.locator('#feedback')).to_be_hidden()
    clean_scene(page)


def mobile_navigation(page):
    for width in (375, 320):
        page.set_viewport_size({'width': width, 'height': 812})
        load(page)
        select_module(page, 'users')
        assert page.locator('.header').bounding_box()['height'] == 56
        for selector in ('#directory-open', '#theme-toggle'):
            box = page.locator(selector).bounding_box()
            assert box['x'] >= 0 and box['x'] + box['width'] <= width + .5
            assert box['y'] >= 0 and box['y'] + box['height'] <= 56
            assert page.locator(selector).inner_text().strip() == ''
        expect(page.get_by_role('button', name='搜索节点', exact=True)).to_have_attribute('id', 'directory-open')
        search_box = page.locator('#directory-open').bounding_box()
        theme_box = page.locator('#theme-toggle').bounding_box()
        assert search_box['x'] + search_box['width'] <= theme_box['x'] + .5 or theme_box['x'] + theme_box['width'] <= search_box['x'] + .5
        for selector in ('#enter-module', '#inspect-module'):
            box = page.locator(selector).bounding_box()
            assert box['x'] >= 0 and box['x'] + box['width'] <= width + .5, (width, selector, box)
            assert box['y'] >= 56 and box['y'] + box['height'] <= 812, (width, selector, box)
        page.screenshot(path=str(ARTIFACTS / f'registration-mobile-{width}-selected.png'))
        page.locator('#enter-module').click()
        settled(page, 'users')
        enter(page, 'register', 'registration')
        enter(page, 'persist', 'persistence')
        current = page.locator('#breadcrumbs [aria-current="location"]')
        expect(current).to_be_visible()
        current_box = current.bounding_box()
        nav_box = page.locator('#breadcrumbs').bounding_box()
        assert current_box['width'] >= 60, 'Current breadcrumb collapsed instead of remaining readable'
        assert current_box['x'] >= nav_box['x'] - 1
        assert current_box['x'] + current_box['width'] <= nav_box['x'] + nav_box['width'] + 1
        assert nav_box['x'] + nav_box['width'] <= min(search_box['x'], theme_box['x']) + 1
        assert page.locator('body').evaluate('(el) => el.scrollWidth <= innerWidth')
        page.screenshot(path=str(ARTIFACTS / f'registration-mobile-{width}-deep.png'))
        camera = state(page)['camera']
        page.get_by_role('button', name='切换到深色', exact=True).click()
        expect(page.get_by_role('button', name='切换到浅色', exact=True)).to_be_visible()
        assert page.locator('html').get_attribute('data-theme') == 'dark'
        assert state(page)['viewId'] == 'persistence'
        camera_equal(state(page)['camera'], camera)
        page.screenshot(path=str(ARTIFACTS / f'registration-mobile-{width}-deep-dark.png'))
        page.locator('#theme-toggle').click()
        page.locator('#breadcrumbs button[data-view-id="users"]').click()
        settled(page, 'users')
        assert state(page)['selected'] == 'register'
        clean_scene(page)


def pinch_roundtrip(page):
    load(page)
    select_module(page, 'users')
    original = state(page)
    stored = page.evaluate('JSON.stringify({...localStorage})')
    x, y = point_on_node(page, 'users')
    client = page.context.new_cdp_session(page)

    def touch(kind, center, distance=None):
        points = [] if distance is None else [
            {'x': center[0] - distance, 'y': center[1], 'id': 1},
            {'x': center[0] + distance, 'y': center[1], 'id': 2},
        ]
        client.send('Input.dispatchTouchEvent', {'type': kind, 'touchPoints': points})

    touch('touchStart', (x, y), 22)
    for distance in range(28, 160, 8):
        touch('touchMove', (x, y), distance)
        if state(page)['viewId'] == 'users':
            break
    assert state(page)['viewId'] == 'users', 'Pinch on selected module did not enter'
    assert state(page)['navigationCause'] == 'pinch'
    # Keep this gesture active across the transition and reverse its direction.
    for distance in (170, 190, 210, 180, 140, 100, 60, 30):
        touch('touchMove', (x, y), distance)
        page.wait_for_timeout(45)
        assert state(page)['viewId'] == 'users', 'One pinch crossed multiple levels'
    touch('touchEnd', (x, y))
    settled(page, 'users')
    page.wait_for_timeout(300)
    center = (720, 430)
    touch('touchStart', center, 180)
    for distance in (160, 140, 120, 100, 80):
        touch('touchMove', center, distance)
        if state(page)['viewId'] == 'system':
            break
    assert state(page)['viewId'] == 'system', 'Pinch inward did not return to parent'
    for distance in (120, 160, 200, 240, 280):
        touch('touchMove', center, distance)
        page.wait_for_timeout(50)
        assert state(page)['viewId'] == 'system'
    touch('touchEnd', center)
    settled(page, 'system')
    camera_equal(state(page)['camera'], original['camera'])
    assert state(page)['selected'] == 'users'
    assert state(page)['layout'] == original['layout']
    assert page.evaluate('JSON.stringify({...localStorage})') == stored
    clean_scene(page)


def record_transition(page, trigger, target, label):
    # Observe real animation frames without changing clocks, keyframes, or runtime.
    client = page.context.new_cdp_session(page)
    screenshots = []

    def receive_frame(event):
        filename = f'{label}-frame-{len(screenshots):02}.png'
        (ARTIFACTS / filename).write_bytes(base64.b64decode(event['data']))
        screenshots.append({'file': filename, 'timestamp': event['metadata']['timestamp']})
        client.send('Page.screencastFrameAck', {'sessionId': event['sessionId']})

    client.on('Page.screencastFrame', receive_frame)
    client.send('Page.startScreencast', {'format': 'png', 'maxWidth': 1000, 'maxHeight': 700, 'everyNthFrame': 1})
    page.evaluate('''() => {
      const capture = {start: performance.now(), frames: [], done: false};
      window.__semanticFrameCapture = capture;
      const identities = new WeakMap(); let nextIdentity = 1;
      const readLayer = el => {
        if (!identities.has(el)) identities.set(el, nextIdentity++);
        const style = getComputedStyle(el), matrix = new DOMMatrixReadOnly(style.transform);
        return {id: identities.get(el), opacity: Number(style.opacity),
          matrix: [matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f],
          animations: el.getAnimations().map(a => ({time: a.currentTime, state: a.playState}))};
      };
      const sample = () => {
        const now = performance.now(), state = window.arkigoCanvas.getState();
        const viewport = document.querySelector('#viewport'), grid = getComputedStyle(viewport);
        const ids = [...document.querySelectorAll('[id]')].map(el => el.id);
        capture.frames.push({time: now - capture.start, viewId: state.viewId,
          transitioning: state.transitioning, camera: state.camera,
          world: readLayer(document.querySelector('#world')),
          ghosts: [...document.querySelectorAll('.scene-ghost')].map(readLayer),
          grid: {size: grid.backgroundSize, position: grid.backgroundPosition},
          duplicateIds: ids.length !== new Set(ids).size});
        if (now - capture.start < 650) requestAnimationFrame(sample);
        else capture.done = true;
      };
      requestAnimationFrame(sample);
    }''')
    try:
        page.locator(trigger).click()
        page.wait_for_function('window.__semanticFrameCapture.done')
    finally:
        client.send('Page.stopScreencast')
        client.detach()
    capture = page.evaluate('window.__semanticFrameCapture')
    capture['screenshots'] = screenshots
    (ARTIFACTS / f'{label}-frames.json').write_text(json.dumps(capture, indent=2), encoding='utf-8')
    settled(page, target)
    return capture


def assert_transition_frames(capture, target):
    frames = [frame for frame in capture['frames'] if frame['viewId'] == target]
    active = [frame for frame in frames if frame['transitioning']]
    assert len(active) >= 3, 'Did not observe enough real transition frames'
    previous_opacity = {}
    for frame in frames:
        assert not frame['duplicateIds'], 'Transition cloned duplicate element IDs'
        total_opacity = frame['world']['opacity'] + sum(layer['opacity'] for layer in frame['ghosts'])
        assert total_opacity >= .96, f'Both scenes faded away at {frame["time"]:.1f}ms'
        for layer in [frame['world'], *frame['ghosts']]:
            assert all(isinstance(value, (float, int)) and abs(value) < 1e8 for value in layer['matrix'])
            assert layer['matrix'][0] > 0, 'A scene collapsed to zero scale'
        for ghost in frame['ghosts']:
            previous = previous_opacity.get(ghost['id'], 1)
            assert ghost['opacity'] <= previous + .015, (
                f'Outgoing scene flashed back at {frame["time"]:.1f}ms: '
                f'opacity {previous:.3f} -> {ghost["opacity"]:.3f}')
            previous_opacity[ghost['id']] = ghost['opacity']
    final = frames[-1]
    assert not final['transitioning'] and not final['ghosts']
    assert not final['world']['animations'], 'Finished scene retains a live animation'
    camera = final['camera']
    expected = [camera['k'], 0, 0, camera['k'], camera['x'], camera['y']]
    for frame in frames[-3:]:
        assert all(abs(a - b) < .02 for a, b in zip(frame['world']['matrix'], expected)), 'Scene jumped after animation cleanup'
        assert frame['world']['opacity'] == 1


def transition_frames(page):
    load(page)
    select_module(page, 'users')
    entering = record_transition(page, '#enter-module', 'users', 'transition-enter')
    leaving = record_transition(page, '#breadcrumbs button[data-view-id="system"]', 'system', 'transition-return')
    assert_transition_frames(entering, 'users')
    assert_transition_frames(leaving, 'system')
    for capture in (entering, leaving):
        assert len(capture['screenshots']) >= 3, 'Insufficient compositor frames captured'
        assert len({(frame['grid']['size'], frame['grid']['position']) for frame in capture['frames']}) == 1, 'Background grid jumped during level transition'
    assert 'level-transition' not in page.locator('#viewport').get_attribute('class')
    clean_scene(page)


def main():
    subprocess.run(['node', str(ROOT / 'skills/arkigo/scripts/render.mjs'),
                    str(ROOT / 'docs/poc/canvas-engine/registration.canvas.json'), str(DEMO)], check=True)
    results = []
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        for test in (click_roundtrip, wheel_roundtrip, programmatic_controls, deep_links,
                     rapid_and_keyboard, resize_restore, touch_on_card, pinch_roundtrip, mobile_navigation,
                     transition_frames):
            context = browser.new_context(viewport={'width': 1440, 'height': 1000}, has_touch=True)
            page = context.new_page()
            errors, external = [], []
            page.on('pageerror', lambda error: errors.append(str(error)))
            page.on('request', lambda request: external.append(request.url) if request.url.startswith(('http:', 'https:')) else None)
            try:
                test(page)
                assert not errors, errors
                assert not external, external
                results.append({'test': test.__name__, 'passed': True})
                print('PASS', test.__name__)
            except Exception:
                failure = traceback.format_exc()
                results.append({'test': test.__name__, 'passed': False, 'error': failure, 'pageErrors': errors})
                print('FAIL', test.__name__, failure)
                page.screenshot(path=str(ARTIFACTS / (test.__name__ + '-failure.png')))
            finally:
                context.close()
        browser.close()
    (ARTIFACTS / 'results.json').write_text(json.dumps(results, indent=2, ensure_ascii=False), encoding='utf-8')
    assert all(result['passed'] for result in results), 'Semantic navigation checks failed; see ' + str(ARTIFACTS / 'results.json')
    print(f'{len(results)} semantic navigation scenarios passed.')


if __name__ == '__main__':
    main()
