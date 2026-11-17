const $ = id => document.getElementById(id);
let cfg = {};
let prompts = [];
let sha = null;
let editingId = null; // Biến dùng để kiểm tra đang sửa hay thêm mới

/* ========== AUTH ========== */
function loadAuth() {
  const saved = JSON.parse(localStorage.getItem('gh-config') || '{}');
  if (saved.token) {
    cfg = saved;
    $('token').value = saved.token;
    $('owner').value = saved.owner;
    $('repo').value = saved.repo;
    $('branch').value = saved.branch || 'main';
    showForm();
    $('logout-btn').classList.remove('hidden');
    loadPrompts();
  }
}

$('save-auth').onclick = async () => {
  cfg = {
    token: $('token').value.trim(),
    owner: $('owner').value.trim(),
    repo: $('repo').value.trim(),
    branch: $('branch').value.trim() || 'main'
  };
  if (!cfg.token || !cfg.owner || !cfg.repo) {
    return setStatus('auth-status', '❌ Điền đủ token, owner, repo', 'err');
  }
  localStorage.setItem('gh-config', JSON.stringify(cfg));
  setStatus('auth-status', '⏳ Đang kiểm tra kết nối...', '');
  const ok = await loadPrompts();
  if (ok) {
    setStatus('auth-status', '✅ Kết nối OK!', 'ok');
    showForm();
    $('logout-btn').classList.remove('hidden');
  }
};

$('logout-btn').onclick = () => {
  if (!confirm('Xoá token khỏi máy này?')) return;
  localStorage.removeItem('gh-config');
  location.reload();
};

function showForm() {
  $('form-section').classList.remove('hidden');
  $('list-section').classList.remove('hidden');
}

/* ========== GITHUB API ========== */
const api = path =>
  `https://api.github.com/repos/${cfg.owner}/${cfg.repo}/contents/${path}`;

async function ghGet(path) {
  const url = api(path) + `?ref=${cfg.branch}&t=${Date.now()}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `token ${cfg.token}`,
      Accept: 'application/vnd.github+json'
    }
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

function toBase64(data) {
  if (typeof data === 'string') {
    const bytes = new TextEncoder().encode(data);
    let bin = '';
    bytes.forEach(b => bin += String.fromCharCode(b));
    return btoa(bin);
  }
  const bytes = new Uint8Array(data);
  const chunk = 0x8000;
  let bin = '';
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

async function uploadFile(path, fileOrBuffer) {
  const buf = fileOrBuffer instanceof ArrayBuffer
    ? fileOrBuffer
    : await fileOrBuffer.arrayBuffer();
  const content = toBase64(buf);
  const existing = await ghGet(path);
  const body = {
    message: `Upload ${path} ${Date.now()}`,
    content,
    branch: cfg.branch
  };
  if (existing) body.sha = existing.sha;
  const res = await fetch(api(path), {
    method: 'PUT',
    headers: {
      Authorization: `token ${cfg.token}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(await res.text());
}

/* ========== LOAD PROMPTS ========== */
async function loadPrompts() {
  try {
    const file = await ghGet('data/prompts.json');
    if (file) {
      const json = new TextDecoder().decode(
        Uint8Array.from(atob(file.content), c => c.charCodeAt(0))
      );
      prompts = JSON.parse(json);
      sha = file.sha;
    } else {
      prompts = [];
      sha = null;
    }
    renderAdminList();
    return true;
  } catch (e) {
    setStatus('auth-status', '❌ Lỗi tải prompts: ' + e.message, 'err');
    return false;
  }
}

