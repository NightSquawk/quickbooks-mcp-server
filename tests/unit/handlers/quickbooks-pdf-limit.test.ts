import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import { createServer, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createRequire } from 'node:module';
import { gzipSync } from 'node:zlib';

// Test the installed vendored SDK with the real Axios HTTP adapter, using only
// a local server and dummy credentials. No production endpoints are contacted.
const require = createRequire(import.meta.url);
const QuickBooks = require('node-quickbooks');
const originalProxy = [process.env.NO_PROXY, process.env.no_proxy];

beforeEach(() => {
  process.env.NO_PROXY = '127.0.0.1';
  process.env.no_proxy = '127.0.0.1';
});
afterEach(() => {
  for (const [index, key] of ['NO_PROXY', 'no_proxy'].entries()) {
    if (originalProxy[index] === undefined) delete process.env[key];
    else process.env[key] = originalProxy[index];
  }
});

async function deadline<T>(operation: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('PDF transport did not finish or abort')), 5000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function localPdf(
  respond: (response: ServerResponse) => void,
  verify: (download: (cap?: number) => Promise<Buffer>) => Promise<void>,
) {
  const server = createServer((request, response) => {
    expect(request.url).toMatch(/^\/v3\/company\/123\/invoice\/42\/pdf\?/);
    expect(request.headers.accept).toBe('application/pdf');
    respond(response);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const client = new QuickBooks('test-key', 'test-secret', 'test-token', null, '123', true, false, 75, '2.0');
  client.endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v3/company/`;
  try {
    await verify(cap => deadline(new Promise<Buffer>((resolve, reject) => {
      client.getInvoicePdf('42', (error: Error | null, pdf: Buffer) => error ? reject(error) : resolve(pdf), cap);
    })));
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}

describe('QuickBooks PDF response limits at the HTTP adapter', () => {
  it('returns a PDF exactly at the byte cap and preserves the two-argument SDK call', async () => {
    const pdf = Buffer.from('%PDF-1.7 exact-size');
    await localPdf(response => response.end(pdf), async download => {
      await expect(download(pdf.length)).resolves.toEqual(pdf);
      await expect(download()).resolves.toEqual(pdf);
    });
  });

  it.each([false, true])('aborts before EOF when Content-Length is present: %s', async declaredLength => {
    let response: ServerResponse;
    let closePeer: () => void;
    const closed = new Promise<void>(resolve => { closePeer = resolve; });
    await localPdf(res => {
      response = res;
      res.on('close', closePeer);
      if (declaredLength) res.setHeader('Content-Length', '1000000');
      // Deliberately never finish the body. A post-buffer size check would hang.
      res.write(Buffer.alloc(1025));
    }, async download => {
      await expect(download(1024)).rejects.toThrow('maxContentLength size of 1024 exceeded');
      await deadline(closed);
      expect(response.writableEnded).toBe(false);
      expect(response.destroyed).toBe(true);
    });
  });

  it('counts decompressed bytes and aborts a small compressed response before HTTP EOF', async () => {
    const compressed = gzipSync(Buffer.alloc(4096));
    expect(compressed.length).toBeLessThan(128);
    let closePeer: () => void;
    const closed = new Promise<void>(resolve => { closePeer = resolve; });
    await localPdf(response => {
      response.setHeader('Content-Encoding', 'gzip');
      response.on('close', closePeer);
      response.write(compressed);
    }, async download => {
      await expect(download(128)).rejects.toThrow('maxContentLength size of 128 exceeded');
      await deadline(closed);
    });
  });

  it('retains HTTP failure handling', async () => {
    await localPdf(response => {
      response.statusCode = 404;
      response.end('missing');
    }, async download => {
      await expect(download(1024)).rejects.toThrow('Request failed with status code 404');
    });
  });

  it.each([0, -1, 1.5, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid cap %s before creating an HTTP request', async cap => {
      const client = new QuickBooks('test-key', 'test-secret', 'test-token', null, '123', true, false, 75, '2.0');
      // Any accidental request fails URL parsing rather than reaching the network.
      client.endpoint = 'invalid:';
      await expect(new Promise((resolve, reject) => {
        client.getInvoicePdf('42', (error: Error | null, pdf: Buffer) => error ? reject(error) : resolve(pdf), cap);
      })).rejects.toThrow('PDF maxContentLength must be a positive safe integer');
    },
  );
});
