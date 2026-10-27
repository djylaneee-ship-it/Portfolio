"""TCP bridge between the MCP server and Blender (SPEC.md section 2).

Socket threads only read/parse JSON lines and send responses. Every command runs on Blender's main thread:

    client thread --(request, Event, holder)--> _queue --> bpy.app.timers callback (GUI, every 0.02 s)
                                                       +-> run_blocking() loop        (headless tests)

The main thread also encodes the response, so command results may still contain bpy / mathutils values
(they are converted by json_safe()). The main thread never touches a socket.
"""

import json
import math
import numbers
import os
import queue
import socket
import sys
import threading
import time
import traceback
from collections.abc import Mapping

import bpy
import mathutils

from . import commands

HOST = "127.0.0.1"
DEFAULT_PORT = 9876
MAX_LINE = 64 * 1024 * 1024          # bytes per request line
TIMER_INTERVAL = 0.02                # seconds between queue drains in the GUI
PUMP_BUDGET_S = 0.1                  # max time per timer tick before giving the UI back (one command always runs)
_RECV_TIMEOUT = 0.5                  # socket polling period, so threads notice stop() quickly
_SEND_TIMEOUT = 60.0


def _read_version():
    try:
        import tomllib
        with open(os.path.join(os.path.dirname(__file__), "blender_manifest.toml"), "rb") as fh:
            return str(tomllib.load(fh).get("version", "0.1.0"))
    except Exception:
        return "0.1.0"


ADDON_VERSION = _read_version()

# Read by the N-panel. Only simple assignments from threads (atomic in CPython).
status = {
    "running": False,
    "port": None,
    "clients": 0,
    "requests": 0,
    "last_command": None,
    "last_duration_ms": None,
    "last_error": None,
}

_queue = queue.Queue()
_server = None
_clients_lock = threading.Lock()
_ui = {"dirty": False}               # set when the panel should redraw


class CommandError(Exception):
    """Raise from a command for a clean error message (no exception-type prefix).

    traceback_text, when given, replaces the server's own traceback in the error response.
    """

    def __init__(self, message, traceback_text=None):
        super().__init__(message)
        self.traceback_text = traceback_text


# ---------------------------------------------------------------------------------------------------------
# JSON helpers
# ---------------------------------------------------------------------------------------------------------

_MATH_SEQ = (mathutils.Vector, mathutils.Euler, mathutils.Quaternion, mathutils.Color)


def _short_repr(value, limit=2000):
    try:
        text = repr(value)
    except Exception as exc:
        text = "<unrepresentable %s: %s>" % (type(value).__name__, exc)
    return text if len(text) <= limit else text[:limit] + "...(truncated)"


def json_safe(value, max_items=10000, _depth=0):
    """Return a JSON-compatible copy of value.

    mathutils values become lists (Matrix -> list of rows), mappings/sequences/bpy collections are converted
    recursively (at most max_items entries each), non-finite floats become strings, anything else is repr()'d.
    """
    if value is None or isinstance(value, (bool, int, str)):
        return value
    if isinstance(value, float):
        return value if math.isfinite(value) else repr(value)
    if isinstance(value, numbers.Integral):
        return int(value)
    if isinstance(value, numbers.Real):
        return json_safe(float(value))
    if _depth > 32:
        return _short_repr(value)
    d = _depth + 1
    if isinstance(value, mathutils.Matrix):
        return [[json_safe(x) for x in row] for row in value]
    if isinstance(value, _MATH_SEQ):
        return [json_safe(x) for x in value]
    if isinstance(value, (bytes, bytearray)):
        try:
            return bytes(value).decode("utf-8")
        except UnicodeDecodeError:
            return _short_repr(value)
    if isinstance(value, bpy.types.bpy_struct):
        return _short_repr(value)
    if callable(getattr(value, "to_dict", None)):                   # IDPropertyGroup, r6 Clip
        try:
            value = value.to_dict()
        except Exception:
            return _short_repr(value)
    if isinstance(value, Mapping):
        out = {}
        for i, (k, v) in enumerate(value.items()):
            if i >= max_items:
                out["__truncated__"] = True
                break
            out[k if isinstance(k, str) else str(json_safe(k, max_items, d))] = json_safe(v, max_items, d)
        return out
    for conv in ("tolist", "to_list"):                              # numpy arrays, IDPropertyArray
        fn = getattr(value, conv, None)
        if callable(fn):
            try:
                return json_safe(fn(), max_items, d)
            except Exception:
                break
    try:
        it = iter(value)
    except TypeError:
        return _short_repr(value)
    out = []
    try:
        for i, v in enumerate(it):
            if i >= max_items:
                out.append("...(truncated)")
                break
            out.append(json_safe(v, max_items, d))
    except Exception:
        return _short_repr(value)
    return out