async function savePromptsJson() {
  const content = toBase64(JSON.stringify(prompts, null, 2));
  const body = {
    message: `Update prompts.json ${Date.now()}`,
    content,
    branch: cfg.branch
  };
  if (sha) body.sha = sha;
  const res = await fetch(api('data/prompts.json'), {
    method: 'PUT',
    headers: {
      Authorization: `token ${cfg.token}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(await res.text());
  const data = await res.json();
  sha = data.content.sha;
}

/* ========== LẤY THUMBNAIL TỪ VIDEO ========== */
async function extractThumb(file) {
  return new Promise(resolve => {
    const v = document.createElement('video');
    v.src = URL.createObjectURL(file);
    v.muted = true;
    v.playsInline = true;
    v.addEventListener('loadeddata', () => { v.currentTime = 0.1; });
    v.addEventListener('seeked', () => {
      const c = document.createElement('canvas');
      c.width = v.videoWidth;
      c.height = v.videoHeight;
      c.getContext('2d').drawImage(v, 0, 0);
      c.toBlob(b => {
        URL.revokeObjectURL(v.src);
        resolve(b);
      }, 'image/jpeg', 0.8);
    });
    v.addEventListener('error', () => resolve(null));
  });
}

/* ========== THÊM / SỬA PROMPT ========== */
$('btn-add').onclick = async () => {
  const title = $('f-title').value.trim();
  const promptEn = $('f-en').value.trim();
  const promptVi = $('f-vi').value.trim();
  const tags = $('f-tags').value.split(',').map(s => s.trim()).filter(Boolean);
  const collection = $('f-collection').value; 
  const aiModel = $('f-ai').value.trim();
  const videoFile = $('f-video').files[0];
  const thumbFile = $('f-thumb').files[0];

  if (!title) return setStatus('save-status', '❌ Cần nhập tiêu đề', 'err');
  
  // Nếu thêm mới thì bắt buộc phải có video, nếu Sửa thì không bắt buộc
  if (!editingId && !videoFile) {
    return setStatus('save-status', '❌ Cần chọn video cho prompt mới', 'err');
  }
  if (videoFile && videoFile.size > 5 * 1024 * 1024) {
    return setStatus('save-status', '❌ Video > 5MB. Nén nhỏ lại rồi thử lại.', 'err');
  }
  if (!promptEn && !promptVi) {
    return setStatus('save-status', '❌ Cần ít nhất 1 prompt (EN hoặc VI)', 'err');
  }

  try {
    if (editingId) {
      // ------ CHẾ ĐỘ SỬA ------
      setProgress('Đang lưu thay đổi...', 50);
      const index = prompts.findIndex(p => p.id === editingId);
      if (index === -1) throw new Error("Không tìm thấy prompt gốc");
      
      const old = prompts[index];
      
      // Nếu có chọn video mới thì upload đè
      if (videoFile) {
        setProgress('Đang upload video mới...', 30);
        const ext = videoFile.name.split('.').pop().toLowerCase();
        const videoPath = `media/videos/${editingId}.${ext}`;
        await uploadFile(videoPath, videoFile);
        old.video = videoPath;
      }

      // Nếu có chọn thumbnail mới thì upload đè
      if (thumbFile) {
        setProgress('Đang upload thumbnail mới...', 60);
        const tExt = thumbFile.name.split('.').pop().toLowerCase();
        const thumbPath = `media/thumbs/${editingId}.${tExt}`;
        await uploadFile(thumbPath, thumbFile);
        old.thumb = thumbPath;
      }

      // Cập nhật thông tin text
      old.title = title;
      old.promptEn = promptEn;
      old.promptVi = promptVi;
      old.tags = tags;
      old.collection = collection;
      old.aiModel = aiModel;

      setProgress('Đang lưu dữ liệu...', 85);
      await savePromptsJson();
      
      setStatus('save-status', '✅ Đã cập nhật prompt thành công!', 'ok');
      cancelEdit(); // Reset form về trạng thái thêm mới

    } else {
      // ------ CHẾ ĐỘ THÊM MỚI ------
      const id = Date.now().toString();
      const ext = videoFile.name.split('.').pop().toLowerCase();
      const videoPath = `media/videos/${id}.${ext}`;

      setProgress('Đang upload video...', 30);
      await uploadFile(videoPath, videoFile);

      let thumbPath = '';
      if (thumbFile) {
        setProgress('Đang upload thumbnail...', 60);
        const tExt = thumbFile.name.split('.').pop().toLowerCase();
        thumbPath = `media/thumbs/${id}.${tExt}`;
        await uploadFile(thumbPath, thumbFile);
      } else {
        setProgress('Đang tạo thumbnail từ video...', 60);
        const blob = await extractThumb(videoFile);
        if (blob) {
          thumbPath = `media/thumbs/${id}.jpg`;
          await uploadFile(thumbPath, new File([blob], `${id}.jpg`, { type: 'image/jpeg' }));
        }
      }

      setProgress('Đang lưu dữ liệu...', 85);
      prompts.push({
        id, title, promptEn, promptVi, tags, collection, aiModel,
        video: videoPath, thumb: thumbPath,
        createdAt: new Date().toISOString()
      });
      await savePromptsJson();
      setStatus('save-status', '✅ Đã thêm prompt mới thành công!', 'ok');
      resetForm();
    }

    setProgress('✅ Xong!', 100);
    renderAdminList();
    setTimeout(() => $('progress').classList.add('hidden'), 2500);
  } catch (e) {
    setStatus('save-status', '❌ Lỗi: ' + e.message, 'err');
    $('progress').classList.add('hidden');
  }
};

// Hàm hủy chế độ sửa, đưa form về trạng thái thêm mới
function cancelEdit() {
  editingId = null;
  $('f-title').value = '';
  $('f-en').value = '';
  $('f-vi').value = '';
  $('f-tags').value = '';
  $('f-ai').value = '';
  $('f-video').value = '';
  $('f-thumb').value = '';
  $('f-collection').value = 'Quần'; // Mặc định
  
  // Đổi lại text của nút bấm và tiêu đề form
  $('btn-add').textContent = '➕ Thêm prompt';
  $('btn-add').style.background = '#4f8';
  document.querySelector('#form-section h2').textContent = '2. Thêm prompt mới';
}

function resetForm() { cancelEdit(); }

function setProgress(msg, pct) {
  const p = $('progress');
  p.classList.remove('hidden');
  p.querySelector('div').style.width = pct + '%';
  p.querySelector('.progress-text').textContent = msg;
}

function setStatus(id, msg, type) {
  const el = $(id);
  el.textContent = msg;
  el.className = 'status ' + (type === 'ok' ? 'ok' : type === 'err' ? 'err' : '');
}

/* ========== DANH SÁCH + XOÁ + SỬA ========== */
function renderAdminList() {
  const wrap = $('admin-list');
  if (!prompts.length) {
    wrap.innerHTML = '<p style="color:#888">Chưa có prompt nào.</p>';
    return;
  }
  wrap.innerHTML = '';
  
  prompts.forEach((p, i) => {
    const d = document.createElement('div');
    d.className = 'admin-item';
    d.innerHTML = `
      <img src="${p.thumb || ''}" alt="">
      <div class="admin-item-info">
        <strong>${p.title}</strong>
        <div class="tags"><span style="background:#333; padding:2px 6px; border-radius:4px;">${p.collection || 'Khác'}</span> ${(p.tags || []).map(t => `<span>#${t}</span>`).join('')}</div>
      </div>
      <div style="display:flex; gap:5px;">
        <button class="btn-edit" data-i="${i}" style="background:#f90; color:#fff; border:none; padding:8px 12px; border-radius:8px; cursor:pointer; font-size:12px; font-weight:bold;">✏️ Sửa</button>
        <button class="btn-del" data-i="${i}">🗑 Xoá</button>
      </div>`;
    wrap.appendChild(d);
  });

  // Bắt sự kiện nút Xoá
  wrap.querySelectorAll('.btn-del').forEach(b => {
    b.onclick = async () => {
      const i = +b.dataset.i;
      if (!confirm(`Xoá "${prompts[i].title}"?`)) return;
      const removed = prompts.splice(i, 1)[0];
      try {
        await savePromptsJson();
        renderAdminList();
      } catch (e) {
        prompts.splice(i, 0, removed);
        alert('Lỗi xoá: ' + e.message);
      }
    };
  });

  // Bắt sự kiện nút Sửa
  wrap.querySelectorAll('.btn-edit').forEach(b => {
    b.onclick = () => {
      const i = +b.dataset.i;
      const p = prompts[i];
      editingId = p.id; // Đánh dấu đang sửa ID này

      // Điền dữ liệu cũ vào form
      $('f-title').value = p.title || '';
      $('f-en').value = p.promptEn || '';
      $('f-vi').value = p.promptVi || '';
      $('f-tags').value = (p.tags || []).join(', ');
      $('f-collection').value = p.collection || 'Quần';
      $('f-ai').value = p.aiModel || '';
      
      // Reset file input
      $('f-video').value = '';
      $('f-thumb').value = '';

      // Đổi giao diện form sang chế độ sửa
      $('btn-add').textContent = '💾 Lưu thay đổi';
      $('btn-add').style.background = '#f90'; // Đổi màu cam để dễ phân biệt
      document.querySelector('#form-section h2').textContent = '2. Sửa prompt: ' + p.title;

      // Cuộn lên phần form
      window.scrollTo({ top: 0, behavior: 'smooth' });
    };
  });
}

loadAuth();
