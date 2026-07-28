document.getElementById('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const username = document.getElementById('username').value;
  const password = document.getElementById('password').value;
  const errorEl = document.getElementById('error');
  errorEl.textContent = '';

  try {
    const body = new URLSearchParams();
    body.set('username', username);
    body.set('password', password);
    const res = await fetch('/auth/token', { method: 'POST', body });
    if (!res.ok) throw new Error('Kullanıcı adı veya şifre hatalı');
    const data = await res.json();
    setToken(data.access_token);
    window.location.href = '/app/';
  } catch (err) {
    errorEl.textContent = err.message;
  }
});

// Zaten girişliyse doğrudan uygulamaya yönlendir
if (getToken()) {
  window.location.href = '/app/';
}
