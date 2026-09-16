// 文字图标字符：取名称前两个字符（图标解析失败/无图标时的兜底展示）。
// - 中文站名 → 前两个汉字（如「知乎」「豆瓣」）
// - 英文站名 → 前两个字母（如 Gi / AW / Py），与主流导航站一致
// - Array.from 按 Unicode 码点切，emoji/生僻字不会被劈成乱码；
//   先剥掉空白与变体选择符/零宽连接符，避免取出不可见字符
export function textIconChars(name) {
  const s = String(name || '')
    .replace(/[\s\u200d\uFE0F]+/g, '')
  if (!s) return '?'
  const chars = Array.from(s)
  return chars.slice(0, 2).join('') || '?'
}