def _encode(obj):
    """Response dict -> UTF-8 JSON line. Fast path for clean data, json_safe() fallback otherwise."""
    try:
        text = json.dumps(obj, ensure_ascii=False, allow_nan=False)
    except (TypeError, ValueError):
        text = json.dumps(json_safe(obj), ensure_ascii=False, allow_nan=False)
    return (text + "\n").encode("utf-8")


def _error_payload(rid, message, tb=""):
    return _encode({"id": json_safe(rid), "status": "error", "error": message, "traceback": tb or ""})


# ---------------------------------------------------------------------------------------------------------
# Main-thread execution
# ---------------------------------------------------------------------------------------------------------

def _undo_push(name):
    """Best effort undo step after a mutating command (GUI only)."""
    if bpy.app.background:
        return
    try:
        wm = bpy.context.window_manager
        if not wm or not wm.windows:
            return
        with bpy.context.temp_override(window=wm.windows[0]):
            bpy.ops.ed.undo_push(message="Claude: %s" % name)
    except Exception as exc:
        print("Claude MCP: undo push failed for %s: %s" % (name, exc))


def _describe(exc):
    if isinstance(exc, CommandError):
        return str(exc), exc.traceback_text or ""
    text = str(exc)
    msg = "%s: %s" % (type(exc).__name__, text) if text else type(exc).__name__
    return msg, traceback.format_exc()


def _dispatch(req):
    """Run one request and return the encoded response line. Never raises for command errors."""
    rid = req.get("id")
    name = req.get("command")
    status["requests"] += 1
    status["last_command"] = name if isinstance(name, str) else repr(name)
    _ui["dirty"] = True
    t0 = time.perf_counter()
    try:
        if not isinstance(name, str) or not name:
            raise CommandError("A request needs a 'command' string")
        entry = commands.COMMANDS.get(name)
        if entry is None:
            raise CommandError("Unknown command '%s'. Available: %s" % (name, ", ".join(sorted(commands.COMMANDS))))
        params = req.get("params")
        if params is None:
            params = {}
        if not isinstance(params, dict):
            raise CommandError("'params' must be a JSON object")
        result = entry["fn"](params)
        if entry.get("mutates"):
            _undo_push(name)
        payload = _encode({"id": rid, "status": "ok", "result": result})
    except (Exception, SystemExit) as exc:
        msg, tb = _describe(exc)
        status["last_error"] = "%s: %s" % (status["last_command"], msg.splitlines()[0] if msg else "")
        payload = _error_payload(rid, msg, tb)
    status["last_duration_ms"] = round((time.perf_counter() - t0) * 1000.0, 2)
    return payload


def _process(item):
    req, event, holder = item
    try:
        holder["payload"] = _dispatch(req)
    except BaseException as exc:  # encoding bug or KeyboardInterrupt: still answer the client
        holder["payload"] = _error_payload(req.get("id"), "Internal server error: %r" % (exc,), traceback.format_exc())
        if not isinstance(exc, Exception):
            raise
    finally:
        event.set()


def pump(budget_s=0.0):
    """Run queued requests on the calling (main) thread for at most budget_s seconds. Returns the count."""
    n = 0
    t0 = time.monotonic()
    while True:
        try:
            item = _queue.get_nowait()
        except queue.Empty:
            break
        _process(item)
        n += 1
        if time.monotonic() - t0 >= budget_s:
            break
    return n


def _tag_redraw():
    try:
        for win in bpy.context.window_manager.windows:
            for area in win.screen.areas:
                if area.type == "VIEW_3D":
                    area.tag_redraw()
    except Exception:
        pass


