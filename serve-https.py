#!/usr/bin/env python3
import http.server
import ssl
import os

# Change to public directory
os.chdir('public')

# Create server
server_address = ('0.0.0.0', 2050)
httpd = http.server.HTTPServer(server_address, http.server.SimpleHTTPRequestHandler)

# Wrap with SSL (self-signed cert)
# Note: Browser will show security warning on first visit
context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
context.check_hostname = False
context.verify_mode = ssl.CERT_NONE

# Try to use existing cert, or create one
cert_file = '../cert.pem'
key_file = '../key.pem'

if not os.path.exists(cert_file):
    print("Creating self-signed certificate...")
    os.system(f'openssl req -x509 -newkey rsa:2048 -nodes -keyout {key_file} -out {cert_file} -days 365 -subj "/CN=localhost"')

context.load_cert_chain(cert_file, key_file)
httpd.socket = context.wrap_socket(httpd.socket, server_side=True)

print(f"Serving HTTPS on https://0.0.0.0:2050 ...")
httpd.serve_forever()
