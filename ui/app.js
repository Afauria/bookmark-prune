const S = { page: 1, pageSize: 50, sort: 'updated_at', dir: 'desc', selected: new Set(), trashMode: false, filters: { category: '', tag: '', status: '', q: '' } };
let allData = [];
let filterData = { categories: [], tags: [] };

const $ = id => document.getElementById(id);
const $tbody = $('tbody'), $pageInfo = $('pageInfo'), $statsBar = $('statsBar');
const $prev = $('btnPrev'), $next = $('btnNext'), $search = $('searchInput');
const $cbAll = $('cbAll'), $selInfo = $('selInfo');
const $loading = $('loading'), $loadingText = $('loadingText'), $toast = $('toast');
const $btnTrash = $('btnTrash'), $btnDelete = $('btnDelete');

// --- API ---
async function api(path, opts) {
  const r = await fetch(path, opts);
  return r.json();
}

// --- Searchable Dropdown ---
function initDropdown(wrapId, items, onSelect) {
  const wrap = $(wrapId);
  const input = wrap.querySelector('.dd-input');
  const list = wrap.querySelector('.dd-list');
  const listItems = list.querySelectorAll('.dd-opt');
  let open = false;

  function toggle() { open ? close() : openDD() }
  function openDD() {
    open = true; list.classList.add('open');
    const search = document.createElement('input');
    search.className = 'dd-search';
    search.style.cssText = 'width:100%;border:none;border-bottom:1px solid #eee;padding:6px 8px;font-size:12px;outline:none';
    search.placeholder = '搜索...';
    if (!list.querySelector('.dd-search')) list.insertBefore(search, list.firstChild);
    search.value = ''; filterOpts('');
    setTimeout(() => search.focus(), 0);
    search.oninput = () => filterOpts(search.value);
  }
  function close() { open = false; list.classList.remove('open') }
  function filterOpts(q) {
    const lower = q.toLowerCase();
    list.querySelectorAll('.dd-opt').forEach(o => {
      const match = !q || o.textContent.toLowerCase().includes(lower);
      o.style.display = match ? '' : 'none';
    });
  }
  function selectOpt(opt) {
    const val = opt.dataset.value;
    input.value = val ? opt.textContent : '';
    input.dataset.value = val || '';
    close();
    onSelect(val || '');
  }

  input.addEventListener('click', toggle);
  list.addEventListener('click', e => {
    const opt = e.target.closest('.dd-opt');
    if (opt) selectOpt(opt);
  });
  document.addEventListener('click', e => { if (!wrap.contains(e.target)) close() });

  return {
    setValue(val) {
      const opt = list.querySelector('.dd-opt[data-value="' + val + '"]');
      if (opt) { input.value = opt.textContent; input.dataset.value = val }
      else { input.value = val ? '' : ''; input.dataset.value = '' }
    },
    loadItems(newItems) {
      const existing = new Set();
      list.querySelectorAll('.dd-opt').forEach(o => existing.add(o.dataset.value));
      newItems.forEach(item => {
        if (existing.has(item)) return;
        const o = document.createElement('div');
        o.className = 'dd-opt'; o.dataset.value = item; o.textContent = item;
        list.appendChild(o);
      });
    }
  };
}

const ddCat = initDropdown('ddCat', [], v => { S.filters.category = v; S.page = 1; load() });
const ddTag = initDropdown('ddTag', [], v => { S.filters.tag = v; S.page = 1; load() });
const ddStatus = initDropdown('ddStatus', [], v => { S.filters.status = v; S.page = 1; load() });

// --- Loading & Toast ---
function showLoading(t) { $loadingText.textContent = t || '处理中...'; $loading.classList.add('show') }
function hideLoading() { $loading.classList.remove('show') }
let toastTimer;
function toast(msg, type) {
  $toast.textContent = msg; $toast.className = 'toast ' + type + ' show';
  clearTimeout(toastTimer); toastTimer = setTimeout(() => $toast.classList.remove('show'), 3000);
}

// --- Data ---
async function loadFilters() {
  const [categories, tags] = await Promise.all([api('/api/categories'), api('/api/tags')]);
  ddCat.loadItems(categories); ddTag.loadItems(tags);
  filterData = { categories, tags };
}

async function loadStats() {
  const s = await api('/api/stats');
  $statsBar.innerHTML =
    '<span>共 <b class="num">' + s.total + '</b> 条</span>' +
    '<span>未扫描 <b class="num">' + (s.byStatus.pending || 0) + '</b></span>' +
    '<span>快速扫描 <b class="num">' + (s.byStatus.scan_done || 0) + '</b></span>' +
    '<span>深度扫描 <b class="num">' + (s.byStatus.deep_done || 0) + '</b></span>' +
    '<span>失败 <b class="num">' + (s.byStatus.error || 0) + '</b></span>' +
    '<span>无法访问 <b class="num">' + (s.byStatus.dead || 0) + '</b></span>' +
    '<span>内容为空 <b class="num">' + (s.byStatus.empty || 0) + '</b></span>';
}

