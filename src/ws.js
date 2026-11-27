'use strict';

const crypto = require('crypto');
const { EventEmitter } = require('events');

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const MAX_PAYLOAD_BYTES = 256 * 1024;

function encodeFrame(opcode, payloadBuf) {
  const payload = Buffer.isBuffer(payloadBuf) ? payloadBuf : Buffer.from(String(payloadBuf || ''), 'utf8');
  const len = payload.length;
  let header;

  if (len < 126) {
    header = Buffer.allocUnsafe(2);
    header[0] = 0x80 | (opcode & 0x0f);
    header[1] = len;
  } else if (len <= 0xffff) {
    header = Buffer.allocUnsafe(4);
    header[0] = 0x80 | (opcode & 0x0f);
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.allocUnsafe(10);
    header[0] = 0x80 | (opcode & 0x0f);
    header[1] = 127;
    header.writeUInt32BE(Math.floor(len / 0x100000000), 2);
    header.writeUInt32BE(len >>> 0, 6);
  }

  return Buffer.concat([header, payload]);
}

class WebSocketClient extends EventEmitter {
  constructor(socket) {
    super();
    this.socket = socket;
    this.isAlive = true;
    this.closed = false;
    this.buffer = Buffer.alloc(0);
    this.fragmentChunks = [];
    this.fragmentOpcode = null;

    socket.setNoDelay(true);
    socket.on('data', (chunk) => this._onData(chunk));
    socket.on('error', (err) => {
      if (!this.closed) {
        this.closed = true;
        if (this.listenerCount('error') > 0) {
          this.emit('error', err);
        }
        this.emit('close');
      }
    });
    socket.on('close', () => {
      if (!this.closed) {
        this.closed = true;
        this.emit('close');
      }
    });
  }

  sendText(text) {
    if (this.closed || this.socket.destroyed || !this.socket.writable) return false;
    try {
      this.socket.write(encodeFrame(0x1, Buffer.from(text, 'utf8')));
      return true;
    } catch {
      this.closed = true;
      this.socket.destroy();
      this.emit('close');
      return false;
    }
  }

  sendJson(data) {
    return this.sendText(JSON.stringify(data));
  }

  ping() {
    if (this.closed || this.socket.destroyed || !this.socket.writable) return;
    try {
      this.socket.write(encodeFrame(0x9, Buffer.alloc(0)));
    } catch {
      this.closed = true;
      this.socket.destroy();
      this.emit('close');
    }
  }

  close(code = 1000, reason = '') {
    if (this.closed || this.socket.destroyed) return;
    this.closed = true;
    const reasonBuf = Buffer.from(reason, 'utf8');
    const payload = Buffer.allocUnsafe(2 + reasonBuf.length);
    payload.writeUInt16BE(code, 0);
    reasonBuf.copy(payload, 2);
    try {
      this.socket.end(encodeFrame(0x8, payload));
    } catch {
      this.socket.destroy();
    }
    this.emit('close');
  }

  _onData(chunk) {
    if (this.closed) return;
    this.buffer = Buffer.concat([this.buffer, chunk]);

    while (this.buffer.length >= 2) {
      const b0 = this.buffer[0];
      const b1 = this.buffer[1];
      const fin = (b0 & 0x80) !== 0;
      const opcode = b0 & 0x0f;
      const masked = (b1 & 0x80) !== 0;
      let payloadLen = b1 & 0x7f;
      let offset = 2;

      if (payloadLen === 126) {
        if (this.buffer.length < 4) return;
        payloadLen = this.buffer.readUInt16BE(2);
        offset = 4;
      } else if (payloadLen === 127) {
        if (this.buffer.length < 10) return;
        const hi = this.buffer.readUInt32BE(2);
        const lo = this.buffer.readUInt32BE(6);
        payloadLen = hi * 0x100000000 + lo;
        offset = 10;
      }

      if (payloadLen > MAX_PAYLOAD_BYTES) {
        this.close(1009, 'Message too large');
        return;
      }

      const maskLen = masked ? 4 : 0;
      const totalLen = offset + maskLen + payloadLen;
      if (this.buffer.length < totalLen) return;

      const maskKey = masked ? this.buffer.subarray(offset, offset + 4) : null;
      const payload = Buffer.from(this.buffer.subarray(offset + maskLen, totalLen));
      this.buffer = this.buffer.subarray(totalLen);

      if (masked && maskKey) {
        for (let i = 0; i < payload.length; i += 1) {
          payload[i] ^= maskKey[i & 3];
        }
      }

      this._handleFrame(fin, opcode, payload);
      if (this.closed) return;
    }
  }

