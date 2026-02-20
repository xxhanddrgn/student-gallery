'use strict';

const express = require('express');
const multer  = require('multer');
const path    = require('path');
const fs      = require('fs');

// ── Setup ─────────────────────────────────────────────────
const PORT     = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE  = path.join(DATA_DIR, 'gallery.json');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(DB_FILE))  fs.writeFileSync(DB_FILE, JSON.stringify({ posts: [] }), 'utf-8');

// ── JSON file DB helpers ───────────────────────────────────
function readDB() {
  try {
    return JSON.parse(fs.readFileSync(DB_FILE, 'utf-8'));
  } catch {
    return { posts: [] };
  }
}

function writeDB(data) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), 'utf-8');
}

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// ── Express ───────────────────────────────────────────────
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Multer – memory storage, convert to base64
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
  try {
    const { posts } = readDB();
    // Return posts newest-first, with imageSrc data URL
    const result = [...posts].reverse().map(p => ({
      id:        p.id,
      name:      p.name,
      title:     p.title,
      desc:      p.desc,
      imageSrc:  `data:${p.mimeType};base64,${p.imageB64}`,
      likeCount: p.likeCount,
      createdAt: p.createdAt,
      comments:  p.comments,
    }));
    res.json(result);
  } catch (err) {
    console.error('GET /api/posts error:', err);
    res.status(500).json({ error: '게시물을 불러오는 데 실패했습니다.' });
  }
});

// POST /api/posts
app.post('/api/posts', upload.single('image'), (req, res) => {
  try {
    const { name, title, desc } = req.body || {};
    if (!name?.trim())  return res.status(400).json({ error: '이름을 입력해주세요.' });
    if (!title?.trim()) return res.status(400).json({ error: '제목을 입력해주세요.' });
    if (!req.file)      return res.status(400).json({ error: '이미지를 첨부해주세요.' });

    const post = {
      id:       genId(),
      name:     name.trim().slice(0, 30),
      title:    title.trim().slice(0, 60),
      desc:     (desc || '').trim().slice(0, 300),
      imageB64: req.file.buffer.toString('base64'),
      mimeType: req.file.mimetype,
      likeCount: 0,
      comments:  [],
      createdAt: Date.now(),
    };

    const db = readDB();
    db.posts.push(post);
    writeDB(db);

    res.status(201).json({
      id:        post.id,
      name:      post.name,
      title:     post.title,
      desc:      post.desc,
      imageSrc:  `data:${post.mimeType};base64,${post.imageB64}`,
      likeCount: 0,
      createdAt: post.createdAt,
      comments:  [],
    });
  } catch (err) {
    console.error('POST /api/posts error:', err);
    res.status(500).json({ error: '작품 저장에 실패했습니다: ' + err.message });
  }
});

// POST /api/posts/:id/like
app.post('/api/posts/:id/like', (req, res) => {
  try {
    const { action } = req.body;
    if (action !== 'like' && action !== 'unlike')
      return res.status(400).json({ error: 'action은 like 또는 unlike 이어야 합니다.' });

    const db   = readDB();
    const post = db.posts.find(p => p.id === req.params.id);
    if (!post) return res.status(404).json({ error: '게시물을 찾을 수 없습니다.' });

    if (action === 'like')   post.likeCount = (post.likeCount || 0) + 1;
    else                     post.likeCount = Math.max(0, (post.likeCount || 0) - 1);

    writeDB(db);
    res.json({ likeCount: post.likeCount });
  } catch (err) {
    console.error('POST like error:', err);
    res.status(500).json({ error: '좋아요 처리에 실패했습니다.' });
  }
});

// POST /api/posts/:id/comments
app.post('/api/posts/:id/comments', (req, res) => {
  try {
    const { name, text } = req.body || {};
    if (!name?.trim()) return res.status(400).json({ error: '이름을 입력해주세요.' });
    if (!text?.trim()) return res.status(400).json({ error: '댓글 내용을 입력해주세요.' });

    const db   = readDB();
    const post = db.posts.find(p => p.id === req.params.id);
    if (!post) return res.status(404).json({ error: '게시물을 찾을 수 없습니다.' });

    const comment = {
      id:         genId(),
      name:       name.trim().slice(0, 30),
      text:       text.trim().slice(0, 300),
      created_at: Date.now(),
    };
    post.comments.push(comment);
    writeDB(db);

    res.status(201).json(comment);
  } catch (err) {
    console.error('POST comment error:', err);
    res.status(500).json({ error: '댓글 저장에 실패했습니다.' });
  }
});

// ── Listen ────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🎨 학생 갤러리 서버 실행 중!`);
  console.log(`👉 브라우저에서 열기: http://localhost:${PORT}\n`);
});
