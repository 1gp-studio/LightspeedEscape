// Minimal DOM shim for headless UI tests (ui-screens). Enough of document/Element for G.dom.h, G.UI and the
// overlay screens: element tree, attributes, classList, style, events (bubbling click), simple selectors.
// innerHTML is stored as a string only (not parsed). Layout queries return zeros.
//   import { loadUI } from './dom-shim.mjs';
//   const { G, document, click, find, findAll, text } = loadUI();
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { ROOT, scriptList } from './load.mjs';

class Node {
  constructor(doc) { this.ownerDocument = doc; this.parentNode = null; this.childNodes = []; }
  get firstChild() { return this.childNodes[0] || null; }
  get lastChild() { return this.childNodes[this.childNodes.length - 1] || null; }
  appendChild(c) {
    if (c.parentNode) c.parentNode.removeChild(c);
    c.parentNode = this; this.childNodes.push(c); return c;
  }
  insertBefore(c, ref) {
    if (!ref) return this.appendChild(c);
    if (c.parentNode) c.parentNode.removeChild(c);
    const i = this.childNodes.indexOf(ref);
    c.parentNode = this; this.childNodes.splice(i < 0 ? this.childNodes.length : i, 0, c); return c;
  }
  removeChild(c) {
    const i = this.childNodes.indexOf(c);
    if (i >= 0) this.childNodes.splice(i, 1);
    c.parentNode = null; return c;
  }
  get textContent() { return this.childNodes.map((c) => c.textContent).join(''); }
  set textContent(v) { this.childNodes.forEach((c) => { c.parentNode = null; }); this.childNodes = []; if (v !== '') this.appendChild(new Text(this.ownerDocument, String(v))); }
}
class Text extends Node {
  constructor(doc, v) { super(doc); this.nodeType = 3; this.nodeValue = v; }
  get textContent() { return this.nodeValue; }
  set textContent(v) { this.nodeValue = String(v); }
}
class ClassList {
  constructor(el) { this.el = el; }
  _get() { return (this.el.className || '').split(/\s+/).filter(Boolean); }
  add(...c) { const s = this._get(); c.forEach((x) => { if (!s.includes(x)) s.push(x); }); this.el.className = s.join(' '); }
  remove(...c) { this.el.className = this._get().filter((x) => !c.includes(x)).join(' '); }
  contains(c) { return this._get().includes(c); }
  toggle(c, on) { const has = this.contains(c); if (on === undefined ? !has : on) this.add(c); else this.remove(c); return !has; }
}
class Element extends Node {
  constructor(doc, tag) {
    super(doc);
    this.nodeType = 1; this.tagName = tag.toUpperCase(); this.className = ''; this.attrs = {}; this.dataset = {};
    this.listeners = {}; this.hidden = false; this.disabled = false; this.scrollTop = 0; this._html = '';
    const st = {}; st.setProperty = (k, v) => { st[k] = v; }; st.cssText = '';
    this.style = st; this.classList = new ClassList(this);
  }
  get children() { return this.childNodes.filter((c) => c.nodeType === 1); }
  set innerHTML(v) { this.textContent = ''; this._html = String(v); }
  get innerHTML() { return this._html; }
  setAttribute(k, v) { this.attrs[k] = String(v); if (k === 'disabled') this.disabled = true; if (k === 'class') this.className = String(v); }
  getAttribute(k) { if (k === 'class') return this.className; if (k.startsWith('data-')) { const d = this.dataset[k.slice(5)]; if (d != null) return d; } return k in this.attrs ? this.attrs[k] : null; }
  removeAttribute(k) { delete this.attrs[k]; if (k === 'disabled') this.disabled = false; }
  hasAttribute(k) { return k in this.attrs; }
  addEventListener(t, fn) { (this.listeners[t] || (this.listeners[t] = [])).push(fn); }
  removeEventListener(t, fn) { const l = this.listeners[t]; if (l) { const i = l.indexOf(fn); if (i >= 0) l.splice(i, 1); } }
  dispatchEvent(ev) {
    ev.target = ev.target || this;
    for (let n = this; n; n = n.parentNode) {
      ev.currentTarget = n;
      ((n.listeners && n.listeners[ev.type]) || []).slice().forEach((fn) => fn.call(n, ev));
      if (ev._stop || !ev.bubbles) break;
    }
    return true;
  }
  click() {
    if (this.disabled) return;
    this.dispatchEvent({ type: 'click', bubbles: true, preventDefault() {}, stopPropagation() { this._stop = true; } });
  }
  getBoundingClientRect() { return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 }; }
  get offsetHeight() { return 0; }
  getContext() { return null; }
  matches(sel) { return matchCompound(this, sel); }
  closest(sel) { for (let n = this; n && n.nodeType === 1; n = n.parentNode) if (n.matches(sel)) return n; return null; }
  querySelectorAll(sel) {
    const out = [];
    const parts = sel.trim().split(/\s+/);
    const walk = (n) => {
      n.children.forEach((c) => {
        if (matchChain(c, parts, this)) out.push(c);
        walk(c);
      });
    };
    walk(this);
    return out;
  }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
}
function matchCompound(el, sel) {
  const m = sel.match(/^([a-zA-Z0-9]*)((?:\.[\w-]+)*)((?:\[[^\]]+\])*)$/);
  if (!m) throw new Error('dom-shim: unsupported selector ' + sel);
  if (m[1] && el.tagName !== m[1].toUpperCase()) return false;
  const cls = m[2] ? m[2].slice(1).split('.') : [];
  if (!cls.every((c) => el.classList.contains(c))) return false;
  const attrs = m[3] ? m[3].slice(1, -1).split('][') : [];
  return attrs.every((a) => {
    const [k, v] = a.split('=');
    const val = el.getAttribute(k);
    return v == null ? val != null : val === v.replace(/^"|"$/g, '');
  });
}
function matchChain(el, parts, root) {
  if (!matchCompound(el, parts[parts.length - 1])) return false;
  let i = parts.length - 2;
  for (let n = el.parentNode; i >= 0 && n && n !== root.parentNode; n = n.parentNode) {
    if (n.nodeType === 1 && matchCompound(n, parts[i])) i--;
  }
  return i < 0;
}
class Document extends Element {
  constructor() { super(null, '#document'); this.ownerDocument = this; }
  createElement(t) { return new Element(this, t); }
  createTextNode(v) { return new Text(this, v); }
  getElementById(id) { return this.querySelector('[id=' + id + ']'); }
}

