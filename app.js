let allPrompts = [];

async function loadPrompts() {
  try {
    const res = await fetch('data/prompts.json?v=' + Date.now());
    allPrompts = await res.json();
    populateFilters();
    render(allPrompts);
  } catch {
    document.getElementById('grid').innerHTML =
      '<p style="padding:20px">Chưa có prompt nào.</p>';
  }
}

function populateFilters() {
  const sel = document.getElementById('filter-collection');
  const set = [...new Set(allPrompts.map(p => p.collection).filter(Boolean))];
  set.forEach(c => {
    const o = document.createElement('option');
    o.value = c; o.textContent = c;
    sel.appendChild(o);
  });
}

function render(list) {
  const grid = document.getElementById('grid');
  grid.innerHTML = list.length
    ? ''
    : '<p style="padding:20px">Không có prompt.</p>';
  list.forEach(p => grid.appendChild(card(p)));
}

function card(p) {
  const el = document.createElement('article');
  el.className = 'card';
  el.innerHTML = `
    <div class="media">
      ${p.video
        ? `<video src="${p.video}" poster="${p.thumb || ''}"
                  muted loop playsinline preload="none"></video>
           <div class="play-hint">▶ Hover để xem</div>`
        : `<img src="${p.thumb || ''}" alt="${esc(p.title)}">`}
    </div>
    <div class="info">
      <h3>${esc(p.title)}</h3>
      <div class="tags">${(p.tags || []).map(t => `<span>#${esc(t)}</span>`).join('')}</div>
      <div class="copy-row">
        <button class="copy-en" ${!p.promptEn ? 'disabled' : ''}>📋 EN</button>
        <button class="copy-vi" ${!p.promptVi ? 'disabled' : ''}>📋 VI</button>
      </div>
    </div>`;

  const video = el.querySelector('video');
  const hint = el.querySelector('.play-hint');
  if (video) {
    el.addEventListener('mouseenter', () => {
      video.play().catch(() => {});
      hint?.classList.add('hide');
    });
    el.addEventListener('mouseleave', () => {
      video.pause();
      video.currentTime = 0;
      hint?.classList.remove('hide');
    });
    video.addEventListener('click', e => {
      e.stopPropagation();
      if (video.paused) {
        video.play().catch(() => {});
        hint?.classList.add('hide');
      } else {
        video.pause();
        hint?.classList.remove('hide');
      }
    });
    new IntersectionObserver(entries => {
      entries.forEach(en => {
        if (en.isIntersecting) video.preload = 'metadata';
      });
    }, { rootMargin: '200px' }).observe(video);
  }

  const bEn = el.querySelector('.copy-en');
  const bVi = el.querySelector('.copy-vi');
  bEn.onclick = e => { e.stopPropagation(); copyText(p.promptEn); };
  bVi.onclick = e => { e.stopPropagation(); copyText(p.promptVi); };

  return el;
}

async function copyText(text) {
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
  }
  showToast('📋 Đã copy!');
}

function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._t);
  t._t = setTimeout(() => t.classList.remove('show'), 1600);
}

const esc = s => String(s).replace(/[&<>"']/g,
  c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function filter() {
  const q = document.getElementById('search').value.toLowerCase().trim();
  const c = document.getElementById('filter-collection').value;
  render(allPrompts.filter(p => {
    const hitQ = !q ||
      (p.title || '').toLowerCase().includes(q) ||
      (p.promptEn || '').toLowerCase().includes(q) ||
      (p.promptVi || '').toLowerCase().includes(q) ||
      (p.tags || []).some(t => t.toLowerCase().includes(q));
    return hitQ && (!c || p.collection === c);
  }));
}

document.getElementById('search').addEventListener('input', filter);
document.getElementById('filter-collection').addEventListener('change', filter);
loadPrompts();