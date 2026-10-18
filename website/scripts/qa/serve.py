#!/usr/bin/env python3
"""Serves a directory on 127.0.0.1 for QA. Python 3 standard library only.

http.server's default listen backlog of 5 resets Chrome's parallel connections
(ERR_CONNECTION_RESET / ERR_SOCKET_NOT_CONNECTED), so the backlog is raised.
Prints 'listening <port>' only after the socket is bound, so callers can tell
this server apart from another listener on the same port."""
import functools, http.server, sys


class Server(http.server.ThreadingHTTPServer):
    request_queue_size = 128
    daemon_threads = True


def main():
    port, directory = int(sys.argv[1]), sys.argv[2]
    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=directory)
    with Server(('127.0.0.1', port), handler) as server:
        print('listening', server.server_address[1], flush=True)
        server.serve_forever()


main()
