"""Independent detail-card regression checks. Requires development Playwright/Chromium.

Run: python -X utf8 skills/arkigo/tests/browser-details.py
The fixture, screenshots and report stay in ignored .artifacts/detail-cards/.
"""
import json
import subprocess
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[3]
OUT = ROOT / '.artifacts/detail-cards'
OUT.mkdir(parents=True, exist_ok=True)
HOSTILE = '</script><img src=x onerror="window.injected=true">'
document = {
    'schemaVersion': 'arkigo-canvas/1', 'id': 'detail-cards-test', 'revision': '1',
    'title': '详情卡片检查', 'description': '合成测试数据，不是项目事实。',
    'views': [{
        'id': 'overview', 'title': '详情卡片检查', 'subtitle': '',
        'zones': [{'id': 'core', 'title': '检查范围', 'x': 20, 'y': 112, 'width': 760, 'height': 300}],
        'nodes': [
            {'id': 'first', 'title': '处理输入', 'summary': '读取输入，检查后交给下一步。',
             'kind': '能力', 'x': 50, 'y': 172, 'zoneId': 'core', 'sourceOrigin': 'example',
             'designStatus': 'proposed',
             'implementation': {'status': 'partial', 'note': '已覆盖主路径，真实宿主未检查。', 'sources': ['src/input.js — accept', HOSTILE]},
             'details': {'职责': '保存必要输入与上下文。', '主流程': ['接收输入。', '检查输入。', '交付下一步。'],
                         '基本规则': ['保留原始输入。', '失败时不继续。'], '重要例外': '**空输入直接返回**，保留用户内容。',
                         '文本安全': f'**{HOSTILE}**',
                         '深入时看': 'src/input.js — accept',
                         **{f'边界 {i}': ('长内容与中英文边界。' * 10 if i == 0 else '保留必要上下文。') for i in range(12)}},
             'sources': ['src/input.js — accept', 'src/shared.js']},
            {'id': 'next', 'title': '下一步', 'summary': HOSTILE, 'kind': '能力',
             'x': 430, 'y': 172, 'zoneId': 'core', 'details': {'边界': '本卡片没有声明其他关系之外的内容。'}, 'sources': []}
        ],
        'edges': [{'id': 'handoff', 'from': 'first', 'to': 'next', 'kind': 'call', 'label': '交付输入'}],
        'walkthrough': []
    }]
}
fixture, html = OUT / 'cards.canvas.json', OUT / 'cards.html'
fixture.write_text(json.dumps(document, ensure_ascii=False), encoding='utf-8')
subprocess.run(['node', str(ROOT / 'skills/arkigo/scripts/render.mjs'), str(fixture), str(html)], check=True)


def load(page):
    page.goto(html.as_uri())
    page.wait_for_function('window.arkigoCanvas')
    page.wait_for_timeout(80)  # Initial ResizeObserver camera update.


def settle(page):
    page.locator('#detail').evaluate('(el)=>Promise.all(el.getAnimations({subtree:true}).map(a=>a.finished.catch(()=>{})))')


def open_first(page):
    page.locator('.node[data-id="first"]').click()
    settle(page)


