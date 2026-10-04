"""Local service owned by the Node bot; exits when its parent closes stdin."""
import json
import os
import sys
import threading
from http.server import ThreadingHTTPServer

import bot

bot.CACHE_DIR = os.environ.get('DAN_CACHE_DIR', '_bot_cache')
bot.tool.ensure_utf8_stdio()
server = ThreadingHTTPServer(('127.0.0.1', 0), bot._Handler)
bot._Handler.token = os.environ['DAN_SERVICE_TOKEN']


def watch_parent():
    sys.stdin.buffer.read()
    server.shutdown()


threading.Thread(target=watch_parent, daemon=True).start()
print(json.dumps({'port': server.server_port}), flush=True)
try:
    server.serve_forever()
finally:
    server.server_close()
