// Where a family lives. Three kinds of Project:
//   folder   Chrome/Edge: a real folder through the File System Access API; the handle is kept in
//            IndexedDB, after a browser restart one click gives the permission back
//   browser  Firefox/Safari: the files read from a folder (<input webkitdirectory>) or made in the
//            wizard, kept in IndexedDB; the website and a backup are downloaded as ZIP files
//   memory   the example and a new family before the first save
// Project = {name, mode, files: Map<path, Uint8Array> (no web/ and history/ contents), paths: Set
//            (every path, also web/), write(path, bytes), remove(path), dirty, downloadBackup(extra),
//            downloadWeb(webFiles)}
(function (g) {
  'use strict';

  const FCApp = g.FCApp;
  const E = () => g.FCEngine;
  const DB = 'fc-app';
  const SKIP = /^(web|history)\//;   // read only the names of these, not the bytes

  // --- IndexedDB: stores "handles" (key "last") and "projects" (key = family name) -------------
  function idb() {
    return new Promise((resolve, reject) => {
      const r = g.indexedDB.open(DB, 1);
      r.onupgradeneeded = () => { r.result.createObjectStore('handles'); r.result.createObjectStore('projects'); };
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  }
  async function idbDo(store, mode, fn) {
    const db = await idb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, mode);
      const req = fn(tx.objectStore(store));
      tx.oncomplete = () => { db.close(); resolve(req && req.result); };
      tx.onerror = () => { db.close(); reject(tx.error); };
    });
  }
  const idbGet = (store, key) => idbDo(store, 'readonly', (s) => s.get(key));
  const idbPut = (store, key, value) => idbDo(store, 'readwrite', (s) => s.put(value, key));
  const idbKeys = (store) => idbDo(store, 'readonly', (s) => s.getAllKeys());

  const canFolder = () => typeof g.showDirectoryPicker === 'function';

  function backupZip(project, extra) {
    const files = new Map(project.files);
    for (const [k, v] of extra || []) files.set(k, v);
    return E().zip.create(files, new Date());
  }

  function base(name, mode, files, paths) {
    const p = {
      name, mode, files, paths: paths || new Set(files.keys()), dirty: false,
      downloadBackup(extra) {
        FCApp.dom.download(backupZip(p, extra), `${p.name} - backup.zip`);
        p.dirty = false;
        if (p.mode === 'browser') idbPut('projects', p.name, { files: p.files, dirty: false }).catch(() => {});
      },
      downloadWeb(webFiles) {
        FCApp.dom.download(E().zip.create(webFiles, new Date()), `${p.name} - website.zip`);
      },
    };
    return p;
  }

  // --- folder (File System Access) ---------------------------------------------------------------
  async function readTree(dir, prefix, files, paths) {
    for await (const [name, handle] of dir.entries()) {
      const path = prefix + name;
      if (handle.kind === 'directory') await readTree(handle, `${path}/`, files, paths);
      else {
        paths.add(path);
        if (!SKIP.test(path)) files.set(path, new Uint8Array(await (await handle.getFile()).arrayBuffer()));
      }
    }
  }

  async function folderProject(handle) {
    const files = new Map(), paths = new Set();
    await readTree(handle, '', files, paths);
    const p = base(handle.name, 'folder', files, paths);
    const dirOf = async (path, create) => {
      const parts = path.split('/');
      let d = handle;
      for (const part of parts.slice(0, -1)) d = await d.getDirectoryHandle(part, { create });
      return [d, parts[parts.length - 1]];
    };
    p.handle = handle;
    p.write = async (path, bytes) => {
      const [d, name] = await dirOf(path, true);
      const w = await (await d.getFileHandle(name, { create: true })).createWritable();
      await w.write(bytes);
      await w.close();
      p.paths.add(path);
      if (!SKIP.test(path)) p.files.set(path, bytes);
    };
    p.remove = async (path) => {
      try {
        const [d, name] = await dirOf(path, false);
        await d.removeEntry(name);
      } catch (e) { if (e.name !== 'NotFoundError') throw e; }
      p.paths.delete(path);
      p.files.delete(path);
    };
    return p;
  }

  // --- browser (IndexedDB) and memory ------------------------------------------------------------
  function memoryProject(name, files, mode = 'memory') {
    const p = base(name, mode, files);
    p.write = async (path, bytes) => {
      p.paths.add(path);
      if (SKIP.test(path)) return;    // the website is downloaded, not kept
      p.files.set(path, bytes);
      p.dirty = true;
      if (p.mode === 'browser') await idbPut('projects', p.name, { files: p.files, dirty: true });
    };
    p.remove = async (path) => {
      p.paths.delete(path);
      if (p.files.delete(path)) {
        p.dirty = true;
        if (p.mode === 'browser') await idbPut('projects', p.name, { files: p.files, dirty: true });
      }
    };
    return p;
  }

  function pickDirectoryFiles() {
    return new Promise((resolve) => {
      const input = FCApp.dom.h('input', { type: 'file', webkitdirectory: true, multiple: true, class: 'hidden' });
      input.addEventListener('change', () => { resolve([...input.files]); input.remove(); });
      document.body.appendChild(input);
      input.click();
    });
  }

  // Chrome/Edge: the folder picker. Firefox/Safari: read the folder once into IndexedDB.
  async function openFolder() {
    if (canFolder()) {
      const handle = await g.showDirectoryPicker({ id: 'family', mode: 'readwrite' });
      await idbPut('handles', 'last', handle);
      return folderProject(handle);
    }
    const list = await pickDirectoryFiles();
    if (!list.length) return null;
    const name = list[0].webkitRelativePath.split('/')[0];
    const files = new Map();
    for (const f of list) {
      const path = f.webkitRelativePath.split('/').slice(1).join('/');
      if (!SKIP.test(path)) files.set(path, new Uint8Array(await f.arrayBuffer()));
    }
    const p = memoryProject(name, files, 'browser');
    await idbPut('projects', name, { files, dirty: false });
    return p;
  }

  // The last folder (Chrome/Edge) or the families kept in this browser.
  async function saved() {
    try {
      if (canFolder()) {
        const handle = await idbGet('handles', 'last');
        return handle ? [{ name: handle.name, handle }] : [];
      }
      return (await idbKeys('projects')).map((name) => ({ name }));
    } catch (e) {
      return [];
    }
  }

  // Must run from a click (the permission prompt needs a user gesture).
  async function reopen(entry) {
    if (entry.handle) {
      const ok = (await entry.handle.queryPermission({ mode: 'readwrite' })) === 'granted' ||
        (await entry.handle.requestPermission({ mode: 'readwrite' })) === 'granted';
      return ok ? folderProject(entry.handle) : null;
    }
    const rec = await idbGet('projects', entry.name);
    if (!rec) return null;
    const p = memoryProject(entry.name, rec.files, 'browser');
    p.dirty = !!rec.dirty;
    return p;
  }

  // A new family turns into a saved one: Chrome/Edge pick a folder, else IndexedDB under `name`.
  async function persist(project, name) {
    if (canFolder()) {
      const handle = await g.showDirectoryPicker({ id: 'family', mode: 'readwrite' });
      await idbPut('handles', 'last', handle);
      return folderProject(handle);
    }
    const p = memoryProject(name, new Map(), 'browser');
    await idbPut('projects', name, { files: p.files, dirty: true });
    return p;
  }

  const example = () => memoryProject('Huber', FCApp.data.example());
  const blank = () => memoryProject('', new Map());

  FCApp.store = { canFolder, openFolder, saved, reopen, persist, example, blank, memoryProject };
})(window);
