"""Development check for implementation icons; requires Python Playwright + Chromium.

Run: python -X utf8 skills/arkigo/tests/browser-implementation.py
Screenshots and the report stay in ignored .artifacts/canvas-engine/implementation/.
"""
import json
import subprocess
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[3]
OUT = ROOT / '.artifacts/canvas-engine/implementation'
OUT.mkdir(parents=True, exist_ok=True)
INPUT = ROOT / 'docs/poc/canvas-engine/implementation.canvas.json'
DEMO = OUT / 'implementation.html'
subprocess.run(['node', str(ROOT / 'skills/arkigo/scripts/render.mjs'), str(INPUT), str(DEMO)], check=True)


def load(page, file=DEMO):
    page.goto(file.as_uri())
    page.wait_for_function('window.arkigoCanvas !== undefined')
    page.wait_for_timeout(100)


def main():
    reports = []
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        for theme in ('light', 'dark'):
            for width, height in ((1440, 1000), (375, 812)):
                context = browser.new_context(viewport={'width': width, 'height': height}, color_scheme=theme, has_touch=width == 375, is_mobile=width == 375)
                page = context.new_page()
                errors, external = [], []
                page.on('pageerror', lambda error: errors.append(str(error)))
                page.on('request', lambda request: external.append(request.url) if request.url.startswith(('http:', 'https:')) else None)
                load(page)
                for status, label in [('implemented', '已实现'), ('partial', '部分实现'), ('planned', '待实现'), ('unknown', '未核对')]:
                    icon = page.locator(f'#nodes .implementation-mark[data-implementation="{status}"]')
                    expect(icon).to_have_count(1)
                    expect(icon).to_have_attribute('aria-label', label)
                    assert label in icon.get_attribute('title')
                    assert icon.locator('svg').count() == 1
                colors = page.locator('#nodes .implementation-mark').evaluate_all('(marks) => marks.map(mark => getComputedStyle(mark).color)')
                assert len(set(colors)) == 4, colors
                assert page.locator('#nodes').evaluate('''nodes => [...nodes.querySelectorAll('.node')].every(node => {
                    const rect = node.getBoundingClientRect(), icon = node.querySelector('.implementation-mark').getBoundingClientRect();
                    return icon.x >= rect.x && icon.right <= rect.right + 1 && icon.y >= rect.y && icon.bottom <= rect.bottom + 1;
                })''')
                page.screenshot(path=str(OUT / f'{theme}-{width}.png'))

                page.locator('#nodes .node[data-id="delivery"]').click()
                expect(page.locator('.implementation-detail')).to_contain_text('部分实现')
                expect(page.locator('.implementation-detail')).to_contain_text('缺少把生成与浏览器检查')
                expect(page.locator('.implementation-evidence .source')).to_have_count(3)
                page.keyboard.press('Escape')
                page.locator('#directory-open').click()
                expect(page.locator('#directory-list .implementation-mark')).to_have_count(4)
                page.locator('#search').fill('browser-smoke.py')
                expect(page.locator('#directory-list button')).to_have_count(1)
                expect(page.locator('#directory-list button')).to_contain_text('统一交付检查')
                page.locator('#directory-close').click()

                page.locator('#nodes .node[data-id="navigation"]').click()
                page.locator('#enter-module').click()
                page.wait_for_function('window.arkigoCanvas.getState().viewId === "navigation" && !window.arkigoCanvas.getState().transitioning')
                expect(page.locator('#nodes .implementation-mark[data-implementation="implemented"]')).to_have_count(2)
                page.locator('#breadcrumbs button[data-view-id="overview"]').click()
                page.wait_for_function('window.arkigoCanvas.getState().viewId === "overview" && !window.arkigoCanvas.getState().transitioning')
                expect(page.locator('#nodes .implementation-mark')).to_have_count(4)

                load(page, ROOT / 'docs/poc/canvas-engine/registration.html')
                assert page.locator('#nodes .implementation-mark').count() == page.locator('#nodes .node').count()
                assert page.locator('#nodes .implementation-mark:not([data-implementation="unknown"])').count() == 0
                assert page.locator('#nodes').evaluate('''nodes => [...nodes.querySelectorAll('.node-footer')].every(footer =>
                    footer.getBoundingClientRect().bottom <= footer.closest('.node').getBoundingClientRect().bottom + 1)''')
                assert not errors, errors
                assert not external, external
                reports.append({'theme': theme, 'width': width, 'passed': True})
                context.close()

        hostile = json.loads(INPUT.read_text(encoding='utf-8'))
        hostile['views'][0]['nodes'][1]['implementation']['note'] = '</script><img src=x onerror="window.injected=true">'
        hostile['views'][0]['nodes'][1]['implementation']['sources'] = ['<img src=x onerror="window.injected=true">']
        hostile_input, hostile_html = OUT / 'inert.canvas.json', OUT / 'inert.html'
        hostile_input.write_text(json.dumps(hostile, ensure_ascii=False), encoding='utf-8')
        subprocess.run(['node', str(ROOT / 'skills/arkigo/scripts/render.mjs'), str(hostile_input), str(hostile_html)], check=True)
        page = browser.new_page()
        load(page, hostile_html)
        page.locator('#nodes .node[data-id="delivery"]').click()
        expect(page.locator('.implementation-detail')).to_contain_text('<img src=x')
        assert page.locator('.implementation-detail img').count() == 0
        assert page.evaluate('window.injected === undefined')
        browser.close()
    (OUT / 'results.json').write_text(json.dumps({'screens': reports, 'inertTextPassed': True}, indent=2), encoding='utf-8')
    print('Implementation browser checks passed: four icon shapes/colors, light/dark, desktop/mobile, accessible labels, detail/source reading, directory search, navigation, legacy defaults, and inert text.')


if __name__ == '__main__':
    main()
