#!/usr/bin/env python3
"""
Local server for Synesthesia: http://localhost:5173

Same as `python3 -m http.server`, but it tells the browser not to cache the
app's files, so after updating the project a normal reload always gets the new
version (a stale mix of old and new files can cause odd behaviour).
"""
import functools
import http.server
import os
import socketserver
import sys

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 5173


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map, '.js': 'text/javascript', '.mjs': 'text/javascript'}

    def end_headers(self):
        # recordings never change, so let the browser keep them; everything else is always fresh
        if '/assets/samples/' in self.path or self.path.startswith('/vendor/'):
            self.send_header('Cache-Control', 'public, max-age=86400')
        else:
            self.send_header('Cache-Control', 'no-store')
        super().end_headers()


socketserver.TCPServer.allow_reuse_address = True
# Safety: serve only the app's own folder (wherever the command is started from),
# and only to this computer (127.0.0.1), not to other devices on the same Wi-Fi.
ROOT = os.path.dirname(os.path.abspath(__file__))
handler = functools.partial(NoCacheHandler, directory=ROOT)
with socketserver.TCPServer(('127.0.0.1', PORT), handler) as httpd:
    print(f'Synesthesia is running at http://localhost:{PORT}  (Ctrl+C to stop)')
    httpd.serve_forever()