def main():
    reports, errors, requests = [], [], []
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        for theme in ('light', 'dark'):
            for width, height in ((1440, 1000), (820, 900), (375, 812)):
                context = browser.new_context(viewport={'width': width, 'height': height}, color_scheme=theme,
                                              has_touch=width == 375, is_mobile=width == 375)
                page = context.new_page()
                page.on('pageerror', lambda e: errors.append(str(e)))
                page.on('request', lambda r: requests.append(r.url) if r.url.startswith(('http:', 'https:')) else None)
                load(page)
                open_first(page)
                expect(page.locator('#detail')).to_be_visible()
                expect(page.locator('#detail-close')).to_have_count(0)
                assert 'panel' not in page.locator('#detail').get_attribute('class').split()
                surface = page.locator('#detail').evaluate('(e)=>{const s=getComputedStyle(e);return [s.backgroundColor,s.borderTopWidth,s.boxShadow]}')
                assert surface == ['rgba(0, 0, 0, 0)', '0px', 'none'], surface
                assert page.locator('.detail-flow ol li').count() == 3
                expect(page.locator('.detail-flow')).to_have_class('detail-card detail-wide detail-flow')
                assert page.locator('section').filter(has=page.get_by_role('heading', name='基本规则', exact=True)).locator('ul li').count() == 2
                expect(page.get_by_text('空输入直接返回，保留用户内容。', exact=True)).to_be_visible()
                expect(page.locator('#detail-fields strong').filter(has_text='空输入直接返回')).to_have_count(1)
                expect(page.locator('#detail-fields strong').filter(has_text=HOSTILE)).to_have_count(1)
                assert page.locator('#detail-body').evaluate('(e)=>getComputedStyle(e).scrollbarWidth') == 'none'
                colors = page.locator('#detail-fields .detail-symbol').evaluate_all('(icons)=>icons.map(e=>getComputedStyle(e).color)')
                assert len(set(colors)) >= 4, colors
                assert page.locator('#detail-source-fields .source-field').count() == 1
                assert page.locator('#detail-fields .source-field').count() == 0
                assert not page.locator('#detail-code').evaluate('(e)=>e.open')
                assert page.locator('#detail-source-count').inner_text() == '3'  # Exact duplicate source removed.
                columns = page.locator('#detail-body').evaluate('(e)=>getComputedStyle(e).gridTemplateColumns.split(" ").length')
                assert columns == (1 if width == 375 else 2)
                assert page.locator('#detail').evaluate('(e)=>e.getBoundingClientRect().right <= innerWidth')
                assert page.locator('#detail .detail-card').evaluate_all('(cards)=>cards.every(e=>e.scrollWidth<=e.clientWidth+1)')
                assert page.locator('#detail-body').evaluate('(e)=>e.scrollHeight>e.clientHeight')
                header_y = page.locator('.detail-identity').bounding_box()['y']
                page.locator('#detail-code > summary').click()
                expect(page.locator('#detail-evidence')).to_contain_text(HOSTILE)
                expect(page.locator('#detail-sources')).to_contain_text('src/shared.js')
                assert abs(page.locator('.detail-identity').bounding_box()['y'] - header_y) < .1
                expect(page.locator('#detail')).to_be_visible()  # Interacting inside never dismisses it.
                assert page.locator('#detail img, #detail script').count() == 0
                assert page.evaluate('window.injected === undefined')
                if width == 375:
                    assert page.locator('#detail-code > summary').bounding_box()['height'] >= 44
                page.screenshot(path=str(OUT / f'cards-{theme}-{width}.png'))
                # Related-node selection is immediate, clears the previous scroll/disclosure, and remains inert.
                page.locator('#detail-relations button').click()
                expect(page.locator('#detail-title')).to_have_text('下一步')
                expect(page.locator('#detail-summary')).to_have_text(HOSTILE)
                assert page.locator('#detail').get_attribute('data-motion') == 'none'
                assert page.locator('#detail-body').evaluate('(e)=>e.scrollTop') == 0
                assert not page.locator('#detail-code').evaluate('(e)=>e.open')
                page.keyboard.press('Escape')
                expect(page.locator('#detail')).to_be_hidden()
                # Keyboard entry never waits for the card animation.
                page.locator('.node[data-id="first"]').focus()
                page.keyboard.press('Enter')
                expect(page.locator('#detail-title')).to_have_text('处理输入')
                assert page.locator('#detail').get_attribute('data-motion') == 'none'
                assert page.locator('#detail').evaluate('(e)=>e.getAnimations({subtree:true}).length') == 0
                expect(page.locator('#detail-body')).to_be_focused()
                page.keyboard.press('Escape')
                page.emulate_media(reduced_motion='reduce')
                page.locator('#fit').click()
                open_first(page)
                assert page.locator('#detail .detail-card').evaluate_all('(cards)=>cards.every(e=>getComputedStyle(e).transform==="none" && getComputedStyle(e).animationName==="none")')
                # Repeated open/close stays usable and does not leave an animation lock.
                for attempt in range(3):
                    if attempt == 1:
                        page.locator('#viewport').click(position={'x': 2, 'y': 100})
                    else:
                        page.locator('.header').click(position={'x': 8, 'y': 28})
                    expect(page.locator('#detail')).to_be_hidden()
                    page.locator('.node[data-id="first"]').click()
                    expect(page.locator('#detail-title')).to_have_text('处理输入')
                page.locator('#theme-toggle').click()
                expect(page.locator('#detail')).to_be_hidden()
                # A direct click on another node switches cards without an exit/re-entry animation.
                if width == 1440:  # On narrow screens the rail covers the graph; relations remain available.
                    page.locator('#fit').click()
                    page.locator('.node[data-id="next"]').click()
                    settle(page)
                    page.locator('.node[data-id="first"]').click()
                    expect(page.locator('#detail-title')).to_have_text('处理输入')
                    assert page.locator('#detail').get_attribute('data-motion') == 'none'
                reports.append({'theme': theme, 'width': width, 'passed': True})
                context.close()
        browser.close()
    assert not errors, errors
    assert not requests, requests
    (OUT / 'results.json').write_text(json.dumps(reports, indent=2), encoding='utf-8')
    print('Detail cards passed: independent surfaces, responsive grid, semantic colors, safe bold emphasis, ordered flow, source disclosure, hidden scrollbars with working scrolling, outside dismissal, node switching, keyboard/reduced motion, and inert text.')


if __name__ == '__main__':
    main()
