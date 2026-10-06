// 데이터 저장 계층
//  - Supabase 설정이 있으면 중앙 저장소(전국 공용): 테이블 sites·diagnoses + 저장소 버킷 'lira'
//  - 설정이 없으면 이 브라우저(IndexedDB)에만 저장하는 로컬 모드
// 화면 코드는 이 계층의 함수만 사용하므로, 나중에 한전 서버로 옮길 때 이 파일만 바꾸면 된다.

const BUCKET = 'lira';
export const VERSION = '0.4';

export async function createStore(cfg) {
  if (cfg && cfg.SUPABASE_URL && cfg.SUPABASE_KEY && window.supabase) {
    return new SupabaseStore(cfg);
  }
  return new LocalStore();
}

function nowISO() { return new Date().toISOString(); }

// ---------------------------------------------------------------------------
class SupabaseStore {
  constructor(cfg) {
    this.mode = 'supabase';
    this.label = '중앙 저장소 (Supabase)';
    this.url = cfg.SUPABASE_URL.replace(/\/$/, '');
    this.client = window.supabase.createClient(this.url, cfg.SUPABASE_KEY);
    this.channel = null;
  }

  async loadAll() {
    const sites = await this._selectAll('sites');
    const diagnoses = await this._selectAll('diagnoses');
    return { sites: sites.map(r => r.data), diagnoses: diagnoses.map(r => r.data) };
  }

  async _selectAll(table) {
    const out = [];
    const page = 1000;
    for (let from = 0; ; from += page) {
      const { data, error } = await this.client.from(table).select('id,data').range(from, from + page - 1);
      if (error) throw new Error(`${table} 읽기 실패: ${error.message}`);
      out.push(...data);
      if (data.length < page) break;
    }
    return out;
  }

  async saveSite(site) {
    site.updatedAt = nowISO();
    const { error } = await this.client.from('sites').upsert({ id: site.id, data: site, updated_at: site.updatedAt });
    if (error) throw new Error('구간 저장 실패: ' + error.message);
  }

  async saveDiagnosis(d) {
    const { error } = await this.client.from('diagnoses').upsert({ id: d.id, site_id: d.siteId, data: d, updated_at: d.updatedAt || nowISO() });
    if (error) throw new Error('진단 저장 실패: ' + error.message);
  }

  async bulkInsert(sites, diagnoses) {
    const chunk = (a, n) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));
    for (const c of chunk(sites, 200)) {
      const { error } = await this.client.from('sites').upsert(c.map(s => ({ id: s.id, data: s, updated_at: s.updatedAt || nowISO() })));
      if (error) throw new Error('구간 일괄 저장 실패: ' + error.message);
    }
    for (const c of chunk(diagnoses, 200)) {
      const { error } = await this.client.from('diagnoses').upsert(c.map(d => ({ id: d.id, site_id: d.siteId, data: d, updated_at: d.updatedAt || nowISO() })));
      if (error) throw new Error('진단 일괄 저장 실패: ' + error.message);
    }
  }

  async deleteDiagnosis(id) {
    const { error } = await this.client.from('diagnoses').delete().eq('id', id);
    if (error) throw new Error('진단 삭제 실패: ' + error.message);
  }

  async deleteSite(id) {
    const { error } = await this.client.from('sites').delete().eq('id', id);
    if (error) throw new Error('구간 삭제 실패: ' + error.message);
  }

  async putFile(path, blob, contentType) {
    const { error } = await this.client.storage.from(BUCKET).upload(path, blob, {
      contentType: contentType || blob.type || 'application/octet-stream', upsert: true, cacheControl: '31536000',
    });
    if (error) throw new Error('파일 업로드 실패: ' + error.message);
    return path;
  }

  async removeFiles(paths) {
    const list = paths.filter(p => p && !p.startsWith('static:'));
    if (!list.length) return;
    await this.client.storage.from(BUCKET).remove(list);
  }

  async getURL(path) {
    if (!path) return '';
    if (path.startsWith('static:')) return path.slice(7);
    return this.client.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
  }

  async getText(path) {
    if (path.startsWith('static:')) return (await fetch(path.slice(7))).text();
    const { data, error } = await this.client.storage.from(BUCKET).download(path);
    if (error) throw new Error('파일 읽기 실패: ' + error.message);
    return data.text();
  }

  async getBlob(path) {
    if (path.startsWith('static:')) return (await fetch(path.slice(7))).blob();
    const { data, error } = await this.client.storage.from(BUCKET).download(path);
    if (error) throw new Error('파일 읽기 실패: ' + error.message);
    return data;
  }

  /** 전국 공통 설정(판정 기준 등). 테이블이 없으면(setup.sql 이전 버전) { missing: true } */
  async loadSettings(id) {
    const { data, error } = await this.client.from('app_settings').select('data').eq('id', id).maybeSingle();
    if (error) return { missing: true, error: error.message };
    return { data: data ? data.data : null };
  }

  async saveSettings(id, value) {
    const { error } = await this.client.from('app_settings').upsert({ id, data: value, updated_at: nowISO() });
    if (error) throw new Error('설정 저장 실패: ' + error.message + ' (Supabase에서 새 setup.sql을 다시 실행해야 할 수 있습니다)');
  }

  /** 다른 사용자가 저장·삭제하면 바로 반영 (Supabase Realtime) */
  subscribe(onChange) {
    try {
      this.channel = this.client.channel('lira-changes')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'sites' }, p => onChange('sites', p))
        .on('postgres_changes', { event: '*', schema: 'public', table: 'diagnoses' }, p => onChange('diagnoses', p))
        .on('postgres_changes', { event: '*', schema: 'public', table: 'app_settings' }, p => onChange('app_settings', p))
        .subscribe();
    } catch (e) { console.warn('realtime off', e); }
  }

  async resetAll() {
    for (const t of ['diagnoses', 'sites']) {
      const { error } = await this.client.from(t).delete().not('id', 'is', null);
      if (error) throw new Error(`${t} 삭제 실패: ` + error.message);
    }
    for (const folder of ['photos', 'spectra', 'raw']) {
      await this._removeFolder(folder);
    }
  }

  async _removeFolder(prefix) {
    const st = this.client.storage.from(BUCKET);
    for (let guard = 0; guard < 50; guard++) {
      const { data, error } = await st.list(prefix, { limit: 1000 });
      if (error || !data || !data.length) return;
      const files = data.filter(x => x.id).map(x => `${prefix}/${x.name}`);
      const dirs = data.filter(x => !x.id).map(x => `${prefix}/${x.name}`);
      for (const d of dirs) await this._removeFolder(d);
      if (files.length) await st.remove(files);
      if (data.length < 1000 && !dirs.length) return;
      if (!files.length) return;
    }
  }
}

