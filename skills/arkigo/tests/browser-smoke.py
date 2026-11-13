"""Optional development check: Python + Playwright Chromium, no app dependency.

Run from any directory: python -X utf8 skills/arkigo/tests/browser-smoke.py
Screenshots and exported layout are written to project .artifacts/canvas-engine/.
"""
import json
import subprocess
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[3]
ARTIFACTS = ROOT / '.artifacts/canvas-engine'
ARTIFACTS.mkdir(parents=True, exist_ok=True)
DEMO = ROOT / 'docs/poc/canvas-engine/index.html'
hostile_document = json.loads((ROOT / 'docs/poc/canvas-engine/arkigo.canvas.json').read_text(encoding='utf-8'))
hostile_document['views'][0]['nodes'][0]['summary'] = '</script><script>window.injected=true</script>'
hostile_document['views'][0]['nodes'][0]['details'] = {f'边界 {i}': '长内容需要独立滚动，关闭按钮始终可见。' * 5 for i in range(24)}
hostile_input = ARTIFACTS / 'hostile.canvas.json'
hostile_input.write_text(json.dumps(hostile_document, ensure_ascii=False), encoding='utf-8')
subprocess.run(['node', str(ROOT / 'skills/arkigo/scripts/render.mjs'), str(hostile_input), str(ARTIFACTS / 'hostile.html')], check=True)


def state(page):
    return page.evaluate('window.arkigoCanvas.getState()')


def load(page, file):
    page.goto(file.as_uri())
    page.wait_for_function('window.arkigoCanvas !== undefined')
    page.wait_for_timeout(80)  # Let the initial ResizeObserver camera update finish.


def navigate(page, view):
    """Deep links exercise every authored view; semantic tests cover drill gestures."""
    page.evaluate('(id) => { location.hash = encodeURIComponent(id); }', view)
    page.wait_for_function('(id) => window.arkigoCanvas.getState().viewId === id && !window.arkigoCanvas.getState().transitioning', arg=view)


def theme_state(page):
    return page.evaluate('''() => ({
      explicit: document.documentElement.dataset.theme ?? null,
      background: getComputedStyle(document.body).backgroundColor
    })''')


def check_theme(browser, errors):
    """OS preference is the default; explicit choices survive reloads and OS changes."""
    theme_context = browser.new_context(viewport={'width': 1440, 'height': 1000}, color_scheme='dark')
    theme = theme_context.new_page()
    theme.on('pageerror', lambda error: errors.append(str(error)))
    theme.add_init_script('''(() => {
      const sample = () => {
        if (!document.body) return requestAnimationFrame(sample);
        window.__themeFirstFrame = {
          explicit: document.documentElement.dataset.theme ?? null,
          background: getComputedStyle(document.body).backgroundColor
        };
      };
      requestAnimationFrame(sample);
    })();''')
    load(theme, DEMO)
    dark = theme_state(theme)
    assert dark['explicit'] is None
    expect(theme.get_by_role('button', name='切换到浅色', exact=True)).to_be_visible()
    theme.emulate_media(color_scheme='light')
    expect(theme.get_by_role('button', name='切换到深色', exact=True)).to_be_visible()
    light = theme_state(theme)
    assert light['explicit'] is None and light['background'] != dark['background']
    assert theme.evaluate("localStorage.getItem('arkigo-theme')") is None
    # The icon switches from automatic light to explicit dark.
    theme.locator('#theme-toggle').click()
    assert theme_state(theme) == {'explicit': 'dark', 'background': dark['background']}
    assert theme.evaluate("localStorage.getItem('arkigo-theme')") == 'dark'
    expect(theme.get_by_role('button', name='切换到浅色', exact=True)).to_be_visible()
    theme.reload()
    theme.wait_for_function('window.arkigoCanvas && window.__themeFirstFrame')
    assert theme.evaluate('window.__themeFirstFrame') == {'explicit': 'dark', 'background': dark['background']}
    assert theme_state(theme)['explicit'] == 'dark'
    theme.emulate_media(color_scheme='dark')
    theme.emulate_media(color_scheme='light')
    assert theme_state(theme) == {'explicit': 'dark', 'background': dark['background']}
    # Explicit light must equally override a dark OS, before and after reload.
    theme.locator('#theme-toggle').click()
    assert theme.evaluate("localStorage.getItem('arkigo-theme')") == 'light'
    theme.emulate_media(color_scheme='dark')
    assert theme_state(theme) == {'explicit': 'light', 'background': light['background']}
    expect(theme.get_by_role('button', name='切换到深色', exact=True)).to_be_visible()
    theme.reload()
    theme.wait_for_function('window.arkigoCanvas && window.__themeFirstFrame')
    assert theme.evaluate('window.__themeFirstFrame') == {'explicit': 'light', 'background': light['background']}
    theme.screenshot(path=str(ARTIFACTS / 'theme-explicit-light.png'))
    theme.locator('#theme-toggle').click()
    theme.screenshot(path=str(ARTIFACTS / 'theme-explicit-dark.png'))
    theme_context.close()


with sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True)
    context = browser.new_context(viewport={'width': 1440, 'height': 1000}, accept_downloads=True)
    page = context.new_page()
    errors, requests = [], []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.on('request', lambda request: requests.append(request.url))
    load(page, DEMO)
    assert page.locator('.header').bounding_box()['height'] == 56
    assert page.locator('#viewport').bounding_box()['y'] == 56
    assert page.locator('#breadcrumbs').bounding_box()['y'] < 56
    expect(page.locator('#view-tabs, #view-select')).to_have_count(0)
    expect(page.locator('#walk-start, #walkthrough, #walk-prev, #walk-next')).to_have_count(0)
    assert 'walkIndex' not in state(page)
    expect(page.get_by_role('button', name='搜索节点', exact=True)).to_have_attribute('id', 'directory-open')
    expect(page.locator('#directory-open svg')).to_have_count(1)
    assert page.locator('#directory-open').inner_text().strip() == ''
    expect(page.locator('#theme-toggle svg:visible')).to_have_count(1)
    assert page.locator('#theme-toggle').inner_text().strip() == ''
    assert state(page)['viewId'] == 'overview'
    expect(page.locator('.node')).to_have_count(6)
    module = page.locator('#nodes .node[data-id="html-generator"]')
    assert '可进入' not in module.inner_text()
    expect(module.locator('.node-footer')).to_have_count(0)
    expect(module.locator('.module-mark')).to_have_count(1)
    assert module.evaluate('(el) => getComputedStyle(el, "::before").opacity') == '0.3'
    expect(page.locator('#nodes .node[data-id="canvas-data"] .node-footer')).to_have_count(1)
    assert page.locator('#legend i.feedback').evaluate('(el) => getComputedStyle(el).position') == 'static'
    page.screenshot(animations='disabled', path=str(ARTIFACTS / 'overview.png'))

    # Follow deep links to authored views, then open details and traverse a relationship.
    for view in ['generation', 'interaction', 'overview']:
        navigate(page, view)
        assert state(page)['viewId'] == view
        assert page.locator('#breadcrumbs [aria-current="location"]').get_attribute('data-view-id') == view
        expect(page.locator('.node')).to_have_count(6)
    page.locator('.node[data-id="canvas-data"]').click()
    expect(page.locator('#detail')).to_be_visible()
    expect(page.locator('#detail-title')).to_have_text('通用画布数据')
    assert page.locator('.edge.related').count() > 0
    expect(page.locator('.node.selected')).to_have_css('border-color', 'rgb(23, 108, 96)')
    assert 'canvas-v1.schema.json' in page.locator('#detail-sources').inner_text()
    page.screenshot(animations='disabled', path=str(ARTIFACTS / 'details.png'))
    page.locator('#detail-relations button').first.click()
    assert state(page)['selected'] != 'canvas-data'
    page.keyboard.press('Escape')
    expect(page.locator('#detail')).to_be_hidden()

    page.locator('#directory-open').click()
    expect(page.locator('#directory-title')).to_contain_text('目录')
    expect(page.locator('#directory-list small')).to_have_count(0)
    expect(page.locator('#search')).to_be_focused()
    page.screenshot(animations='disabled', path=str(ARTIFACTS / 'directory.png'))
    page.locator('#search').fill('不存在的关键词')
    expect(page.locator('#search-empty')).to_be_visible()
    page.locator('#search-clear').click()
    page.locator('#search').fill('独立 HTML')
    expect(page.locator('#directory-list button')).to_have_count(1)
    page.locator('#directory-list button').click()
    assert state(page)['selected'] == 'html-generator'
    page.locator('#detail-actions button').click()
    page.wait_for_function('!window.arkigoCanvas.getState().transitioning')
    assert state(page)['viewId'] == 'generation'
    navigate(page, 'overview')
    page.locator('#fit').click()

    # Dragging changes positions and routes, without opening details.
    node = page.locator('.node[data-id="canvas-data"]')
    old = state(page)['layout']['views'][0]['nodes'][0]
    path_before = page.locator('#edge-paths').inner_html()
    rect = node.bounding_box()
    page.mouse.move(rect['x'] + rect['width'] / 2, rect['y'] + 50)
    page.mouse.down()
    page.mouse.move(rect['x'] + rect['width'] / 2 + 18, rect['y'] + 75, steps=6)
    assert node.evaluate('(el) => el.style.transform.startsWith("translate(")')
    assert node.evaluate('(el) => parseFloat(el.style.left)') == old['x']
    page.mouse.up()
    assert node.evaluate('(el) => el.style.transform') == ''
    moved = state(page)['layout']['views'][0]['nodes'][0]
    assert moved['x'] != old['x'] and moved['y'] != old['y']
    assert page.locator('#edge-paths').inner_html() != path_before
    expect(page.locator('#detail')).to_be_hidden()
    page.reload()
    page.wait_for_function('window.arkigoCanvas !== undefined')
    assert state(page)['layout']['views'][0]['nodes'][0] == moved
    page.locator('#directory-open').click()
    with page.expect_download() as downloaded:
        page.locator('#directory-export').click()
    download = downloaded.value
    target = ARTIFACTS / 'exported.layout.json'
    download.save_as(target)
    page.locator('#directory-close').click()
    assert json.loads(target.read_text(encoding='utf-8')) == state(page)['layout']
    replay_file = ARTIFACTS / 'replayed.html'
    subprocess.run(['node', str(ROOT / 'skills/arkigo/scripts/render.mjs'),
                    str(ROOT / 'docs/poc/canvas-engine/arkigo.canvas.json'), str(replay_file),
                    '--layout', str(target)], check=True)
    replay = context.new_page()
    load(replay, replay_file)
    assert state(replay)['layout']['views'][0]['nodes'][0] == moved
    replay.close()
    # An overlapping drop returns to the last usable layout, so exports stay importable.
    first = page.locator('.node[data-id="canvas-data"]').bounding_box()
    second = page.locator('.node[data-id="model-adapter"]').bounding_box()
    page.mouse.move(first['x'] + 100, first['y'] + 50)
    page.mouse.down()
    page.mouse.move(second['x'] + 100, second['y'] + 50, steps=6)
    page.mouse.up()
    assert state(page)['layout']['views'][0]['nodes'][0] == moved
    assert '重叠' in page.locator('#storage-state').inner_text()
    page.locator('#reset').click()
    assert state(page)['layout']['views'][0]['nodes'][0] == old
    expect(page.locator('#feedback')).to_be_visible()
    expect(page.locator('#feedback-message')).to_have_text('已重置当前视图布局')
    page.screenshot(animations='disabled', path=str(ARTIFACTS / 'feedback.png'))

    # Pointer presses respond; keyboard actions and reduced-motion spatial changes are immediate.
    rect = page.locator('#fit').bounding_box()
    page.mouse.move(rect['x'] + rect['width'] / 2, rect['y'] + rect['height'] / 2)
    page.mouse.down()
    page.wait_for_timeout(140)
    assert page.locator('#fit').evaluate('(el) => getComputedStyle(el).transform') != 'none'
    page.mouse.up()
    page.locator('#directory-open').focus()
    page.keyboard.press('Enter')
    expect(page.locator('#directory')).to_be_visible()
    assert page.locator('#directory').evaluate('(el) => getComputedStyle(el).transitionDuration') == '0s'
    assert page.locator('#directory').evaluate('(el) => el.getAnimations().length') == 0
    page.keyboard.press('Escape')
    page.emulate_media(reduced_motion='reduce')
    page.locator('#directory-open').click()
    assert page.locator('#directory').evaluate('(el) => getComputedStyle(el).transform') == 'none'
    page.keyboard.press('Escape')
    page.emulate_media(reduced_motion='no-preference')

    # Cursor zoom keeps the same world point under the mouse.
    before = state(page)['camera']
    rect = page.locator('#viewport').bounding_box()
    x, y = 550, 350
    page.mouse.move(rect['x'] + x, rect['y'] + y)
    page.mouse.wheel(0, -100)
    page.wait_for_timeout(80)
    after = state(page)['camera']
    assert after['k'] > before['k']
    assert abs((x - before['x']) / before['k'] - (x - after['x']) / after['k']) < .01
    assert abs((y - before['y']) / before['k'] - (y - after['y']) / after['k']) < .01
    page.locator('#fit').click()
    before = state(page)['camera']
    page.mouse.move(40, 210)
    page.mouse.down()
    page.mouse.move(90, 240, steps=5)
    page.mouse.up()
    after = state(page)['camera']
    assert abs(after['x'] - before['x'] - 50) < .1
    assert abs(after['y'] - before['y'] - 30) < .1
    page.locator('#viewport').focus()
    page.keyboard.press('ArrowRight')
    assert state(page)['camera']['x'] == after['x'] - 45
    page.keyboard.press('0')
    page.locator('#actual').click()
    assert state(page)['camera']['k'] == 1

    # Every demo and old model projection opens without a network resource.
    for file in [ROOT / 'docs/poc/canvas-engine/tasks.html',
                 ROOT / 'docs/poc/new-system/canvas.html',
                 ROOT / 'docs/poc/existing-system/canvas.html']:
        load(page, file)
        views = page.locator('#arkigo-data').evaluate('(el) => JSON.parse(el.textContent).document.views.map(view => view.id)')
        for view in views:
            navigate(page, view)
            assert page.locator('.node').count() > 0
        page.locator('#fit').click()
    load(page, ROOT / 'docs/poc/canvas-engine/tasks.html')
    page.screenshot(animations='disabled', path=str(ARTIFACTS / 'tasks.png'))
    navigate(page, 'create')
    page.screenshot(animations='disabled', path=str(ARTIFACTS / 'tasks-flow.png'))

    page.emulate_media(color_scheme='dark')
    load(page, DEMO)
    page.screenshot(animations='disabled', path=str(ARTIFACTS / 'dark.png'))
    page.emulate_media(color_scheme='light')
    # The toolbar stays on one row at every breakpoint; breadcrumbs replace flat tabs.
    for width in [1440, 1024, 768, 760, 375, 320]:
        page.set_viewport_size({'width': width, 'height': 812})
        assert page.locator('.header').bounding_box()['height'] == 56
        assert page.locator('#viewport').bounding_box()['y'] == 56
        for selector in ['#breadcrumbs', '#directory-open', '#theme-toggle']:
            box = page.locator(selector).bounding_box()
            assert box['x'] >= 0 and box['x'] + box['width'] <= width
            assert box['y'] >= 0 and box['y'] + box['height'] <= 56
        assert page.locator('body').evaluate('(el) => el.scrollWidth <= innerWidth')
    page.set_viewport_size({'width': 375, 'height': 812})
    expect(page.locator('#view-tabs, #view-select')).to_have_count(0)
    expect(page.locator('#breadcrumbs')).to_be_visible()
    navigate(page, 'generation')
    assert state(page)['viewId'] == 'generation'
    navigate(page, 'overview')
    page.locator('#fit').click()
    page.screenshot(animations='disabled', path=str(ARTIFACTS / 'mobile.png'))
    assert page.locator('body').evaluate('(el) => el.scrollWidth <= innerWidth')
    controls = page.locator('.camera-controls').bounding_box()
    assert controls['x'] >= 0 and controls['x'] + controls['width'] <= 375
    page.locator('#directory-open').click()
    page.locator('#directory-list button').first.click()
    expect(page.locator('#detail')).to_be_visible()
    page.screenshot(animations='disabled', path=str(ARTIFACTS / 'mobile-details.png'))

    # Inert hostile strings render as text, and storage failure leaves the viewer usable.
    hostile = context.new_page()
    hostile.on('pageerror', lambda error: errors.append(str(error)))
    hostile.add_init_script("Object.defineProperty(window, 'localStorage', { get() { throw new Error('disabled'); } });")
    hostile.emulate_media(color_scheme='light')
    load(hostile, ARTIFACTS / 'hostile.html')
    blocked_light = theme_state(hostile)['background']
    expect(hostile.get_by_role('button', name='切换到深色', exact=True)).to_be_visible()
    hostile.locator('#theme-toggle').click()
    assert theme_state(hostile)['explicit'] == 'dark'
    assert theme_state(hostile)['background'] != blocked_light
    expect(hostile.get_by_role('button', name='切换到浅色', exact=True)).to_be_visible()
    hostile.locator('#theme-toggle').click()
    assert theme_state(hostile) == {'explicit': 'light', 'background': blocked_light}
    hostile.locator('.node').first.click()
    if hostile.locator('#inspect-module').is_visible():
        hostile.locator('#inspect-module').click()
    assert hostile.evaluate('window.injected === undefined')
    expect(hostile.locator('#detail')).to_be_visible()
    assert '<script>' in hostile.locator('#detail-summary').inner_text()
    assert '无法保存' in hostile.locator('#storage-state').inner_text()
    hostile.locator('#detail').evaluate('(el) => Promise.all(el.getAnimations().map(a => a.finished.catch(() => {})))')
    header_y = hostile.locator('#detail-close').bounding_box()['y']
    hostile.locator('#detail-body').evaluate('(el) => { el.scrollTop = el.scrollHeight; }')
    assert hostile.locator('#detail-body').evaluate('(el) => el.scrollTop > 200')
    assert abs(hostile.locator('#detail-close').bounding_box()['y'] - header_y) < .1
    expect(hostile.locator('#detail-close')).to_be_in_viewport()

    touch_context = browser.new_context(viewport={'width': 375, 'height': 812}, has_touch=True, is_mobile=True, accept_downloads=True)
    touch = touch_context.new_page()
    touch.on('pageerror', lambda error: errors.append(str(error)))
    load(touch, DEMO)
    navigate(touch, 'interaction')
    assert state(touch)['viewId'] == 'interaction'
    navigate(touch, 'overview')
    touch.locator('#directory-open').tap()
    expect(touch.locator('#directory')).to_be_visible()
    assert touch.locator('#search').evaluate('(el) => getComputedStyle(el).fontSize') == '16px'
    # Animated parent translations can introduce subpixel rounding in screen bounds.
    assert touch.locator('#directory-close').evaluate('(el) => parseFloat(getComputedStyle(el).minHeight)') >= 44
    assert touch.locator('#directory-close').bounding_box()['height'] >= 43.99
    with touch.expect_download() as mobile_download:
        touch.locator('#directory-export').tap()
    assert mobile_download.value.suggested_filename.endswith('.layout.json')
    touch.locator('#directory-close').tap()
    # Actual multi-touch pointer input keeps the graph anchored while pinching.
    session = touch_context.new_cdp_session(touch)
    initial_zoom = state(touch)['camera']['k']
    session.send('Input.dispatchTouchEvent', {'type': 'touchStart', 'touchPoints': [{'x': 130, 'y': 600, 'id': 1}, {'x': 230, 'y': 600, 'id': 2}]})
    session.send('Input.dispatchTouchEvent', {'type': 'touchMove', 'touchPoints': [{'x': 90, 'y': 600, 'id': 1}, {'x': 270, 'y': 600, 'id': 2}]})
    session.send('Input.dispatchTouchEvent', {'type': 'touchEnd', 'touchPoints': []})
    assert state(touch)['camera']['k'] > initial_zoom
    touch_context.close()
    check_theme(browser, errors)
    assert not errors, errors
    assert not [url for url in requests if url.startswith(('http:', 'https:'))], requests
    browser.close()
    print('Browser smoke passed: offline views, details, search icon, transform drag, routes, storage, layout replay, camera, keyboard, touch/pinch, system/manual theme, persisted first-frame theme, reduced motion, press feedback, fixed panel header, inert text.')
