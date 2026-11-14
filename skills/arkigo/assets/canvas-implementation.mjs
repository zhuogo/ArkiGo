// Implementation observations are independent of design approval and test results.
export const IMPLEMENTATION_STATES = Object.freeze({
  planned: { label: '待实现', description: '明确计划要做，目前尚未实现。' },
  partial: { label: '部分实现', description: '仅覆盖部分行为，具体缺口见说明。' },
  implemented: { label: '已实现', description: '已核对对应实现；不等于测试通过或已经上线。' },
  unknown: { label: '未核对', description: '尚未核对，或原有结论需要复查；不代表未实现。' },
});

export function implementationStatus(node) {
  return node.implementation?.status ?? 'unknown';
}
