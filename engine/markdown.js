// A small Markdown renderer whose output matches Python-Markdown 3 with the extensions `tables`,
// `footnotes` (UNIQUE_IDS, empty BACKLINK_TEXT) and `sane_lists`, as familychronicle/chronicles.py
// uses it, for the constructs the chronicles use (headings, paragraphs, emphasis, links, lists,
// tables, footnotes, block quotes, code, horizontal rules, HTML comments). It follows the same
// stages: raw HTML extraction, block processors in Python-Markdown's priority order, footnotes,
// inline patterns in their order, prettifying and serialising.
//
// Unlike Python-Markdown it lets no raw HTML through except comments and the blocks the build
// itself inserts (<div> anchors and <figure> images at the start of a line); any other tag is
// escaped and shown as text.
(function (g) {
  'use strict';

  const TAB = 4;
  const STX = '\u0002', ETX = '\u0003';
  const placeholder = (i) => `${STX}wzxhzdk:${i}${ETX}`;
  const PLACEHOLDER_RE = /\u0002wzxhzdk:(\d+)\u0003/g;
  const INLINE = '';                    // inline placeholders: INLINE + index + INLINE_END
  const INLINE_END = '';
  const NBSP_MARK = '';                 // "&#160;" before the footnote backlinks
  const RAW_TAGS = new Set(['div', 'figure']);
  const BLOCK_LEVEL = new Set(['address', 'article', 'aside', 'blockquote', 'details', 'div', 'dl', 'fieldset',
    'figcaption', 'figure', 'footer', 'form', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hgroup', 'hr', 'main',
    'menu', 'nav', 'ol', 'p', 'pre', 'section', 'table', 'ul', 'canvas', 'colgroup', 'dd', 'body', 'dt', 'group',
    'html', 'iframe', 'li', 'legend', 'math', 'map', 'noscript', 'output', 'object', 'option', 'progress', 'script',
    'style', 'summary', 'tbody', 'td', 'textarea', 'tfoot', 'th', 'thead', 'tr', 'video', 'center']);
  const VOID = new Set(['area', 'base', 'basefont', 'br', 'col', 'frame', 'hr', 'img', 'input', 'isindex', 'link', 'meta', 'param']);
  const W = '[\\p{L}\\p{N}_]';               // Python \w

  const escapeText = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const escapeAttr = (s) => escapeText(s).replace(/"/g, '&quot;').replace(/\n/g, '&#10;');

  // --- tree --------------------------------------------------------------------------------------
  const el = (tag, attrs = []) => ({ tag, attrs, text: '', tail: '', children: [], atomic: false });
  const sub = (parent, tag, attrs) => { const e = el(tag, attrs); parent.children.push(e); return e; };
  const last = (parent) => (parent.children.length ? parent.children[parent.children.length - 1] : null);

  // --- raw HTML extraction (Python-Markdown's HTMLExtractor, reduced) -------------------------------
  function extractHtml(text, stash) {
    const out = [];
    let inraw = false, intail = false, stack = [], cache = [];
    const store = (html) => { stash.push(html); return placeholder(stash.length - 1); };
    const atLineStart = (pos) => {
      const start = text.lastIndexOf('\n', pos - 1) + 1;
      const col = pos - start;
      return col === 0 || (col <= 3 && text.slice(start, pos).trim() === '');
    };
    const blankAfter = (pos) => /^([ ]*\n){2}/.test(text.slice(pos));
    const data = (s) => {
      if (intail && s.includes('\n')) intail = false;
      if (inraw) cache.push(s); else out.push(s);
    };
    const emptyTag = (s, pos, end, isBlock) => {
      if (inraw || intail) { cache.push(s); return; }
      if (atLineStart(pos) && isBlock) {
        if (blankAfter(end)) s += '\n'; else intail = true;
        const item = out.length ? out[out.length - 1] : '';
        if (!item.endsWith('\n\n') && item.endsWith('\n')) out.push('\n');
        out.push(store(s));
        out.push('\n\n');
      } else {
        out.push(s);
      }
    };
    const START = /<([a-zA-Z][^\t\n\r\f />\x00]*)(?:[^>"']|"[^"]*"|'[^']*')*>/y;
    const END = /<\/([a-zA-Z][^\t\n\r\f />\x00]*)\s*>/y;
    let i = 0;
    while (i < text.length) {
      const j = text.indexOf('<', i);
      if (j < 0) { data(text.slice(i)); break; }
      if (j > i) data(text.slice(i, j));
      i = j;
      if (text.startsWith('<!--', i)) {
        const close = /--!?>/g; close.lastIndex = i + 4;
        const m = close.exec(text);
        if (!m) { data('<'); i += 1; continue; }
        emptyTag('<!--' + text.slice(i + 4, m.index) + '-->', i, m.index + m[0].length, true);
        i = m.index + m[0].length;
        continue;
      }
      START.lastIndex = i;
      let m = START.exec(text);
      if (m) {
        const tag = m[1].toLowerCase(), s = m[0], end = i + s.length;
        if (!inraw && RAW_TAGS.has(tag) && (intail || atLineStart(i)) && !s.endsWith('/>')) {
          inraw = true;
          out.push('\n');
        }
        if (inraw) { if (!s.endsWith('/>')) stack.push(tag); cache.push(s); } else data(s);
        i = end;
        continue;
      }
      END.lastIndex = i;
      m = END.exec(text);
      if (m && inraw) {
        const tag = m[1].toLowerCase(), end = i + m[0].length;
        cache.push(m[0]);
        if (stack.includes(tag)) while (stack.length) if (stack.pop() === tag) break;
        if (!stack.length) {
          if (blankAfter(end)) cache.push('\n'); else intail = true;
          inraw = false;
          out.push(store(cache.join('')));
          out.push('\n\n');
          cache = [];
        }
        i = end;
        continue;
      }
      data('<');
      i += 1;
    }
    if (cache.length) out.push(store(cache.join('')));
    return out.join('');
  }

  // --- block parser -------------------------------------------------------------------------------------
  function Parser() {
    this.state = [];
    this.footnotes = new Map();   // id -> text, in definition order
  }
  Parser.prototype.isState = function (s) { return this.state.length > 0 && this.state[this.state.length - 1] === s; };
  Parser.prototype.parseChunk = function (parent, text) { this.parseBlocks(parent, text.split('\n\n')); };
  Parser.prototype.parseBlocks = function (parent, blocks) {
    while (blocks.length) {
      for (const p of PROCESSORS) {
        if (p.test.call(this, parent, blocks[0]) && p.run.call(this, parent, blocks) !== false) break;
      }
    }
  };

  function detab(text, length = TAB) {
    const lines = text.split('\n'), out = [];
    for (const line of lines) {
      if (line.startsWith(' '.repeat(length))) out.push(line.slice(length));
      else if (!line.trim()) out.push('');
      else break;
    }
    return [out.join('\n'), lines.slice(out.length).join('\n')];
  }
  const looseDetab = (text, level = 1) => text.split('\n').map((l) => (l.startsWith(' '.repeat(TAB * level)) ? l.slice(TAB * level) : l)).join('\n');

  const HASH = /(?:^|\n)(#{1,6})((?:\\.|[^\\])*?)#*(?:\n|$)/;
  const SETEXT = /^.*?\n[=-]+[ ]*(\n|$)/m;
  const HR = /^[ ]{0,3}(?=((-+[ ]{0,2}){3,}|(_+[ ]{0,2}){3,}|(\*+[ ]{0,2}){3,}))\1[ ]*$/m;
  const QUOTE = /(^|\n)[ ]{0,3}>[ ]?(.*)/;
  const FOOTNOTE = /^[ ]{0,3}\[\^([^\]]*)\]:[ ]*(.*)$/m;
  const LISTS = {
    ol: { tag: 'ol', RE: /^[ ]{0,3}\d+\.[ ]+(.*)/, CHILD: /^[ ]{0,3}((\d+\.))[ ]+(.*)/ },
    ul: { tag: 'ul', RE: /^[ ]{0,3}[*+-][ ]+(.*)/, CHILD: /^[ ]{0,3}(([*+-]))[ ]+(.*)/ },
  };
  const LIST_INDENT = /^[ ]{4,7}((\d+\.)|[*+-])[ ]+.*/;

  function listProcessor(kind) {
    const L = LISTS[kind];
    return {
      test(parent, block) { return L.RE.test(block); },
      run(parent, blocks) {
        let start = '1';
        const items = [];
        for (const line of blocks.shift().split('\n')) {
          const m = L.CHILD.exec(line);
          if (m) {
            if (!items.length && kind === 'ol') start = /(\d+)/.exec(m[1])[1];
            items.push(m[3]);
          } else if (LIST_INDENT.test(line)) {
            if (items[items.length - 1].startsWith(' '.repeat(TAB))) items[items.length - 1] += '\n' + line;
            else items.push(line);
          } else {
            items[items.length - 1] += '\n' + line;
          }
        }
        const sibling = last(parent);
        let lst;
        if (sibling && sibling.tag === L.tag) {
          lst = sibling;
          const li = last(lst);
          if (li.text) { const p = el('p'); p.text = li.text; li.text = ''; li.children.unshift(p); }
          const lch = last(li);
          if (lch && lch.tail) { const p = sub(li, 'p'); p.text = lch.tail.replace(/^\s+/, ''); lch.tail = ''; }
          const nli = sub(lst, 'li');
          this.state.push('looselist');
          this.parseBlocks(nli, [items.shift()]);
          this.state.pop();
        } else if (parent.tag === 'ol' || parent.tag === 'ul') {
          lst = parent;
        } else {
          lst = sub(parent, L.tag, start !== '1' ? [['start', start]] : []);
        }
        this.state.push('list');
        for (const item of items) {
          if (item.startsWith(' '.repeat(TAB))) this.parseBlocks(last(lst), [item]);
          else this.parseBlocks(sub(lst, 'li'), [item]);
        }
        this.state.pop();
      },
    };
  }

  function splitRow(row, border) {
    if (border) {
      if (row.startsWith('|')) row = row.slice(1);
      row = row.replace(/(?<!\\)(?:\\\\)*\|$/, '');
    }
    // split on pipes that are neither escaped nor inside a code span
    const cells = [];
    let cur = '', code = 0;
    for (let i = 0; i < row.length; i++) {
      const c = row[i];
      if (c === '\\' && i + 1 < row.length) { cur += c + row[i + 1]; i++; continue; }
      if (c === '`') { let n = 1; while (row[i + n] === '`') n++; const close = row.indexOf('`'.repeat(n), i + n); if (code === 0 && close > 0) { cur += row.slice(i, close + n); i = close + n - 1; continue; } }
      if (c === '|') { cells.push(cur); cur = ''; continue; }
      cur += c;
    }
    cells.push(cur);
    return cells;
  }

  const PROCESSORS = [
    { // empty
      test(parent, block) { return !block || block.startsWith('\n'); },
      run(parent, blocks) {
        const block = blocks.shift();
        let filler = '\n\n';
        if (block) { filler = '\n'; const rest = block.slice(1); if (rest) blocks.unshift(rest); }
        const sibling = last(parent);
        if (sibling && sibling.tag === 'pre' && sibling.children.length && sibling.children[0].tag === 'code') sibling.children[0].text += filler;
      },
    },
    { // list indent
      test(parent, block) {
        const lc = last(parent);
        return block.startsWith(' '.repeat(TAB)) && !this.isState('detabbed')
          && (parent.tag === 'li' || (lc !== null && (lc.tag === 'ul' || lc.tag === 'ol')));
      },
      run(parent, blocks) {
        let block = blocks.shift();
        const m = /^(([ ]{4})+)/.exec(block);
        const indent = m ? m[1].length / TAB : 0;
        let level = this.isState('list') ? 1 : 0;
        let sibling = parent;
        while (indent > level) {
          const child = last(sibling);
          if (child && ['ul', 'ol', 'li'].includes(child.tag)) { if (child.tag !== 'li') level += 1; sibling = child; } else break;
        }
        block = looseDetab(block, level);
        this.state.push('detabbed');
        if (parent.tag === 'li') {
          const lc = last(parent);
          this.parseBlocks(lc && (lc.tag === 'ul' || lc.tag === 'ol') ? lc : parent, [block]);
        } else if (sibling.tag === 'li') {
          this.parseBlocks(sibling, [block]);
        } else if (sibling.children.length && last(sibling).tag === 'li') {
          const li = last(sibling);
          if (li.text) { const p = el('p'); p.text = li.text; li.text = ''; li.children.unshift(p); }
          this.parseChunk(li, block);
        } else {
          this.parseBlocks(sub(sibling, 'li'), [block]);
        }
        this.state.pop();
      },
    },
    { // code
      test(parent, block) { return block.startsWith(' '.repeat(TAB)); },
      run(parent, blocks) {
        const sibling = last(parent);
        const [block, rest] = detab(blocks.shift());
        if (sibling && sibling.tag === 'pre' && sibling.children.length && sibling.children[0].tag === 'code') {
          const code = sibling.children[0];
          code.text = `${code.text}\n${escapeText(block.replace(/\s+$/, ''))}\n`;
        } else {
          const code = sub(sub(parent, 'pre'), 'code');
          code.atomic = true;
          code.text = escapeText(block.replace(/\s+$/, '')) + '\n';
        }
        if (rest) blocks.unshift(rest);
      },
    },
    { // table
      test(parent, block) {
        const rows = block.split('\n').map((r) => r.replace(/^ +| +$/g, ''));
        if (rows.length < 2) return false;
        const border = rows[0].startsWith('|') || /(?<!\\)(?:\\\\)*\|$/.test(rows[0]);
        const head = splitRow(rows[0], border);
        if (head.length < 2) return false;
        const sep = splitRow(rows[1], border);
        if (sep.length !== head.length || !/^[|:\- ]*$/.test(sep.join(''))) return false;
        this._table = { border, sep };
        return true;
      },
      run(parent, blocks) {
        const { border, sep } = this._table;
        const lines = blocks.shift().split('\n');
        const rows = lines.length < 3 ? [] : lines.slice(2);
        const align = sep.map((c) => { c = c.replace(/^ +| +$/g, ''); return c.startsWith(':') && c.endsWith(':') ? 'center' : c.startsWith(':') ? 'left' : c.endsWith(':') ? 'right' : null; });
        const table = sub(parent, 'table');
        const build = (row, section) => {
          const tr = sub(section, 'tr');
          const cells = splitRow(row, border);
          align.forEach((a, i) => {
            const c = sub(tr, section.tag === 'thead' ? 'th' : 'td', a ? [['style', `text-align: ${a};`]] : []);
            c.text = i < cells.length ? cells[i].replace(/^ +| +$/g, '') : '';
          });
        };
        build(lines[0].replace(/^ +| +$/g, ''), sub(table, 'thead'));
        const tbody = sub(table, 'tbody');
        if (!rows.length) build('', tbody);
        for (const r of rows) build(r.replace(/^ +| +$/g, ''), tbody);
      },
    },
    { // hash header
      test(parent, block) { return HASH.test(block); },
      run(parent, blocks) {
        const block = blocks.shift();
        const m = HASH.exec(block);
        const before = block.slice(0, m.index), after = block.slice(m.index + m[0].length);
        if (before) this.parseBlocks(parent, [before]);
        sub(parent, 'h' + m[1].length).text = m[2].trim();
        if (after) blocks.unshift(after);
      },
    },
    { // setext header
      test(parent, block) { return SETEXT.exec(block) !== null && SETEXT.exec(block).index === 0; },
      run(parent, blocks) {
        const lines = blocks.shift().split('\n');
        sub(parent, lines[1].startsWith('=') ? 'h1' : 'h2').text = lines[0].trim();
        if (lines.length > 2) blocks.unshift(lines.slice(2).join('\n'));
      },
    },
    { // horizontal rule
      test(parent, block) { return HR.test(block); },
      run(parent, blocks) {
        const block = blocks.shift();
        const m = HR.exec(block);
        const pre = block.slice(0, m.index).replace(/\n+$/, '');
        if (pre) this.parseBlocks(parent, [pre]);
        sub(parent, 'hr');
        const post = block.slice(m.index + m[0].length).replace(/^\n+/, '');
        if (post) blocks.unshift(post);
      },
    },
    listProcessor('ol'),
    listProcessor('ul'),
    { // block quote
      test(parent, block) { return QUOTE.test(block); },
      run(parent, blocks) {
        let block = blocks.shift();
        const m = QUOTE.exec(block);
        if (m) {
          this.parseBlocks(parent, [block.slice(0, m.index)]);
          block = block.slice(m.index).split('\n').map((line) => {
            const q = /(^|\n)[ ]{0,3}>[ ]?(.*)/.exec(line);
            return line.trim() === '>' ? '' : q && q.index === 0 ? q[2] : line;
          }).join('\n');
        }
        const sibling = last(parent);
        const quote = sibling && sibling.tag === 'blockquote' ? sibling : sub(parent, 'blockquote');
        this.state.push('blockquote');
        this.parseChunk(quote, block);
        this.state.pop();
      },
    },
    { // footnote definition
      test() { return true; },
      run(parent, blocks) {
        const block = blocks.shift();
        const RE = new RegExp(FOOTNOTE.source, 'gm');
        let m = RE.exec(block);
        if (!m) { blocks.unshift(block); return false; }
        const preceding = block.slice(0, m.index);
        // consecutive one-line definitions
        for (;;) {
          RE.lastIndex = m.index + m[0].length;
          const m2 = RE.exec(block);
          if (!m2 || block.slice(m.index + m[0].length, m2.index).replace(/^\n+|\n+$/g, '')) break;
          this.footnotes.set(m[1], m[2].replace(/\s+$/, ''));
          m = m2;
        }
        const id = m[1];
        const parts = [m[2]];
        const rest = block.slice(m.index + m[0].length).replace(/^\n+/, '');
        const m3 = FOOTNOTE.exec(rest);
        if (m3) {
          const before = rest.slice(0, m3.index).replace(/\n+$/, '');
          parts[0] = [parts[0], looseDetab(before)].join('\n').replace(/^\n+/, '');
          blocks.unshift(rest.slice(m3.index));
        } else {
          parts[0] = [parts[0], looseDetab(rest)].join('\n').replace(/^\n+|\n+$/g, '');
          while (blocks.length && blocks[0].startsWith(' '.repeat(TAB))) {
            const b = blocks.shift();
            const m4 = FOOTNOTE.exec(b);
            if (m4) { parts.push(looseDetab(b.slice(0, m4.index).replace(/\n+$/, ''))); blocks.unshift(b.slice(m4.index)); break; }
            parts.push(looseDetab(b));
          }
        }
        this.footnotes.set(id, parts.join('\n\n').replace(/\s+$/, ''));
        if (preceding.trim()) blocks.unshift(preceding.replace(/\n+$/, ''));
        return true;
      },
    },
    { // paragraph
      test() { return true; },
      run(parent, blocks) {
        const block = blocks.shift();
        if (!block.trim()) return;
        if (this.isState('list')) {
          const sibling = last(parent);
          if (sibling) sibling.tail = sibling.tail ? `${sibling.tail}\n${block}` : `\n${block}`;
          else parent.text = parent.text ? `${parent.text}\n${block}` : block.replace(/^\s+/, '');
        } else {
          sub(parent, 'p').text = block.replace(/^\s+/, '');
        }
      },
    },
  ];

  // --- inline ---------------------------------------------------------------------------------------
  const ESCAPED = '\\`*_{}[]()>#+-.!';

  function Inline(footnotes) {
    this.footnotes = footnotes;          // Map id -> text (definition order)
    this.refs = new Map();               // id -> number of references found
    this.tokens = [];
  }
  Inline.prototype.token = function (html) { this.tokens.push(html); return INLINE + (this.tokens.length - 1) + INLINE_END; };
  Inline.prototype.resolve = function (s) {
    let prev;
    do { prev = s; s = s.replace(/(\d+)/g, (_, i) => this.tokens[+i]); } while (s !== prev);
    return s;
  };

  // Text -> HTML, running the inline patterns in Python-Markdown's order from `from` on.
  Inline.prototype.render = function (s, from = 0) {
    for (let k = from; k < PATTERNS.length; k++) s = PATTERNS[k].call(this, s, k);
    // the rest is plain text
    return s.split(/(\d+|\u0002wzxhzdk:\d+\u0003)/).map((part, i) => (i % 2 ? part : escapeText(part))).join('');
  };

  function findClosing(s, i, open, close) {
    let depth = 0;
    for (let j = i; j < s.length; j++) {
      if (s[j] === '\\') { j++; continue; }
      if (s[j] === open) depth++;
      else if (s[j] === close) { depth--; if (depth === 0) return j; }
    }
    return -1;
  }

  // Emphasis: a port of Python-Markdown 3.11's DelimiterProcessor (`*` plain, `_` "smart").
  const SP = '[\\t\\n\\v\\f\\r \\x1c-\\x1f\\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000]';
  function boundary(token) {
    const e = token === '*' ? '\\*' : '_';
    const wordOrTok = `[\\p{L}\\p{N}_${e}]`;
    const xstart = token !== '_' ? `(?:(?<=_)|(?<!${wordOrTok}))` : `(?<!${wordOrTok})`;
    const xend = token !== '_' ? `(?:(?=_)|(?!${wordOrTok}))` : `(?!${wordOrTok})`;
    const notStart = '(?<=[\\s\\S])';
    const notEnd = '(?!\\n?$)';
    const ns = `(?<!${SP.slice(0, -1)}${e}])`, na = `(?!${SP.slice(0, -1)}${e}])`;
    const src = token === '_'
      ? `(?<ambiguous>${notStart}${ns}${xstart}${e}+${xend}${na}${notEnd})|(?<end>${notStart}${ns}${e}+${xend})|(?<start>${xstart}${e}+${na}${notEnd})`
      : `(?<ambiguous>${notStart}${ns}${e}+${na}${notEnd})|(?<end>${notStart}${ns}${e}+)|(?<start>${e}+${na}${notEnd})`;
    return new RegExp(src, 'uy');
  }
  const DELIMS = ['*', '_'].map((token) => ({ token, re: boundary(token), stack: [] }));
  const DELIM = new Map(DELIMS.map((d) => [d.token, d]));
  const TAGS = ['strong', 'em'];
  const MAX_SIZE = 2;

  function bmatch(d, data, i) {
    d.re.lastIndex = i;
    const m = d.re.exec(data);
    if (!m) return null;
    const group = m.groups.ambiguous !== undefined ? 'ambiguous' : m.groups.end !== undefined ? 'end' : 'start';
    return { start: m.index, end: m.index + m[0].length, text: m[0], group };
  }
  const ruleOf3 = (o, c) => (o + c) % 3 === 0 && (o % 3 !== 0 || c % 3 !== 0);

  // Pair delimiters starting with the opener at `pos`. Returns {regions, unpaired}.
  function analyse(data, pos) {
    for (const d of DELIMS) d.stack.length = 0;
    const regions = [];
    const others = (delim) => DELIMS.some((d) => d !== delim && d.stack.length);
    const addRegion = (a, b, c, dd, size) => {
      regions.push([a, b, c, dd, size]);
      for (const d of DELIMS) {
        while (d.stack.length) {
          const p = d.stack[d.stack.length - 1][0];
          if (Math.max(p, a) <= Math.min(p, dd - 1)) { d.stack.pop(); continue; }
          break;
        }
      }
    };
    const search = (start) => {
      for (let i = start; i < data.length; i++) {
        const d = DELIM.get(data[i]);
        if (!d) continue;
        const m = bmatch(d, data, i);
        if (m) { if (!d.stack.length && m.group === 'end') continue; return m; }
      }
      return null;
    };
    const first = DELIM.get(data[pos]);
    const m0 = bmatch(first, data, pos);
    if (m0 === null || m0.group === 'end') {
      if (m0 === null) { let e = pos; while (data[e] === first.token) e++; return { skip: [pos, e] }; }
      return { skip: [m0.start, m0.end] };
    }
    let end = m0.end;
    first.stack.push([m0.start, m0.end, m0.group !== 'start', m0.end - m0.start, m0.end - m0.start]);
    while (DELIMS.some((d) => d.stack.length)) {
      const m2 = search(end);
      if (m2 === null) break;
      const delim = DELIM.get(data[m2.start]);
      const stack = delim.stack;
      let start = m2.start;
      end = m2.end;
      let current = m2.end - m2.start;
      let isStart = m2.group !== 'end';
      let isEnd = !isStart || m2.group !== 'start';
      const isAmbiguous = isStart && isEnd;
      let lastLen = stack.length ? stack[stack.length - 1][4] : 0;
      if (stack.length && isAmbiguous && current !== lastLen && ruleOf3(stack[stack.length - 1][3], current)) {
        for (let i = stack.length - 2; i >= 0; i--) {
          if (stack[i][4] === current && !ruleOf3(stack[i][3], current)) { lastLen = current; break; }
        }
      }
      if (stack.length && isEnd && ((current > lastLen && (!isAmbiguous || !ruleOf3(stack[stack.length - 1][3], current)))
        || current === lastLen || current >= 3)) {
        isStart = false;
        const original = current;
        while (stack.length && current && lastLen <= current) {
          const delimiter = stack.pop();
          const size = Math.min(delimiter[4], delimiter[4] === 3 ? 1 : MAX_SIZE);
          addRegion(delimiter[1] - size, delimiter[1], start, start + size, size);
          start += size;
          current -= size;
          if (size < delimiter[4]) stack.push([delimiter[0], delimiter[1] - size, delimiter[2], delimiter[3], delimiter[4] - size]);
          if (!stack.length) {
            if (others(delim)) { stack.length = 0; continue; }
            isEnd = false;
            break;
          }
          lastLen = stack[stack.length - 1][4];
        }
        if (original >= 3 && current && isAmbiguous) {
          stack.push([m2.start + (original - current), end, false, original, current]);
          isEnd = false;
        } else {
          isEnd = Boolean(current && stack.length && lastLen > current);
        }
      }
      if (stack.length && isEnd && (lastLen >= 3 || !isAmbiguous) && lastLen > current) {
        let delimiter = stack.pop();
        while (stack.length && delimiter[4] !== 3 && delimiter[2]) { delimiter = stack.pop(); lastLen = delimiter[4]; }
        if (delimiter[2] && delimiter[4] !== 3) {
          if (others(delim)) { stack.length = 0; continue; }
          break;
        }
        isStart = false;
        const ds = delimiter[0];
        let de = delimiter[1];
        while (current) {
          const size = Math.min(current, current === 3 ? 1 : MAX_SIZE);
          addRegion(ds + (lastLen - size), de, start, start + size, size);
          start += size;
          current -= size;
          lastLen -= size;
          de -= size;
        }
        if (lastLen) stack.push([ds, de, false, delimiter[3], lastLen]);
      }
      if (isStart) stack.push([start, end, isAmbiguous, current, current]);
    }
    const unpaired = DELIMS.flatMap((d) => d.stack).sort((x, y) => x[0] - y[0]);
    regions.sort((x, y) => x[0] - y[0]);
    return { regions, unpaired, first: m0 };
  }

  // Python's _build_element: the element tree for the regions from `start`; returns [node, count].
  function buildElement(data, regions, start) {
    let el = null, lastEl = null, previous = null, idx = 0;
    const outer = [], outerR = [];
    for (let i = start; i < regions.length; i++) {
      idx += 1;
      const r = regions[i];
      if (idx && r[0] >= regions[start][3]) { idx -= 1; break; }
      const el1 = { tag: r[4] === 2 ? TAGS[0] : TAGS[1], text: null, tail: null, children: [] };
      if (idx > 1) {
        if (lastEl.text === null) lastEl.text = previous[2] < r[0] ? data.slice(previous[1], previous[2]) : data.slice(previous[1], r[0]);
        if (lastEl !== outer[outer.length - 1] && lastEl.tail === null) {
          const o = outerR[outerR.length - 1];
          if (r[0] < o[3]) lastEl.tail = data.slice(previous[3], r[0]);
          else { lastEl.tail = data.slice(previous[3], o[2]); outer[outer.length - 1].tail = data.slice(o[3], r[0]); }
        }
      }
      if (el === null) {
        el = el1; lastEl = el; outer.push(el); outerR.push(r);
      } else {
        while (outerR.length > 1 && r[3] > outerR[outerR.length - 1][3]) { outer.pop(); outerR.pop(); }
        outer[outer.length - 1].children.push(el1);
        if (i + 1 < regions.length && r[3] > regions[i + 1][3]) { outer.push(el1); outerR.push(r); }
        lastEl = el1;
      }
      previous = r;
    }
    while (outer.length) {
      if (lastEl.text === null) lastEl.text = data.slice(previous[1], previous[2]);
      if (lastEl.tail === null && lastEl !== outer[outer.length - 1]) lastEl.tail = data.slice(previous[3], outerR[outerR.length - 1][2]);
      lastEl = outer.pop();
      previous = outerR.pop();
    }
    return [el, idx];
  }

  function emphasis(s) {
    const html = (node) => `<${node.tag}>${this.render(node.text || '', PATTERNS.length)}${node.children.map(html).join('')}</${node.tag}>`
      + this.render(node.tail || '', PATTERNS.length);
    let i = 0;
    for (;;) {
      let p = i;
      while (p < s.length && !DELIM.has(s[p])) p++;
      if (p >= s.length) break;
      const a = analyse(s, p);
      if (a.skip) { i = a.skip[1]; continue; }
      if (!a.regions.length) {
        i = a.unpaired.length ? a.unpaired[a.unpaired.length - 1][1] : a.first.end;
        continue;
      }
      const groups = [];
      for (let k = 0; k < a.regions.length;) {
        const [node, count] = buildElement(s, a.regions, k);
        groups.push([a.regions[k][0], a.regions[k][3], this.token(html({ ...node, tail: '' }))]);
        k += count;
      }
      for (let g = groups.length - 1; g >= 0; g--) {
        const [gs, ge, tok] = groups[g];
        s = s.slice(0, gs) + tok + s.slice(ge);
      }
      const lastTok = groups[groups.length - 1][2];
      i = s.indexOf(lastTok) + lastTok.length;
    }
    return s;
  }

  const PATTERNS = [
    function backtick(s) {
      return s.replace(/(?<!\\)(`+)(.+?)(?<!`)\1(?!`)/gs, (_, t, code) => this.token(`<code>${escapeText(code.trim())}</code>`));
    },
    function escape(s) {
      return s.replace(/\\(.)/gs, (all, ch) => (ESCAPED.includes(ch) ? this.token(escapeText(ch)) : all));
    },
    function footnote(s) {
      return s.replace(/\[\^([^\]]*)\]/g, (all, id) => {
        if (!this.footnotes.has(id)) return all;
        const n = (this.refs.get(id) || 0) + 1;
        this.refs.set(id, n);
        const num = [...this.footnotes.keys()].indexOf(id) + 1;
        const refId = n === 1 ? `fnref:2-${id}` : `fnref${n}:2-${id}`;
        return this.token(`<sup id="${escapeAttr(refId)}"><a class="footnote-ref" href="${escapeAttr(`#fn:2-${id}`)}">${num}</a></sup>`);
      });
    },
    function link(s, k) {
      let out = '', i = 0;
      while (i < s.length) {
        const open = s.indexOf('[', i);
        if (open < 0) { out += s.slice(i); break; }
        out += s.slice(i, open);
        const close = findClosing(s, open, '[', ']');
        if (close < 0 || s[close + 1] !== '(') { out += '['; i = open + 1; continue; }
        const end = findClosing(s, close + 1, '(', ')');
        if (end < 0) { out += '['; i = open + 1; continue; }
        const inside = s.slice(close + 2, end).trim();
        const m = /^<?([^>\s]*)>?(?:\s+(["'])([\s\S]*)\2)?$/.exec(inside);
        if (!m) { out += '['; i = open + 1; continue; }
        const attrs = [`href="${escapeAttr(m[1])}"`];
        if (m[3] !== undefined) attrs.push(`title="${escapeAttr(m[3])}"`);
        out += this.token(`<a ${attrs.join(' ')}>${this.render(s.slice(open + 1, close), k + 1)}</a>`);
        i = end + 1;
      }
      return out;
    },
    function autolink(s) {
      return s.replace(/<((?:[Ff]|[Hh][Tt])[Tt][Pp][Ss]?:\/\/[^<>]*)>/g, (_, url) => this.token(`<a href="${escapeAttr(url)}">${escapeText(url)}</a>`));
    },
    function linebreak(s) { return s.replace(/ {2,}\n/g, () => this.token('<br />\n')); },
    function comment(s) { return s.replace(/<!--[\s\S]*?-->/g, (c) => this.token(c)); },
    function entity(s) { return s.replace(/&(?:#[0-9]+|#[xX][0-9a-fA-F]+|[a-zA-Z0-9]+);/g, (e) => this.token(e)); },
    emphasis,
  ];

  // --- serialising --------------------------------------------------------------------------------------
  function prettify(e) {
    if (BLOCK_LEVEL.has(e.tag) && e.tag !== 'code' && e.tag !== 'pre') {
      if ((!e.text || !e.text.trim()) && e.children.length && BLOCK_LEVEL.has(e.children[0].tag)) e.text = '\n';
      for (const c of e.children) if (BLOCK_LEVEL.has(c.tag)) prettify(c);
      if (!e.tail || !e.tail.trim()) e.tail = '\n';
    }
    if (!e.tail || !e.tail.trim()) e.tail = '\n';
  }

  function serialize(e) {
    const attrs = e.attrs.map(([k, v]) => ` ${k}="${escapeAttr(v)}"`).join('');
    if (VOID.has(e.tag)) return `<${e.tag}${attrs} />${e.tail}`;
    return `<${e.tag}${attrs}>${e.text}${e.children.map(serialize).join('')}</${e.tag}>${e.tail}`;
  }

  function footnotesDiv(parser) {
    if (!parser.footnotes.size) return null;
    const div = el('div', [['class', 'footnote']]);
    sub(div, 'hr');
    const ol = sub(div, 'ol');
    let index = 0;
    for (const [id, text] of parser.footnotes) {
      index += 1;
      const li = sub(ol, 'li', [['id', `fn:2-${id}`]]);
      const surrogate = el('div');
      parser.parseChunk(surrogate, text);
      li.children.push(...surrogate.children);
      const lastChild = last(li);
      if (lastChild && lastChild.tag === 'p') lastChild.text += NBSP_MARK;
      else sub(li, 'p');
      li.backref = { id, index };
    }
    return div;
  }

  function render(source) {
    const stash = [];
    let text = source.replace(/[\u0002\u0003]/g, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n') + '\n\n';
    text = text.split('\n').map((line) => {
      // str.expandtabs(4)
      let out = '';
      for (const ch of line) out += ch === '\t' ? ' '.repeat(TAB - (out.length % TAB)) : ch;
      return out;
    }).join('\n');
    text = text.replace(/(?<=\n) +\n/g, '\n');
    text = extractHtml(text, stash);

    const parser = new Parser();
    const root = el('div');
    parser.parseChunk(root, text);
    const div = footnotesDiv(parser);
    if (div) root.children.push(div);

    // inline: Python-Markdown's traversal order (a queue: every element's children's texts, breadth first)
    const inline = new Inline(parser.footnotes);
    const queue = [root];
    while (queue.length) {
      const cur = queue.shift();
      for (const child of cur.children) {
        if (child.text && !child.atomic) child.text = inline.render(child.text);
        if (child.tail) child.tail = inline.render(child.tail);
        if (child.children.length) queue.push(child);
      }
    }
    // footnote backlinks, one per reference
    if (div) {
      for (const li of div.children[1].children) {
        const { id, index } = li.backref;
        const n = Math.max(1, inline.refs.get(id) || 0);
        const p = last(li);
        let links = '';
        for (let r = 1; r <= n; r++) {
          const ref = r === 1 ? `fnref:2-${id}` : `fnref${r}:2-${id}`;
          links += `<a class="footnote-backref" href="${escapeAttr('#' + ref)}" title="Jump back to footnote ${index} in the text"></a>`;
        }
        p.text += links;
      }
    }
    prettify(root);
    // <br> tails
    let html = (root.text || '') + root.children.map(serialize).join('');
    html = inline.resolve(html).replace(//g, '&#160;');
    html = html.replace(/<br \/>\n(?!\n)/g, '<br />\n');
    // raw HTML blocks
    html = html.replace(new RegExp(`<p>(${PLACEHOLDER_RE.source})</p>`, 'g'), (all, ph, i) => (isBlock(stash[+i]) ? stash[+i] : all));
    html = html.replace(PLACEHOLDER_RE, (_, i) => stash[+i]);
    return html.trim();
  }

  function isBlock(html) {
    const m = /^<\/?([^ >]+)/.exec(html);
    if (!m) return false;
    return '!?@%'.includes(m[1][0]) || BLOCK_LEVEL.has(m[1].toLowerCase());
  }

  const api = { render };
  if (typeof module !== 'undefined') module.exports = api;
  else (g.FCEngine = g.FCEngine || {}).markdown = api;
})(typeof window !== 'undefined' ? window : globalThis);
