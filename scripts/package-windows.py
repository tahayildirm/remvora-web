"""Run npm run build first. Package a credential-free static IIS deployment."""
from pathlib import Path
import zipfile
import argparse
import re
from html import escape
from urllib.parse import urlsplit
p = argparse.ArgumentParser(description=__doc__)
p.add_argument("--api-origin", help="HTTPS API origin; omit for same-origin deployment")
a = p.parse_args()
if a.api_origin:
    u = urlsplit(a.api_origin)
    if u.scheme != "https" or not u.hostname or u.username or u.password or u.path not in ("", "/") or u.query or u.fragment:
        p.error("Use an HTTPS origin without credentials, path, query or fragment")
root = Path(__file__).resolve().parents[1]
publish = root / 'dist/remvora-web/browser'
index = publish / 'index.html'
text = index.read_text()
text = re.sub(r'<meta\s+name="remvora-api-origin"[^>]*>\s*', '', text)
if a.api_origin:
    meta = '<meta name="remvora-api-origin" content="' + escape(a.api_origin.rstrip('/'), quote=True) + '">'
    text = text.replace('<head>', '<head>\n' + meta)
index.write_text(text)
(publish / 'web.config').write_text('''<?xml version="1.0" encoding="utf-8"?>
<configuration><system.webServer>
<defaultDocument><files><clear/><add value="index.html"/></files></defaultDocument>
<httpProtocol><customHeaders><add name="X-Content-Type-Options" value="nosniff"/><add name="Referrer-Policy" value="no-referrer"/><add name="X-Frame-Options" value="DENY"/></customHeaders></httpProtocol>
</system.webServer></configuration>''')
with zipfile.ZipFile(root / 'dist/remvora-web-panel.zip', 'w', zipfile.ZIP_DEFLATED) as archive:
    for path in sorted(publish.rglob('*')):
        if path.is_file():
            archive.write(path, path.relative_to(publish))
