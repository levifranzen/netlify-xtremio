import { env } from "./config";

export function configurePage(): string {
  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(env.addonName)} - Configure</title>
  <style>
    body { font-family: system-ui, -apple-system, Segoe UI, sans-serif; max-width: 760px; margin: 40px auto; padding: 0 20px; background: #111; color: #eee; }
    label { display: block; margin: 14px 0 6px; font-weight: 600; }
    input, select { width: 100%; box-sizing: border-box; padding: 12px; border-radius: 8px; border: 1px solid #444; background: #1d1d1d; color: #fff; }
    button { margin-top: 18px; padding: 12px 18px; border: 0; border-radius: 8px; cursor: pointer; font-weight: 700; }
    code, pre { background: #1d1d1d; border-radius: 8px; padding: 12px; display: block; overflow-wrap: anywhere; white-space: pre-wrap; }
    a { color: #8ab4f8; }
  </style>
</head>
<body>
  <h1>${escapeHtml(env.addonName)}</h1>
  <p>Configure seu provider Xtream. O provider index fica só temporariamente no <code>/tmp</code>; Redis guarda apenas TMDB e matches.</p>

  <form id="form">
    <label>Nome do addon/provider</label>
    <input name="providerName" placeholder="Meu Provider" />

    <label>Base URL</label>
    <input name="baseUrl" placeholder="https://exemplo.com:8080" required />

    <label>Usuário</label>
    <input name="username" required />

    <label>Senha</label>
    <input name="password" type="password" required />

    <label>Idioma TMDB</label>
    <input name="lang" value="pt-BR" />

    <label>Extensão Live</label>
    <select name="liveContainer">
      <option value="m3u8">m3u8</option>
      <option value="ts">ts</option>
    </select>

    <button type="submit">Gerar URL do manifest</button>
  </form>

  <h2>Manifest</h2>
  <pre id="result">Preencha o formulário.</pre>

  <script>
    function base64url(str) {
      const bytes = new TextEncoder().encode(str);
      let bin = '';
      bytes.forEach((b) => bin += String.fromCharCode(b));
      return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
    }

    document.getElementById('form').addEventListener('submit', (event) => {
      event.preventDefault();
      const data = Object.fromEntries(new FormData(event.target).entries());
      data.baseUrl = String(data.baseUrl || '').replace(/\/+$/, '');
      const hash = base64url(JSON.stringify(data));
      const manifest = location.origin + '/' + hash + '/manifest.json';
      document.getElementById('result').innerHTML = '<a href="' + manifest + '">' + manifest + '</a>';
    });
  </script>
</body>
</html>`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[char] || char));
}