async function load() {
  const p = new URLSearchParams();
  p.set('page', S.page); p.set('pageSize', S.pageSize);
  p.set('sort', S.sort); p.set('dir', S.dir === 'asc' ? 'asc' : 'desc');
  if (S.filters.category) p.set('category', S.filters.category);
  if (S.filters.tag) p.set('tag', S.filters.tag);
  if (S.filters.status) p.set('status', S.filters.status);
  if (S.filters.q) p.set('q', S.filters.q);

  const res = await api('/api/bookmarks?' + p);
  allData = res.data;
  $tbody.innerHTML = '';

  if (!res.data.length) {
    $tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:40px;color:#999">暂无数据</td></tr>';
  } else {
    res.data.forEach(b => {
      const tr = document.createElement('tr');
      tr.dataset.id = b.id;
      if (S.selected.has(b.id)) tr.classList.add('selected');
      const copyId = '<button class="copy-btn" title="复制 ID" data-copy="' + esc(b.id) + '">ID</button>';
      const copyUrl = '<button class="copy-btn" title="复制链接" data-copy="' + esc(b.url) + '">URL</button>';
      const tags = b.tags.map(t => '<span class="tag" data-filter-tag="' + esc(t) + '">' + esc(t) + '</span>').join('');
      const cat = '<span class="cat-link" data-filter-cat="' + esc(b.category || '') + '">' + esc(b.category || '-') + '</span>'
        + (b.subcategory ? '<span class="subcategory">' + esc(b.subcategory) + '</span>' : '');
      tr.innerHTML =
        '<td class="cb-cell"><input type="checkbox" data-id="' + b.id + '" ' + (S.selected.has(b.id) ? 'checked' : '') + '></td>' +
        '<td class="title-cell">' + copyId + copyUrl + '<a href="' + esc(b.url) + '" target="_blank" title="' + esc(b.url) + '">' + esc(b.title) + '</a></td>' +
        '<td>' + tags + '</td>' +
        '<td>' + cat + '</td>' +
        '<td><span class="badge badge-' + b.status + '">' + esc(b.statusLabel) + '</span></td>' +
        '<td class="date">' + esc(b.add_date) + '</td>' +
        '<td class="date">' + esc(b.processed_at) + '</td>';
      $tbody.appendChild(tr);
    });
  }

  $pageInfo.textContent = '共 ' + res.total + ' 条  第 ' + res.page + '/' + res.totalPages + ' 页';
  $prev.disabled = S.page <= 1; $next.disabled = S.page >= res.totalPages;
  updateSelInfo();
}

// --- Selection ---
function updateSelInfo() {
  const n = S.selected.size;
  $('btnScan').disabled = !n;
  $('btnDeep').disabled = !n;
  $btnDelete.disabled = !n;
  $selInfo.textContent = n ? n + ' 条已选' : '';
  $cbAll.checked = allData.length > 0 && allData.every(b => S.selected.has(b.id));
}

$tbody.addEventListener('click', e => {
  const cb = e.target.closest('input[type="checkbox"]');
  if (cb) {
    const id = cb.dataset.id;
    if (cb.checked) S.selected.add(id); else S.selected.delete(id);
    cb.closest('tr').classList.toggle('selected', cb.checked);
    updateSelInfo(); return;
  }
  const tag = e.target.closest('.tag');
  if (tag) { ddTag.setValue(tag.dataset.filterTag); S.filters.tag = tag.dataset.filterTag; S.page = 1; load(); return }
  const cat = e.target.closest('.cat-link');
  if (cat) { ddCat.setValue(cat.dataset.filterCat); S.filters.category = cat.dataset.filterCat; S.page = 1; load(); return }
  const btn = e.target.closest('.copy-btn');
  if (btn) { navigator.clipboard.writeText(btn.dataset.copy).then(() => toast('已复制')).catch(() => toast('复制失败', 'error')); return }
});

$cbAll.addEventListener('change', () => {
  const checked = $cbAll.checked;
  allData.forEach(b => { checked ? S.selected.add(b.id) : S.selected.delete(b.id) });
  $tbody.querySelectorAll('input[type="checkbox"]').forEach(cb => { cb.checked = checked; cb.closest('tr').classList.toggle('selected', checked) });
  updateSelInfo();
});