  _handleFrame(fin, opcode, payload) {
    if (opcode === 0x8) {
      this.close(1000, 'Normal closure');
      return;
    }
    if (opcode === 0x9) {
      if (!this.closed && !this.socket.destroyed) {
        this.socket.write(encodeFrame(0xA, payload));
      }
      return;
    }
    if (opcode === 0xA) {
      this.isAlive = true;
      return;
    }
    if (opcode === 0x0) {
      if (this.fragmentOpcode === null) {
        this.close(1002, 'Unexpected continuation frame');
        return;
      }
      this.fragmentChunks.push(payload);
      const total = this.fragmentChunks.reduce((acc, b) => acc + b.length, 0);
      if (total > MAX_PAYLOAD_BYTES) {
        this.close(1009, 'Fragmented message too large');
        return;
      }
      if (fin) {
        const full = Buffer.concat(this.fragmentChunks);
        const origOpcode = this.fragmentOpcode;
        this.fragmentChunks = [];
        this.fragmentOpcode = null;
        if (origOpcode === 0x1) {
          this.emit('message', full.toString('utf8'));
        }
      }
      return;
    }
    if (opcode === 0x1 || opcode === 0x2) {
      if (!fin) {
        this.fragmentOpcode = opcode;
        this.fragmentChunks = [payload];
        return;
      }
      if (opcode === 0x1) {
        this.emit('message', payload.toString('utf8'));
      }
    }
  }
}

class SimpleWebSocketServer extends EventEmitter {
  constructor(httpServer, { path = '/ws', heartbeatMs = 25000 } = {}) {
    super();
    this.path = path;
    this.clients = new Set();

    httpServer.on('upgrade', (req, socket, head) => {
      const reqPath = (req.url || '/').split('?')[0];
      if (reqPath !== this.path) {
        socket.write('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
        socket.destroy();
        return;
      }

      const key = req.headers['sec-websocket-key'];
      const upgradeHeader = String(req.headers.upgrade || '').toLowerCase();
      if (!key || upgradeHeader !== 'websocket') {
        socket.write('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
        socket.destroy();
        return;
      }

      const acceptKey = crypto
        .createHash('sha1')
        .update(key + WS_GUID)
        .digest('base64');

      const headers = [
        'HTTP/1.1 101 Switching Protocols',
        'Upgrade: websocket',
        'Connection: Upgrade',
        `Sec-WebSocket-Accept: ${acceptKey}`,
        '\r\n'
      ];
      socket.write(headers.join('\r\n'));

      const client = new WebSocketClient(socket);
      this.clients.add(client);
      client.on('close', () => {
        this.clients.delete(client);
      });

      if (head && head.length > 0) {
        client._onData(head);
      }

      this.emit('connection', client, req);
    });

    this._heartbeatTimer = setInterval(() => {
      for (const client of this.clients) {
        if (!client.isAlive) {
          client.socket.destroy();
          this.clients.delete(client);
          continue;
        }
        client.isAlive = false;
        client.ping();
      }
    }, heartbeatMs);
    this._heartbeatTimer.unref();
  }

  close() {
    clearInterval(this._heartbeatTimer);
    for (const client of this.clients) {
      client.close(1001, 'Server shutting down');
    }
    this.clients.clear();
  }
}

module.exports = {
  SimpleWebSocketServer,
  WebSocketClient
};
