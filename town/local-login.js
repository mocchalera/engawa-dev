for (const button of document.querySelectorAll('[data-actor]')) button.onclick = async () => {
  try {
    const r = await fetch('/local/session', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Engawa-Client': 'town-ui' }, body: JSON.stringify({ actor: button.dataset.actor }) });
    if (!r.ok) throw new Error('入室できませんでした。');
    location.href = '/';
  } catch (e) { document.querySelector('#error').textContent = e.message; }
};