export function loadUI() {
  const document = new Document();
  const body = document.appendChild(document.createElement('body'));
  ['overlays', 'toasts', 'view'].forEach((id) => { const d = document.createElement('div'); d.setAttribute('id', id); body.appendChild(d); });
  const store = {};
  const sandbox = {
    console, document, setTimeout: () => 0, clearTimeout: () => {},
    requestAnimationFrame: () => 0, cancelAnimationFrame: () => {},
    addEventListener: () => {}, removeEventListener: () => {},
    matchMedia: () => ({ matches: false }), devicePixelRatio: 1,
    localStorage: {
      getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; },
    },
    navigator: {},
  };
  const ctx = vm.createContext(sandbox);
  const files = scriptList(['core', 'data', 'sim']).concat(
    ['src/ui/dom.js', 'src/ui/audio.js'],
    scriptList(['ui']).filter((f) => f.startsWith('src/ui/screens/')));
  for (const rel of files) vm.runInContext(fs.readFileSync(path.join(ROOT, rel), 'utf8'), ctx, { filename: rel });
  const G = ctx.G;
  const all = (sel) => document.querySelectorAll(sel);
  const text = (el) => (el ? el.textContent : '');
  // first element matching `sel` whose text contains `needle`
  const find = (sel, needle) => all(sel).find((e) => needle == null || text(e).includes(needle)) || null;
  const click = (sel, needle) => {
    const el = find(sel, needle);
    if (!el) throw new Error('no element ' + sel + (needle ? ' "' + needle + '"' : '') + '; open: ' + G.UI.stack.map((e) => e.name).join(','));
    el.click();
    return el;
  };
  return { G, win: sandbox, document, store, all, find, click, text };
}
