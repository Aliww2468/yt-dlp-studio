// yt-dlp reports these problems in English; each hint says what to change in the app.
const where = '「高级选项 → 网络与访问」';
const rules = [
  [/Could not copy (\w+) cookie database/i, m => `无法读取 ${m[1]} 的 Cookie：浏览器运行时会锁定 Cookie 数据库，新版 Chrome / Edge 还对 Cookie 做了加密，下载器读不到。请在${where}中改用 Cookie 文件，或把浏览器登录状态设为「不读取」。`],
  [/Failed to decrypt with DPAPI|app.bound encryption/i, () => `无法解密浏览器的 Cookie（新版 Chrome / Edge 在 Windows 上加密了 Cookie）。请在${where}中改用 Cookie 文件。`],
  [/could not find \w+ cookies database/i, () => `找不到该浏览器的 Cookie，可能没有安装或从未登录。请在${where}中改用 Cookie 文件，或设为「不读取」。`],
  [/Netscape format cookies|in cookies file/i, () => `Cookie 文件无法使用：请用浏览器扩展导出 Netscape 格式的 cookies.txt，再在${where}中重新选择。`],
  [/Sign in to confirm you.?re not a bot|Sign in to confirm your age|members-only content|Private video/i, () => `该视频需要登录才能下载：请在${where}中选择 Cookie 文件后重试。`],
];
export function explainError(line) {
  for (const [pattern, hint] of rules) { const m = pattern.exec(line); if (m) return hint(m); }
  return '';
}
