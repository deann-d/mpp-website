'use strict';

const assert = require('assert');
const path = require('path');
const renderer = require(path.resolve(__dirname, '..', 'public', 'assets', 'dashboard-render.js'));

const htmlWrites = [];

class Element {
  constructor(tagName) {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.parentNode = null;
    this.style = {};
    this.className = '';
    this._textContent = '';
  }

  set textContent(value) {
    this._textContent = String(value);
    this.children = [];
  }

  get textContent() {
    return this._textContent + this.children.map(child => child.textContent).join('');
  }

  appendChild(child) {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  set innerHTML(value) {
    htmlWrites.push({ property: 'innerHTML', value: String(value), element: this });
    this._textContent = '';
    this.children = [];
    const suspicious = String(value).match(/<(img|script|svg|b)\b/i);
    if (suspicious) this.appendChild(new Element(suspicious[1]));
  }

  get innerHTML() {
    return '';
  }

  set outerHTML(value) {
    htmlWrites.push({ property: 'outerHTML', value: String(value), element: this });
  }

  get outerHTML() {
    return '';
  }

  insertAdjacentHTML(position, value) {
    htmlWrites.push({ property: 'insertAdjacentHTML', position, value: String(value), element: this });
    const suspicious = String(value).match(/<(img|script|svg|b)\b/i);
    if (suspicious) this.appendChild(new Element(suspicious[1]));
  }
}

global.document = {
  createElement(tagName) {
    return new Element(tagName);
  }
};

const payload = {
  nama: '<img src=x onerror="globalThis.__xss = true">',
  program: '<script>globalThis.__xss = true</script>',
  status: '<b onclick="globalThis.__xss = true">Status</b>',
  tanggal: '<svg onload="globalThis.__xss = true">',
  nilai: 100000
};

function collectElements(node, found = []) {
  found.push(node);
  node.children.forEach(child => collectElements(child, found));
  return found;
}

function assertSafeOutput(row, writes) {
  assert.strictEqual(writes.length, 0, 'renderer menulis HTML mentah');
  const elements = collectElements(row);
  assert(!elements.some(element => ['IMG', 'SCRIPT', 'SVG', 'B'].includes(element.tagName)),
    'terbentuk elemen berbahaya');
  assert.strictEqual(row.children[0].textContent, payload.tanggal);
  assert.strictEqual(row.children[1].textContent, payload.nama);
  assert.strictEqual(row.children[2].textContent, payload.program);
  assert.strictEqual(row.children[3].textContent, payload.status);
  const badgeClasses = row.children[3].children[0].className.split(/\s+/).filter(Boolean);
  assert.deepStrictEqual(badgeClasses, ['badge', 'proses']);
  assert(!globalThis.__xss, 'payload menjalankan skrip');
}

function runAssertion(render) {
  htmlWrites.length = 0;
  delete globalThis.__xss;
  const row = render();
  assertSafeOutput(row, htmlWrites);
}

console.log('\n=== TEST RENDERER DASHBOARD ===\n');
runAssertion(() => renderer.buildTransactionRow(payload, value => 'Rp ' + value));
console.log('  [OK] payload tampil sebagai teks, tanpa elemen berbahaya atau skrip');
console.log('  [OK] tidak ada penulisan innerHTML, outerHTML, atau insertAdjacentHTML');

const vulnerableRender = function () {
  const row = document.createElement('tr');
  row.innerHTML = '<td>' + payload.nama + '</td>';
  return row;
};
assert.throws(() => runAssertion(vulnerableRender), /renderer menulis HTML mentah|terbentuk elemen berbahaya/);
assert(htmlWrites.some(write => write.property === 'innerHTML'), 'kontrol negatif tidak tercatat menulis innerHTML');
console.log('  [OK] kontrol negatif rentan terdeteksi oleh assertion keamanan');

for (const [status, expected] of [
  ['Terverifikasi', 'verified'],
  ['Menunggu Verifikasi', 'pending'],
  ['status tak dikenal', 'proses']
]) {
  assert(['verified', 'pending', 'proses'].includes(renderer.badgeClassFor(status)));
  assert.strictEqual(renderer.badgeClassFor(status), expected);
}
console.log('  [OK] kelas badge hanya berasal dari whitelist');
console.log('\n=== HASIL: seluruh test dashboard lulus ===\n');
