// メモとファイルの読み書き。画面側は window.store だけを使う（保存先の違いはここで吸収）。
//   store.mode                 "demo" | "cloud"
//   store.init()               起動時。cloud でログイン未了なら { needLogin: true }
//   store.list()               メモの配列（新しい順）
//   store.save(memo)           { id, kind, title, book, body, attachments, created_at } を保存（同じidは上書き）
//   store.remove(memo)         メモと添付ファイルを削除
//   store.uploadFile(file)     -> { path, name, type, size }
//   store.removeFiles(paths)   添付ファイルだけ削除
//   store.fileUrl(path)        表示・ダウンロード用のURL
(function () {
  const cfg = window.MEMO_CONFIG || {};
  const BUCKET = "memo-files";

  // ---------- お試し版（localStorage。写真は小さくしてデータURLで保存）----------
  const KEY = "memo-app-demo";
  const readDemo = () => { try { return JSON.parse(localStorage.getItem(KEY) || "[]"); } catch { return []; } };
  const writeDemo = (a) => localStorage.setItem(KEY, JSON.stringify(a));
  const toDataUrl = (file) => new Promise((res, rej) => {
    const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file);
  });
  const demo = {
    mode: "demo",
    async init() { return {}; },
    async list() { return readDemo().sort((a, b) => b.created_at.localeCompare(a.created_at)); },
    async save(m) {
      const all = readDemo().filter((x) => x.id !== m.id);
      const row = { ...m, updated_at: new Date().toISOString() };
      all.push(row); writeDemo(all); return row;
    },
    async remove(m) { writeDemo(readDemo().filter((x) => x.id !== m.id)); },
    async uploadFile(file) {
      return { path: await toDataUrl(file), name: file.name, type: file.type, size: file.size };
    },
    async removeFiles() {},
    async fileUrl(path) { return path; },
  };

  // ---------- クラウド版（Supabase）----------
  // テーブル・置き場の定義は supabase/schema.sql。本人しか読み書きできない（RLS）。
  let sb = null, uid = null;
  const cloud = {
    mode: "cloud",
    async init() {
      const { createClient } = await import("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm");
      sb = createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);
      const { data } = await sb.auth.getSession();
      if (data.session) uid = data.session.user.id;
      return data.session ? {} : { needLogin: true };
    },
    async sendLoginLink(email) {
      const { error } = await sb.auth.signInWithOtp({
        email, options: { emailRedirectTo: location.origin + location.pathname, shouldCreateUser: false },
      });
      if (error) throw error;
    },
    async logout() { await sb.auth.signOut(); location.reload(); },
    async list() {
      const { data, error } = await sb.from("memos").select("*").order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
    async save(m) {
      const row = { ...m, user_id: uid, updated_at: new Date().toISOString() };
      const { error } = await sb.from("memos").upsert(row, { onConflict: "user_id,id" });
      if (error) throw error;
      return row;
    },
    async remove(m) {
      const paths = (m.attachments || []).map((a) => a.path);
      if (paths.length) await sb.storage.from(BUCKET).remove(paths);
      const { error } = await sb.from("memos").delete().eq("id", m.id);
      if (error) throw error;
    },
    async uploadFile(file) {
      const ext = (file.name.match(/\.[A-Za-z0-9]+$/) || [""])[0].toLowerCase();
      const path = `${uid}/${crypto.randomUUID()}${ext}`;
      const { error } = await sb.storage.from(BUCKET).upload(path, file, { contentType: file.type || undefined });
      if (error) throw error;
      return { path, name: file.name, type: file.type, size: file.size };
    },
    async removeFiles(paths) {
      if (paths.length) await sb.storage.from(BUCKET).remove(paths);
    },
    async fileUrl(path) {
      const { data, error } = await sb.storage.from(BUCKET).createSignedUrl(path, 3600);
      if (error) throw error;
      return data.signedUrl;
    },
  };

  window.store = cfg.supabaseUrl && cfg.supabaseAnonKey ? cloud : demo;
})();
