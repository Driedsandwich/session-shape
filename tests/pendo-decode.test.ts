import { expect, it } from 'vitest';
import { deflateSync } from 'node:zlib';
import { decodeRequest } from '../e2e/pendo-audit';

const event = [{ type: 'track', event: '〔目印本文〕', props: { kind: 'user_file' } }];
const compressed = deflateSync(Buffer.from(JSON.stringify(event)));
const encoded = compressed.toString('base64url');
const request = { url: 'https://data.pendo.io/data/batch/test', method: 'POST', contentType: '', body: null as Buffer | null };

it('jzb の URL エンコード・base64url・zlib・UTF-8 を戻す', () => {
  expect(decodeRequest({ ...request, url: `${request.url}?jzb=${encodeURIComponent(encoded)}&name=%E7%9B%AE%E5%8D%B0` }).query).toEqual([
    { key: 'jzb', value: event }, { key: 'name', value: '目印' },
  ]);
});
it('binary の POST 本文を復号する', () => {
  expect(decodeRequest({ ...request, body: compressed }).body).toEqual(event);
});
it('JSON 内の events の圧縮本文を復号する', () => {
  expect(decodeRequest({ ...request, body: Buffer.from(JSON.stringify({ events: encoded })) }).body).toEqual({ events: event });
});
it('form の重複した jzb も捨てずに復号する', () => {
  expect(decodeRequest({ ...request, contentType: 'application/x-www-form-urlencoded', body: Buffer.from(`jzb=${encoded}&jzb=${encoded}`) }).body).toEqual([
    { key: 'jzb', value: event }, { key: 'jzb', value: event },
  ]);
});
it('非圧縮 JSON の本文も検査対象に残す', () => {
  expect(decodeRequest({ ...request, body: Buffer.from(JSON.stringify(event)) }).body).toEqual(event);
});
it('未知・壊れた符号化を黙って読み飛ばさない', () => {
  expect(() => decodeRequest({ ...request, url: `${request.url}?jzb=broken` })).toThrow();
  expect(() => decodeRequest({ ...request, body: Buffer.from('unknown encoding') })).toThrow();
});