def _on_timer():
    """bpy.app.timers callback: drains the queue while the server runs, unregisters itself otherwise."""
    if _server is None or not _server.running:
        _tag_redraw()
        return None
    pump(PUMP_BUDGET_S)
    if _ui["dirty"]:
        _ui["dirty"] = False
        _tag_redraw()
    return TIMER_INTERVAL


def _ensure_timer():
    if bpy.app.background:
        return
    if not bpy.app.timers.is_registered(_on_timer):
        bpy.app.timers.register(_on_timer, first_interval=TIMER_INTERVAL, persistent=True)


def _fail_pending(message):
    while True:
        try:
            req, event, holder = _queue.get_nowait()
        except queue.Empty:
            return
        holder["payload"] = _error_payload(req.get("id"), message)
        event.set()


# ---------------------------------------------------------------------------------------------------------
# Sockets (background threads)
# ---------------------------------------------------------------------------------------------------------

class _Server:
    def __init__(self, port):
        self.port = int(port)
        self.running = False
        self.listener = None
        self.clients = set()

    def open(self):
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        try:
            if sys.platform == "win32":
                # Refuse to share the port with another Blender instead of silently splitting traffic.
                sock.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
            else:
                sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            sock.bind((HOST, self.port))
            sock.listen(16)
            sock.settimeout(_RECV_TIMEOUT)
        except OSError:
            sock.close()
            raise
        self.listener = sock
        self.running = True
        threading.Thread(target=self._accept_loop, name="claude-mcp-accept", daemon=True).start()

    def close(self):
        self.running = False
        try:
            self.listener.close()
        except OSError:
            pass
        with _clients_lock:
            conns = list(self.clients)
        for conn in conns:
            try:
                conn.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass

    def _accept_loop(self):
        while self.running:
            try:
                conn, _addr = self.listener.accept()
            except socket.timeout:
                continue
            except OSError:
                break  # listener closed by stop()
            if not self.running:
                conn.close()
                break
            threading.Thread(target=self._client_loop, args=(conn,), name="claude-mcp-client", daemon=True).start()

    def _set_clients(self, conn, add):
        with _clients_lock:
            if add:
                self.clients.add(conn)
            else:
                self.clients.discard(conn)
            if _server is self:
                status["clients"] = len(self.clients)
        _ui["dirty"] = True

    def _client_loop(self, conn):
        self._set_clients(conn, True)
        buf = bytearray()
        scanned = 0  # bytes of buf already known to contain no newline
        try:
            conn.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
            conn.settimeout(_RECV_TIMEOUT)
            while self.running:
                nl = buf.find(b"\n", scanned)
                if nl < 0:
                    scanned = len(buf)
                    if len(buf) > MAX_LINE:
                        self._send(conn, _error_payload(None, "Request line longer than %d bytes" % MAX_LINE))
                        break
                    try:
                        chunk = conn.recv(1 << 20)
                    except socket.timeout:
                        continue
                    if not chunk:
                        break  # client closed the connection
                    buf += chunk
                    continue
                line = bytes(buf[:nl])
                del buf[:nl + 1]
                scanned = 0
                if len(line) > MAX_LINE:
                    self._send(conn, _error_payload(None, "Request line longer than %d bytes" % MAX_LINE))
                    break
                payload = self._handle_line(line)
                if payload is not None and not self._send(conn, payload):
                    break
        except OSError:
            pass
        finally:
            self._set_clients(conn, False)
            try:
                conn.close()
            except OSError:
                pass

    def _handle_line(self, line):
        line = line.strip()
        if not line:
            return None
        try:
            req = json.loads(line.decode("utf-8"))
        except (UnicodeDecodeError, ValueError) as exc:
            return _error_payload(None, "Invalid JSON request: %s" % exc)
        if not isinstance(req, dict):
            return _error_payload(None, "A request must be a JSON object")
        event = threading.Event()
        holder = {}
        _queue.put((req, event, holder))
        while not event.wait(0.25):
            if not self.running:
                return _error_payload(req.get("id"), "Server stopped before the command finished")
        return holder.get("payload") or _error_payload(req.get("id"), "No response produced")

    @staticmethod
    def _send(conn, payload):
        try:
            conn.settimeout(_SEND_TIMEOUT)
            conn.sendall(payload)
            conn.settimeout(_RECV_TIMEOUT)
            return True
        except OSError:
            return False


