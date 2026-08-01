import * as assert from 'node:assert';
import { test } from 'node:test';
import { escapeInitialData, newNonce, renderWebviewHtml } from './htmlTemplate';

test('renderWebviewHtml substitutes placeholders', () => {
  const html = renderWebviewHtml('<p>{{nonce}}</p><p>{{scriptUri}}</p>', { nonce: 'abc', scriptUri: 'http://x' });
  assert.strictEqual(html, '<p>abc</p><p>http://x</p>');
});

test('renderWebviewHtml leaves unknown placeholders empty', () => {
  const html = renderWebviewHtml('<p>{{missing}}</p>', {});
  assert.strictEqual(html, '<p></p>');
});

test('escapeInitialData escapes angle brackets so JSON cannot break out of the script block', () => {
  const out = escapeInitialData({ name: '</script>' });
  assert.strictEqual(out, '{"name":"\\u003c/script>"}');
  assert.ok(!out.includes('</script>'));
});

test('newNonce returns a fresh base64 string', () => {
  const a = newNonce();
  const b = newNonce();
  assert.strictEqual(typeof a, 'string');
  assert.ok(a.length > 0);
  assert.notStrictEqual(a, b);
});