// ---------------------------------------------------------------------------
class LocalStore {
  constructor() {
    this.mode = 'local';
    this.label = '이 브라우저에만 저장 (로컬 모드)';
    this.dbp = null;
    this.urlCache = new Map();
  }

  _db() {
    if (!this.dbp) {
      this.dbp = new Promise((resolve, reject) => {
        const req = indexedDB.open('lira-history', 1);
        req.onupgradeneeded = () => {
          const db = req.result;
          db.createObjectStore('sites', { keyPath: 'id' });
          db.createObjectStore('diagnoses', { keyPath: 'id' });
          db.createObjectStore('files');
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    }
    return this.dbp;
  }

  async _tx(store, mode, fn) {
    const db = await this._db();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, mode);
      const os = tx.objectStore(store);
      let result;
      Promise.resolve(fn(os)).then(r => { result = r; });
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }

  _req(r) { return new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); }

  async loadAll() {
    const sites = await this._tx('sites', 'readonly', os => this._req(os.getAll()));
    const diagnoses = await this._tx('diagnoses', 'readonly', os => this._req(os.getAll()));
    return { sites: sites || [], diagnoses: diagnoses || [] };
  }

  async saveSite(site) { site.updatedAt = nowISO(); await this._tx('sites', 'readwrite', os => os.put(JSON.parse(JSON.stringify(site)))); }
  async saveDiagnosis(d) { await this._tx('diagnoses', 'readwrite', os => os.put(JSON.parse(JSON.stringify(d)))); }
  async bulkInsert(sites, diagnoses) {
    await this._tx('sites', 'readwrite', os => sites.forEach(s => os.put(s)));
    await this._tx('diagnoses', 'readwrite', os => diagnoses.forEach(d => os.put(d)));
  }
  async deleteDiagnosis(id) { await this._tx('diagnoses', 'readwrite', os => os.delete(id)); }
  async deleteSite(id) { await this._tx('sites', 'readwrite', os => os.delete(id)); }

  async putFile(path, blob) { await this._tx('files', 'readwrite', os => os.put(blob, path)); return path; }
  async removeFiles(paths) {
    const list = paths.filter(p => p && !p.startsWith('static:'));
    await this._tx('files', 'readwrite', os => list.forEach(p => os.delete(p)));
    list.forEach(p => { const u = this.urlCache.get(p); if (u) URL.revokeObjectURL(u); this.urlCache.delete(p); });
  }
  async getBlob(path) {
    if (path.startsWith('static:')) return (await fetch(path.slice(7))).blob();
    const b = await this._tx('files', 'readonly', os => this._req(os.get(path)));
    if (!b) throw new Error('파일이 없습니다: ' + path);
    return b;
  }
  async getURL(path) {
    if (!path) return '';
    if (path.startsWith('static:')) return path.slice(7);
    if (this.urlCache.has(path)) return this.urlCache.get(path);
    try {
      const u = URL.createObjectURL(await this.getBlob(path));
      this.urlCache.set(path, u);
      return u;
    } catch { return ''; }
  }
  async getText(path) { return (await this.getBlob(path)).text(); }
  async loadSettings(id) {
    try { const t = localStorage.getItem('lira-settings-' + id); return { data: t ? JSON.parse(t) : null }; } catch { return { data: null }; }
  }
  async saveSettings(id, value) {
    try { localStorage.setItem('lira-settings-' + id, JSON.stringify(value)); } catch { throw new Error('이 브라우저에 설정을 저장할 수 없습니다.'); }
  }
  subscribe() {}
  async resetAll() {
    for (const s of ['sites', 'diagnoses', 'files']) await this._tx(s, 'readwrite', os => os.clear());
    this.urlCache.forEach(u => URL.revokeObjectURL(u));
    this.urlCache.clear();
  }
}
