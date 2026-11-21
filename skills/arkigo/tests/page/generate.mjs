const base = (id, type, parent, title, summary = '', body = {}) =>
  ({ id, type, title, summary, parent, status: 'accepted', origin: 'user', body });

function design(id, title, objects = [], relations = []) {
  const root = base(id, 'system', null, title, '', {
    audience: ['项目负责人'], goals: ['检查离线阅读页'], scopeIn: ['页面验收']
  });
  return { format: 'arkigo/2', id, title, objects: [root, ...objects], relations };
}

const item = (i) => 'item-' + String(i).padStart(3, '0');

export function createBoundaries() {
  const cards = Array.from({ length: 40 }, (_, i) =>
    base(item(i), 'module', 'crowded', '排版模块 ' + (i + 1), '检查分区内卡片之间的间隔。', {
      responsibilities: ['展示排版边界']
    }));
  const dangerous = '<script>window.intruded = true</script> "单引号\' 反引号` 行分隔\u2028 段分隔\u2029';
  return {
    empty: design('empty', '空白项目'),
    crowded: design('crowded', '四十张卡片', cards, [
      { from: item(0), to: item(1), type: 'depends_on' },
      { from: item(1), to: item(2), type: 'depends_on' },
      { from: item(2), to: item(0), type: 'depends_on' }
    ]),
    long: design('long', '长文本', [
      base('long-card', 'module', 'long', '超长模块标题'.repeat(13).slice(0, 80), '边界文字'.repeat(75),
        { responsibilities: ['用详情读取完整内容'] })
    ]),
    dangerous: design('danger', '字符转义', [base('literal', 'actor', 'danger', dangerous, dangerous, {
      description: dangerous
    })])
  };
}

// Four modules with a relation between every pair, so the map has more lines than cards.
export function createDense() {
  const ids = ['a', 'b', 'c', 'd'];
  const cards = ids.map((id) =>
    base(id, 'module', 'dense', '模块 ' + id.toUpperCase(), '检查主要关系。', { responsibilities: ['展示关系'] }));
  const link = (from, to, type) => ({ from, to, type });
  return design('dense', '关系密集', cards, [
    link('a', 'b', 'calls'), link('b', 'a', 'reads'), link('a', 'b', 'calls'), link('a', 'c', 'relates'),
    link('b', 'c', 'writes'), link('c', 'd', 'reads'), link('a', 'd', 'relates'), link('b', 'd', 'relates')
  ]);
}

export function generateScale() {
  const objects = Array.from({ length: 499 }, (_, i) => {
    const parent = i < 40 ? 'scale' : i < 360 ? item((i - 40) % 40)
      : i < 460 ? item(40 + i - 360) : item(360 + i - 460);
    return {
      ...base(item(i), 'module', parent, '门诊业务模块 ' + (i + 1),
        '处理门诊协作任务，记录当前处理阶段和下一步。', { responsibilities: ['维护诊所业务处理记录'] }),
      group: ['接诊', '诊疗', '运营', '患者服务'][i % 4]
    };
  });
  objects[160] = base(item(160), 'flow', item(0), '预约处理', '记录预约处理结果。', {
    start: 'receive', ends: ['done', 'reject'],
    steps: [
      { id: 'receive', title: '接收预约', action: '核查号源，登记预约请求。', failure: '提示重试。' },
      { id: 'done', title: '确认', action: '返回预约凭证。' },
      { id: 'reject', title: '拒绝', action: '说明拒绝原因。' }
    ],
    transitions: [
      { from: 'receive', to: 'done', when: '有号源' },
      { from: 'receive', to: 'reject', when: '号源已满' }
    ]
  });
  const relations = Array.from({ length: 800 }, (_, i) => ({
    from: item(i % 499), to: item((i + 1 + Math.floor(i / 499) * 40) % 499), type: 'depends_on'
  }));
  return design('scale', '门诊服务规模样例', objects, relations);
}
