// SSH 向导只提供配置和记录用户确认，不建立远程连接、不推断声音已播放。
(() => {
  const markNavigation = () => {
    for (const link of document.querySelectorAll('nav a')) link.classList.toggle('selected', link.hash === (location.hash || '#tools'));
  };
  window.addEventListener('hashchange', markNavigation);
  markNavigation();
  const root = document.querySelector('#ssh-tools');
  const status = root.querySelector('#ssh-status');
  const checks = [...root.querySelectorAll('input[data-ssh-check]')];
  const key = 'relay-ssh-guide-v2';
  const render = () => {
    const count = checks.filter(input => input.checked).length;
    status.textContent = count === checks.length ? '你已确认全部步骤；回响未自动检测远端状态' : `已手动确认 ${count}/${checks.length} 步 · 尚未完成真实任务验证`;
  };
  try {
    const saved = JSON.parse(localStorage.getItem(key) || '{}');
    for (const input of checks) input.checked = saved[input.dataset.sshCheck] === true;
  } catch { /* 存储不可用时仍可使用配置向导。 */ }
  root.addEventListener('change', () => {
    render();
    try { localStorage.setItem(key, JSON.stringify(Object.fromEntries(checks.map(input => [input.dataset.sshCheck, input.checked])))); }
    catch { status.textContent += '；此环境无法保存进度'; }
  });
  root.addEventListener('click', async event => {
    const button = event.target.closest('button[data-copy]');
    if (!button) return;
    const code = document.getElementById(button.dataset.copy);
    try {
      await navigator.clipboard.writeText(code.textContent);
      status.textContent = '已复制。请到步骤指定的本地或 SSH 终端使用；复制不代表配置已经生效。';
    } catch {
      const range = document.createRange(); range.selectNodeContents(code);
      const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
      status.textContent = '无法自动复制，已选中内容，请按 Command+C 复制。';
    }
  });
  render();
})();
