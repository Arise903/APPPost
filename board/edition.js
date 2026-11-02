/* Edition-specific copy. Defaults describe the local file edition; the Pages and
   cloud builds overlay `window.BOARD_STRINGS` before this module runs. */
const EDITION = window.RELEASE_PAGES ? "pages" : window.RELEASE_CLOUD ? "cloud" : "local";
const EDITION_STRINGS = Object.assign({
  connectedBadge: "已连接 · 可写回文件",
  offlineBadge: "离线模式 · 仅本机保存",
  connectedStatus: "已连接本地服务 · 世代 {gen} · 勾选可直接写回 md",
  connectedToast: "已连接本地服务，可直接保存到 md",
  saveTitle: "保存勾选状态到 md 文件？",
  saveKeepNote: "文件中原有的其他内容与格式保持不变。",
  saveDetail: "写回前会自动生成一份带时间戳的 .bak 备份文件。",
  savedToast: "已写回文件",
  clearRewrite: "文件会被直接改写",
  clearDetail: "原始文件会先自动备份为 带时间戳的 .bak 文件，误操作可从备份恢复。"
}, window.BOARD_STRINGS || {});
