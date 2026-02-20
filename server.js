'use strict';

const express = require('express');
const multer  = require('multer');
const path    = require('path');
const fs      = require('fs');
const Database = require('better-sqlite3');

// ── Setup ─────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');
const DB_PATH  = path.join(DATA_DIR, 'gallery.db');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ── Schema ────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS posts (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    title       TEXT NOT NULL,
    desc        TEXT DEFAULT '',
    image_b64   TEXT NOT NULL,
    mime_type   TEXT NOT NULL DEFAULT 'image/jpeg',
    like_count  INTEGER NOT NULL DEFAULT 0,
    created_at  INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS comments (
    id         TEXT PRIMARY KEY,
    post_id    TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    name       TEXT NOT NULL,
    text       TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
`);

// Prepared statements
const stmt = {
  allPosts:    db.prepare(`SELECT id, name, title, desc, image_b64, mime_type, like_count, created_at FROM posts ORDER BY created_at DESC`),
  insertPost:  db.prepare(`INSERT INTO posts (id, name, title, desc, image_b64, mime_type, created_at) VALUES (@id, @name, @title, @desc, @image_b64, @mime_type, @created_at)`),
  getPost:     db.prepare(`SELECT id, like_count FROM posts WHERE id = ?`),
  incLike:     db.prepare(`UPDATE posts SET like_count = like_count + 1 WHERE id = ?`),
  decLike:     db.prepare(`UPDATE posts SET like_count = MAX(0, like_count - 1) WHERE id = ?`),
  getLikeCount:db.prepare(`SELECT like_count FROM posts WHERE id = ?`),
  commentsByPost: db.prepare(`SELECT id, name, text, created_at FROM comments WHERE post_id = ? ORDER BY created_at ASC`),
  insertComment:  db.prepare(`INSERT INTO comments (id, post_id, name, text, created_at) VALUES (@id, @post_id, @name, @text, @created_at)`),
};

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// ── Express ───────────────────────────────────────────────
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Multer – keep image in memory, convert to base64
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(Object.assign(new Error('이미지 파일만 업로드 가능합니다.'), { status: 400 }));
  },
});

// ── Routes ────────────────────────────────────────────────

// GET /api/posts
app.get('/api/posts', (_req, res) => {
  const posts = stmt.allPosts.all().map(p => ({
    id:        p.id,
    name:      p.name,
    title:     p.title,
    desc:      p.desc,
    imageSrc:  `data:${p.mime_type};base64,${p.image_b64}`,
    likeCount: p.like_count,
    createdAt: p.created_at,
    comments:  stmt.commentsByPost.all(p.id),
  }));
  res.json(posts);
});

// POST /api/posts
app.post('/api/posts', upload.single('image'), (req, res) => {
  const { name, title, desc } = req.body;
  if (!name?.trim() || !title?.trim()) {
    return res.status(400).json({ error: '이름과 제목은 필수입니다.' });
  }
  if (!req.file) {
    return res.status(400).json({ error: '이미지를 첨부해주세요.' });
  }

  const id = genId();
  stmt.insertPost.run({
    id,
    name:      name.trim().slice(0, 30),
    title:     title.trim().slice(0, 60),
    desc:      (desc || '').trim().slice(0, 300),
    image_b64: req.file.buffer.toString('base64'),
    mime_type: req.file.mimetype,
    created_at: Date.now(),
  });

  const post = stmt.allPosts.all().find(p => p.id === id);
  res.status(201).json({
    id:        post.id,
    name:      post.name,
    title:     post.title,
    desc:      post.desc,
    imageSrc:  `data:${post.mime_type};base64,${post.image_b64}`,
    likeCount: post.like_count,
    createdAt: post.created_at,
    comments:  [],
  });
});

// POST /api/posts/:id/like
app.post('/api/posts/:id/like', (req, res) => {
  const { id } = req.params;
  const { action } = req.body; // 'like' | 'unlike'

  const post = stmt.getPost.get(id);
  if (!post) return res.status(404).json({ error: '게시물을 찾을 수 없습니다.' });

  if (action === 'like')        stmt.incLike.run(id);
  else if (action === 'unlike') stmt.decLike.run(id);
  else return res.status(400).json({ error: 'action은 like 또는 unlike 이어야 합니다.' });

  const { like_count } = stmt.getLikeCount.get(id);
  res.json({ likeCount: like_count });
});

// POST /api/posts/:id/comments
app.post('/api/posts/:id/comments', (req, res) => {
  const { id } = req.params;
  const { name, text } = req.body;

  if (!name?.trim()) return res.status(400).json({ error: '이름을 입력해주세요.' });
  if (!text?.trim()) return res.status(400).json({ error: '댓글 내용을 입력해주세요.' });

  const post = stmt.getPost.get(id);
  if (!post) return res.status(404).json({ error: '게시물을 찾을 수 없습니다.' });

  const comment = {
    id:        genId(),
    post_id:   id,
    name:      name.trim().slice(0, 30),
    text:      text.trim().slice(0, 300),
    created_at: Date.now(),
  };
  stmt.insertComment.run(comment);

  res.status(201).json({ id: comment.id, name: comment.name, text: comment.text, created_at: comment.created_at });
});

// ── Error handler ─────────────────────────────────────────
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: err.message || '서버 오류가 발생했습니다.' });
});

// ── Listen ────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`🎨 학생 갤러리 서버 실행 중 → http://localhost:${PORT}`);
});