$('btnSelectAll').addEventListener('click', () => {
  if (S.selected.size === allData.length && allData.length > 0) {
    S.selected.clear();
  } else {
    allData.forEach(b => S.selected.add(b.id));
  }
  $tbody.querySelectorAll('input[type="checkbox"]').forEach(cb => {
    cb.checked = S.selected.has(cb.dataset.id);
    cb.closest('tr').classList.toggle('selected', cb.checked);
  });
  updateSelInfo();
});

// --- Scan / Deep ---
$('btnScan').addEventListener('click', async () => {
  if (!S.selected.size) return;
  const ids = [...S.selected];
  showLoading('正在快速扫描 ' + ids.length + ' 条书签...');
  try {
    const r = await api('/api/scan', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids }) });
    hideLoading();
    const parts = ['成功 ' + r.success];
    if (r.failed) parts.push('失败 ' + r.failed);
    if (r.dead) parts.push('死链 ' + r.dead);
    if (r.empty) parts.push('内容为空 ' + r.empty);
    toast('扫描完成: ' + parts.join(' '), 'success');
    S.selected.clear(); await Promise.all([load(), loadStats()]);
  } catch (e) { hideLoading(); toast('扫描失败: ' + e.message, 'error') }
});

$('btnDeep').addEventListener('click', async () => {
  if (!S.selected.size) return;
  const ids = [...S.selected];
  showLoading('正在深度解析 ' + ids.length + ' 条书签...');
  try {
    const r = await api('/api/deep', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids }) });
    hideLoading();
    const parts = ['成功 ' + r.success];
    if (r.failed) parts.push('失败 ' + r.failed);
    if (r.dead) parts.push('死链 ' + r.dead);
    if (r.empty) parts.push('内容为空 ' + r.empty);
    toast('解析完成: ' + parts.join(' '), 'success');
    S.selected.clear(); await Promise.all([load(), loadStats()]);
  } catch (e) { hideLoading(); toast('解析失败: ' + e.message, 'error') }
});

// --- Sorting ---
document.querySelectorAll('th.sortable').forEach(th => {
  th.addEventListener('click', () => {
    const col = th.dataset.sort;
    if (S.sort === col) {
      if (S.dir === 'desc') { S.dir = 'asc' }
      else if (S.dir === 'asc') { S.sort = 'updated_at'; S.dir = 'desc' }
    } else { S.sort = col; S.dir = 'desc' }
    document.querySelectorAll('.sort-arrow').forEach(a => { a.textContent = ''; a.classList.remove('active') });
    if (S.sort !== 'updated_at' || S.dir !== 'desc') {
      const arrow = $('sa_' + S.sort);
      arrow.textContent = S.dir === 'asc' ? '▲' : '▼'; arrow.classList.add('active');
    }
    load();
  });
});

// --- Search & Pagination ---
let searchTimer;
$search.addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => { S.filters.q = $search.value.trim(); S.page = 1; load() }, 300);
});

$prev.addEventListener('click', () => { S.page--; load() });
$next.addEventListener('click', () => { S.page++; load() });
$('pageSizeSel').addEventListener('change', e => { S.pageSize = parseInt(e.target.value); S.page = 1; load() });

function esc(s) { if (!s) return ''; const d = document.createElement('div'); d.textContent = String(s); return d.innerHTML }

// --- Trash mode ---
const trashLabel = $btnTrash.querySelector('.trash-label');
$btnTrash.addEventListener('click', () => {
  S.trashMode = !S.trashMode;
  if (S.trashMode) {
    S.filters.status = 'dead,empty'; S.page = 1;
    $btnTrash.classList.add('primary');
    ddStatus.setValue('dead,empty');
    trashLabel.textContent = '返回';
    $btnTrash.title = '返回主视图';
  } else {
    S.filters.status = ''; S.page = 1;
    $btnTrash.classList.remove('primary');
    ddStatus.setValue('');
    trashLabel.textContent = '回收站';
    $btnTrash.title = '查看回收站';
  }
  S.selected.clear(); load(); updateSelInfo();
});

$btnDelete.addEventListener('click', async () => {
  if (!S.selected.size) return;
  const ids = [...S.selected];
  if (!confirm('确定永久删除 ' + ids.length + ' 条书签？此操作不可恢复。')) return;
  try {
    const r = await api('/api/bookmarks', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids }) });
    toast('已删除 ' + r.deleted + ' 条书签', 'success');
    S.selected.clear(); await Promise.all([load(), loadStats()]);
  } catch (e) { toast('删除失败: ' + e.message, 'error') }
});

// --- Init ---
loadFilters(); loadStats(); load();