# ---------------------------------------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------------------------------------

def is_running():
    """True while the server accepts connections."""
    return _server is not None and _server.running


def _stop_other_copies():
    """Stop the server of any other loaded copy of this add-on (e.g. an old version still enabled). True if one ran."""
    own = __name__
    found = False
    for name, mod in list(sys.modules.items()):
        if mod is None or name == own or not name.endswith("claude_blender_mcp.server"):
            continue
        try:
            if getattr(mod, "is_running", lambda: False)():
                print("Claude MCP: stopping another copy of the add-on (%s, version %s)" % (
                    name, getattr(mod, "ADDON_VERSION", "?")))
                mod.stop()
                found = True
        except Exception as exc:
            print("Claude MCP: could not stop %s: %s" % (name, exc))
    if found:
        try:
            import addon_utils
            mine = own.rpartition(".")[0]
            for name in {n.rpartition(".")[0] for n in sys.modules if n.endswith("claude_blender_mcp.server")} - {mine}:
                addon_utils.disable(name, default_set=True)
                print("Claude MCP: disabled the old add-on", name)
        except Exception as exc:
            print("Claude MCP: could not disable the old add-on:", exc)
    return found


def start(port=DEFAULT_PORT):
    """Listen on 127.0.0.1:port (restarting if running on another port). Returns False if the port is busy."""
    global _server
    port = int(port)
    if is_running():
        if _server.port == port:
            _ensure_timer()
            return True
        stop()
    if not commands.COMMANDS:
        commands.load_all()
    srv = _Server(port)
    try:
        try:
            srv.open()
        except OSError:
            # Une autre copie de l'add-on (ancienne version) tourne dans ce Blender et garde le port : on l'arrête.
            if not _stop_other_copies():
                raise
            time.sleep(0.3)
            srv.open()
    except OSError as exc:
        status.update(running=False, port=None, clients=0)
        status["last_error"] = "Cannot listen on %s:%d (%s). Is another Blender using this port?" % (HOST, port, exc)
        _ui["dirty"] = True
        print("Claude MCP:", status["last_error"])
        return False
    _server = srv
    status.update(running=True, port=port, clients=0)
    _ui["dirty"] = True
    _ensure_timer()
    print("Claude MCP: listening on %s:%d" % (HOST, port))
    return True


def stop():
    """Stop listening, disconnect clients and fail queued requests. Safe from any thread."""
    global _server
    srv, _server = _server, None
    if srv is not None:
        srv.close()
        print("Claude MCP: server stopped (port %d)" % srv.port)
    _fail_pending("Server stopped before the command ran")
    status.update(running=False, port=None, clients=0)
    _ui["dirty"] = True
    if threading.current_thread() is threading.main_thread():
        try:
            if bpy.app.timers.is_registered(_on_timer):
                bpy.app.timers.unregister(_on_timer)
        except Exception:
            pass
        _tag_redraw()


def run_blocking(port=DEFAULT_PORT, timeout_s=None):
    """Serve from the calling (main) thread until stop() is called or timeout_s seconds pass.

    For headless Blender, which has no timer loop. Starts the server if needed and stops it on return when it
    was started here. Returns {"handled": n, "reason": "stopped" | "timeout"}.
    """
    port = int(port)
    started_here = not (is_running() and _server.port == port)
    if started_here and not start(port):
        raise RuntimeError(status["last_error"])
    srv = _server
    deadline = None if timeout_s is None else time.monotonic() + float(timeout_s)
    handled, reason = 0, "stopped"
    try:
        while srv.running:
            wait = 0.05
            if deadline is not None:
                left = deadline - time.monotonic()
                if left <= 0:
                    reason = "timeout"
                    break
                wait = min(wait, left)
            try:
                item = _queue.get(timeout=wait)
            except queue.Empty:
                continue
            _process(item)
            handled += 1
    finally:
        if started_here and _server is srv:
            stop()
    return {"handled": handled, "reason": reason}
