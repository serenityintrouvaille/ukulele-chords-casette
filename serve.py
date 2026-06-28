#!/usr/bin/env python3
"""캐시를 끄는 정적 서버. 매 새로고침마다 최신 파일을 받도록 보장한다."""
import http.server, socketserver

PORT = 8000

class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    # 304(Not Modified) 캐시 응답을 막기 위해 If-Modified-Since 무시
    def send_head(self):
        if "If-Modified-Since" in self.headers:
            del self.headers["If-Modified-Since"]
        if "If-None-Match" in self.headers:
            del self.headers["If-None-Match"]
        return super().send_head()

socketserver.TCPServer.allow_reuse_address = True
with socketserver.TCPServer(("", PORT), NoCacheHandler) as httpd:
    print(f"서버 실행: http://localhost:{PORT}  (캐시 꺼짐)")
    httpd.serve_forever()
