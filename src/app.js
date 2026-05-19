const svg = document.getElementById('diagram');
const viewport = document.getElementById('viewport');
const nodesLayer = document.getElementById('nodes');
const linksLayer = document.getElementById('links');
const toolGrid = document.getElementById('toolGrid');

const state = {
  projectName: 'Neuer Netzwerkplan',
  filePath: '',
  nodes: [],
  links: [],
  selected: null,
  mode: 'select',
  connectionType: 'cable',
  pendingLinkNode: null,
  pan: { x: 0, y: 0 },
  zoom: 1,
  drag: null,
  history: [],
  future: []
};

const deviceTypes = [
  { type: 'router', label: 'Router', icon: '▣', color: '#7fd8b4' },
  { type: 'switch', label: 'Switch', icon: '▤', color: '#e7c96b' },
  { type: 'server', label: 'Server', icon: '▥', color: '#89aef5' },
  { type: 'firewall', label: 'Firewall', icon: '▨', color: '#ff9f7d' },
  { type: 'pc', label: 'Client', icon: '◧', color: '#d7dce2' },
  { type: 'cloud', label: 'Cloud', icon: '☁', color: '#d68cc7' }
];

const linkTypes = [
  { type: 'cable', label: 'Kabel', status: 'Kabelverbindung' },
  { type: 'fiber', label: 'Glasfaser', status: 'Glasfaserverbindung' },
  { type: 'wlan', label: 'WLAN', status: 'WLAN-Verbindung' },
  { type: 'vpn', label: 'VPN', status: 'VPN-Tunnel' },
  { type: 'internet', label: 'Internet', status: 'Internet-Uplink' },
  { type: 'serial', label: 'Seriell', status: 'Serielle Verbindung' }
];

const byId = (id) => document.getElementById(id);
const uid = (prefix) => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
const nodeById = (id) => state.nodes.find((node) => node.id === id);
const linkById = (id) => state.links.find((link) => link.id === id);
const deviceByType = (type) => deviceTypes.find((device) => device.type === type) || deviceTypes[0];
const linkTypeById = (type) => linkTypes.find((linkType) => linkType.type === normalizeLinkType(type)) || linkTypes[0];
const NODE_HEIGHT = 76;
const NODE_MIN_WIDTH = 140;
const NODE_MAX_WIDTH = 520;
const NODE_TEXT_START = 52;
const NODE_RIGHT_PADDING = 22;
const AUTOSAVE_KEY = 'netzwerkplan:lastProject';

function nodeMeta(node) {
  return node.ip || node.role || deviceByType(node.type).label;
}

function normalizeLinkType(type) {
  if (type === 'ethernet') return 'cable';
  if (type === 'wireless') return 'wlan';
  return type || 'cable';
}

function measureNodeText(value, fontSize, weight = 400) {
  const text = String(value || '');
  let width = 0;
  for (const char of text) {
    if ('il.,:;!|'.includes(char)) width += fontSize * 0.32;
    else if ('mwMW@#%&'.includes(char)) width += fontSize * 0.92;
    else if (char === ' ') width += fontSize * 0.34;
    else width += fontSize * 0.58;
  }
  return width * (weight >= 700 ? 1.08 : 1);
}

function getNodeSize(node) {
  const device = deviceByType(node.type);
  const titleWidth = measureNodeText(node.name || device.label, 14, 800);
  const metaWidth = measureNodeText(nodeMeta(node), 11);
  const width = Math.ceil(Math.max(NODE_MIN_WIDTH, Math.min(NODE_MAX_WIDTH, NODE_TEXT_START + Math.max(titleWidth, metaWidth) + NODE_RIGHT_PADDING)));
  return { width, height: NODE_HEIGHT };
}

function getNodeCenter(node) {
  const size = getNodeSize(node);
  return {
    x: node.x + size.width / 2,
    y: node.y + size.height / 2
  };
}

function snapshot() {
  return {
    projectName: state.projectName,
    nodes: structuredClone(state.nodes),
    links: structuredClone(state.links)
  };
}

function autosaveSnapshot() {
  return {
    app: 'Netzwerkplan',
    version: 1,
    projectName: state.projectName,
    filePath: state.filePath,
    connectionType: state.connectionType,
    pan: state.pan,
    zoom: state.zoom,
    nodes: state.nodes,
    links: state.links
  };
}

function saveLastProject() {
  localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(autosaveSnapshot()));
}

function loadLastProject() {
  const raw = localStorage.getItem(AUTOSAVE_KEY);
  if (!raw) return null;

  try {
    const project = JSON.parse(raw);
    if (!Array.isArray(project.nodes) || !Array.isArray(project.links)) return null;
    return project;
  } catch (_error) {
    return null;
  }
}

function pushHistory() {
  state.history.push(snapshot());
  if (state.history.length > 80) state.history.shift();
  state.future = [];
}

function restore(data) {
  state.projectName = data.projectName || 'Neuer Netzwerkplan';
  state.filePath = data.filePath || state.filePath || '';
  state.connectionType = normalizeLinkType(data.connectionType || state.connectionType);
  state.pan = data.pan || state.pan;
  state.zoom = data.zoom || state.zoom;
  state.nodes = data.nodes || [];
  state.links = data.links || [];
  state.selected = null;
  state.pendingLinkNode = null;
  render();
}

function setStatus(message) {
  byId('status').textContent = message;
}

function screenToWorld(event) {
  const rect = svg.getBoundingClientRect();
  return {
    x: (event.clientX - rect.left - state.pan.x) / state.zoom,
    y: (event.clientY - rect.top - state.pan.y) / state.zoom
  };
}

function updateTransform() {
  viewport.setAttribute('transform', `translate(${state.pan.x} ${state.pan.y}) scale(${state.zoom})`);
  byId('zoomLabel').textContent = `${Math.round(state.zoom * 100)}%`;
}

function select(kind, id) {
  state.selected = id ? { kind, id } : null;
  render();
}

function addNode(type, x = 120 + state.nodes.length * 34, y = 120 + state.nodes.length * 24) {
  pushHistory();
  const device = deviceByType(type);
  const node = {
    id: uid('node'),
    type,
    name: device.label,
    ip: '',
    role: '',
    note: '',
    x,
    y
  };
  state.nodes.push(node);
  select('node', node.id);
  setStatus(`${device.label} eingefügt`);
}

function removeSelection() {
  if (!state.selected) return;
  pushHistory();
  if (state.selected.kind === 'node') {
    const id = state.selected.id;
    state.nodes = state.nodes.filter((node) => node.id !== id);
    state.links = state.links.filter((link) => link.from !== id && link.to !== id);
  } else {
    state.links = state.links.filter((link) => link.id !== state.selected.id);
  }
  state.selected = null;
  render();
}

function addLink(from, to) {
  if (from === to || state.links.some((link) => (link.from === from && link.to === to) || (link.from === to && link.to === from))) {
    state.pendingLinkNode = null;
    render();
    return;
  }
  pushHistory();
  state.links.push({
    id: uid('link'),
    from,
    to,
    label: '',
    type: state.connectionType
  });
  state.pendingLinkNode = null;
  select('link', state.links[state.links.length - 1].id);
  setStatus(`${linkTypeById(state.connectionType).status} erstellt`);
}

function renderLinkTypeOptions(select) {
  select.innerHTML = linkTypes.map((linkType) => `
    <option value="${linkType.type}">${linkType.label}</option>
  `).join('');
}

function renderPalette() {
  toolGrid.innerHTML = deviceTypes.map((device) => `
    <button class="device-button" data-type="${device.type}" title="${device.label} einfügen">
      <span class="device-icon" style="color:${device.color}">${device.icon}</span>
      <span class="device-label">${device.label}</span>
    </button>
  `).join('');

  toolGrid.querySelectorAll('button').forEach((button) => {
    button.addEventListener('click', () => addNode(button.dataset.type));
  });
}

function renderConnectionTypes() {
  renderLinkTypeOptions(byId('connectionType'));
  renderLinkTypeOptions(byId('linkType'));
  byId('connectionType').value = state.connectionType;
}

function renderLinks() {
  linksLayer.innerHTML = '';
  state.links.forEach((link) => {
    const from = nodeById(link.from);
    const to = nodeById(link.to);
    if (!from || !to) return;

    const selected = state.selected?.kind === 'link' && state.selected.id === link.id;
    const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    group.setAttribute('class', `link ${selected ? 'selected' : ''}`);
    group.dataset.id = link.id;

    const fromCenter = getNodeCenter(from);
    const toCenter = getNodeCenter(to);
    const pathData = `M ${fromCenter.x} ${fromCenter.y} L ${toCenter.x} ${toCenter.y}`;
    const hit = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    hit.setAttribute('class', 'link-hit');
    hit.setAttribute('d', pathData);
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    line.setAttribute('class', `link-line ${normalizeLinkType(link.type)}`);
    line.setAttribute('d', pathData);

    group.append(hit, line);
    if (link.label) {
      const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      text.setAttribute('class', 'link-label');
      text.setAttribute('x', (fromCenter.x + toCenter.x) / 2);
      text.setAttribute('y', (fromCenter.y + toCenter.y) / 2 - 8);
      text.setAttribute('text-anchor', 'middle');
      text.textContent = link.label;
      group.append(text);
    }
    group.addEventListener('pointerdown', (event) => {
      event.stopPropagation();
      select('link', link.id);
    });
    linksLayer.append(group);
  });
}

function renderNodes() {
  nodesLayer.innerHTML = '';
  state.nodes.forEach((node) => {
    const device = deviceByType(node.type);
    const selected = state.selected?.kind === 'node' && state.selected.id === node.id;
    const pending = state.pendingLinkNode === node.id;
    const size = getNodeSize(node);
    const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    group.setAttribute('class', `node ${selected ? 'selected' : ''} ${pending ? 'pending' : ''}`);
    group.setAttribute('transform', `translate(${node.x} ${node.y})`);
    group.dataset.id = node.id;

    group.innerHTML = `
      <rect class="node-card" x="0" y="0" width="${size.width}" height="${size.height}" rx="7"></rect>
      <text class="node-icon" x="16" y="32" fill="${device.color}">${device.icon}</text>
      <text class="node-title" x="52" y="28">${escapeXml(node.name || device.label)}</text>
      <text class="node-meta" x="52" y="47">${escapeXml(nodeMeta(node))}</text>
      <circle class="port-dot" cx="${size.width / 2}" cy="${size.height}" r="4"></circle>
    `;

    group.addEventListener('pointerdown', (event) => beginNodePointer(event, node.id));
    nodesLayer.append(group);
  });
}

function renderInspector() {
  byId('projectName').value = state.projectName;
  byId('nodeCount').textContent = state.nodes.length;
  byId('linkCount').textContent = state.links.length;
  byId('fileName').textContent = state.filePath ? state.filePath.split(/[\\/]/).pop() : 'Unbenannt';

  const empty = byId('emptyInspector');
  const nodeForm = byId('nodeInspector');
  const linkForm = byId('linkInspector');
  empty.classList.remove('hidden');
  nodeForm.classList.add('hidden');
  linkForm.classList.add('hidden');

  if (state.selected?.kind === 'node') {
    const node = nodeById(state.selected.id);
    if (!node) return;
    empty.classList.add('hidden');
    nodeForm.classList.remove('hidden');
    byId('nodeName').value = node.name;
    byId('nodeIp').value = node.ip;
    byId('nodeRole').value = node.role;
    byId('nodeNote').value = node.note;
  }

  if (state.selected?.kind === 'link') {
    const link = linkById(state.selected.id);
    if (!link) return;
    empty.classList.add('hidden');
    linkForm.classList.remove('hidden');
    byId('linkLabel').value = link.label;
    byId('linkType').value = normalizeLinkType(link.type);
  }
}

function renderMode() {
  byId('selectMode').classList.toggle('active', state.mode === 'select');
  byId('connectMode').classList.toggle('active', state.mode === 'connect');
  svg.classList.toggle('connecting', state.mode === 'connect');
}

function render() {
  renderLinks();
  renderNodes();
  renderInspector();
  renderMode();
  updateTransform();
  saveLastProject();
}

function beginNodePointer(event, id) {
  event.stopPropagation();
  if (state.mode === 'connect') {
    if (!state.pendingLinkNode) {
      state.pendingLinkNode = id;
      select('node', id);
      setStatus('Zielgerät für Verbindung wählen');
    } else {
      addLink(state.pendingLinkNode, id);
    }
    render();
    return;
  }

  const node = nodeById(id);
  const start = screenToWorld(event);
  select('node', id);
  state.drag = {
    type: 'node',
    id,
    start,
    origin: { x: node.x, y: node.y },
    moved: false
  };
  svg.setPointerCapture(event.pointerId);
}

function beginCanvasPointer(event) {
  select(null, null);
  state.pendingLinkNode = null;
  const start = { x: event.clientX, y: event.clientY };
  state.drag = {
    type: 'pan',
    start,
    origin: { ...state.pan }
  };
  svg.classList.add('dragging');
  svg.setPointerCapture(event.pointerId);
}

function onPointerMove(event) {
  if (!state.drag) return;
  if (state.drag.type === 'node') {
    const node = nodeById(state.drag.id);
    const point = screenToWorld(event);
    const dx = point.x - state.drag.start.x;
    const dy = point.y - state.drag.start.y;
    if (!state.drag.moved && Math.hypot(dx, dy) > 2) {
      pushHistory();
      state.drag.moved = true;
    }
    node.x = Math.round((state.drag.origin.x + dx) / 8) * 8;
    node.y = Math.round((state.drag.origin.y + dy) / 8) * 8;
    render();
  }

  if (state.drag.type === 'pan') {
    state.pan.x = state.drag.origin.x + event.clientX - state.drag.start.x;
    state.pan.y = state.drag.origin.y + event.clientY - state.drag.start.y;
    updateTransform();
  }
}

function endPointer(event) {
  if (!state.drag) return;
  try {
    svg.releasePointerCapture(event.pointerId);
  } catch (_error) {
    // Pointer capture can already be gone after window focus changes.
  }
  state.drag = null;
  svg.classList.remove('dragging');
}

function mutateSelected(field, value) {
  if (!state.selected) return;
  pushHistory();
  updateSelectedField(field, value);
  render();
}

function updateSelectedField(field, value) {
  if (!state.selected) return;
  if (state.selected.kind === 'node') {
    const node = nodeById(state.selected.id);
    if (node) node[field] = value;
  } else {
    const link = linkById(state.selected.id);
    if (link) link[field] = field === 'type' ? normalizeLinkType(value) : value;
  }
}

function syncInspectorDraft() {
  if (state.selected?.kind === 'node') {
    updateSelectedField('name', byId('nodeName').value);
    updateSelectedField('ip', byId('nodeIp').value);
    updateSelectedField('role', byId('nodeRole').value);
    updateSelectedField('note', byId('nodeNote').value);
  }

  if (state.selected?.kind === 'link') {
    updateSelectedField('label', byId('linkLabel').value);
    updateSelectedField('type', byId('linkType').value);
  }
}

function undo() {
  if (!state.history.length) return;
  state.future.push(snapshot());
  restore(state.history.pop());
}

function redo() {
  if (!state.future.length) return;
  state.history.push(snapshot());
  restore(state.future.pop());
}

function fitView() {
  if (!state.nodes.length) {
    state.zoom = 1;
    state.pan = { x: 0, y: 0 };
    updateTransform();
    return;
  }
  const rect = svg.getBoundingClientRect();
  const minX = Math.min(...state.nodes.map((node) => node.x));
  const minY = Math.min(...state.nodes.map((node) => node.y));
  const maxX = Math.max(...state.nodes.map((node) => node.x + getNodeSize(node).width));
  const maxY = Math.max(...state.nodes.map((node) => node.y + getNodeSize(node).height));
  const width = maxX - minX;
  const height = maxY - minY;
  state.zoom = Math.min(1.6, Math.max(0.35, Math.min((rect.width - 120) / width, (rect.height - 120) / height)));
  state.pan = {
    x: rect.width / 2 - (minX + width / 2) * state.zoom,
    y: rect.height / 2 - (minY + height / 2) * state.zoom
  };
  updateTransform();
}

function serializeProject() {
  return {
    app: 'Netzwerkplan',
    version: 1,
    projectName: state.projectName,
    nodes: state.nodes,
    links: state.links
  };
}

function exportStyles() {
  return `
    .grid-bg { opacity: 0.72; }
    .link-hit { fill: none; stroke: transparent; stroke-width: 18; }
    .link-line { fill: none; stroke: #8ca7a0; stroke-width: 3; }
    .link-line.cable { stroke: #8ca7a0; }
    .link-line.fiber { stroke: #e7c96b; stroke-dasharray: 10 5; }
    .link-line.wlan { stroke: #89aef5; stroke-dasharray: 2 7; stroke-linecap: round; }
    .link-line.vpn { stroke: #d68cc7; stroke-dasharray: 12 4 2 4; }
    .link-line.internet { stroke: #7fd8b4; stroke-dasharray: 16 5; }
    .link-line.serial { stroke: #ff9f7d; stroke-dasharray: 4 4; }
    .link.selected .link-line { stroke: #7fd8b4; stroke-width: 4; }
    .link-label {
      paint-order: stroke;
      stroke: #101315;
      stroke-width: 5;
      fill: #dfe7e2;
      font-family: "Avenir Next", "Segoe UI", sans-serif;
      font-size: 13px;
    }
    .node-card {
      fill: #1b2225;
      stroke: #3b484e;
      stroke-width: 1.5;
    }
    .node.selected .node-card {
      stroke: #7fd8b4;
      stroke-width: 2.5;
    }
    .node.pending .node-card { stroke: #e7c96b; }
    .node-icon {
      font-family: "Avenir Next", "Segoe UI Symbol", sans-serif;
      font-size: 26px;
    }
    .node-title {
      fill: #edf2ee;
      font-family: "Avenir Next", "Segoe UI", sans-serif;
      font-size: 14px;
      font-weight: 800;
    }
    .node-meta {
      fill: #9aa7a1;
      font-family: "Avenir Next", "Segoe UI", sans-serif;
      font-size: 11px;
    }
    .port-dot {
      fill: #7fd8b4;
      opacity: 0.9;
    }
  `;
}

function exportSvgString() {
  const clone = svg.cloneNode(true);
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('width', '1600');
  clone.setAttribute('height', '1000');
  clone.setAttribute('viewBox', '0 0 1600 1000');
  const style = document.createElementNS('http://www.w3.org/2000/svg', 'style');
  style.textContent = exportStyles();
  clone.insertBefore(style, clone.firstChild);
  return `<?xml version="1.0" encoding="UTF-8"?>\n${clone.outerHTML}`;
}

async function exportPng() {
  const data = exportSvgString();
  const blob = new Blob([data], { type: 'image/svg+xml' });
  const url = URL.createObjectURL(blob);
  const image = new Image();
  await new Promise((resolve, reject) => {
    image.onload = resolve;
    image.onerror = reject;
    image.src = url;
  });
  const canvas = document.createElement('canvas');
  canvas.width = 1600;
  canvas.height = 1000;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#111416';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(image, 0, 0);
  URL.revokeObjectURL(url);
  await window.netzwerkplan.exportPng({ dataUrl: canvas.toDataURL('image/png') });
}

function escapeXml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function bindEvents() {
  svg.addEventListener('pointerdown', beginCanvasPointer);
  svg.addEventListener('pointermove', onPointerMove);
  svg.addEventListener('pointerup', endPointer);
  svg.addEventListener('pointercancel', endPointer);
  svg.addEventListener('wheel', (event) => {
    event.preventDefault();
    const before = screenToWorld(event);
    const factor = event.deltaY < 0 ? 1.1 : 0.9;
    state.zoom = Math.min(2.4, Math.max(0.25, state.zoom * factor));
    const rect = svg.getBoundingClientRect();
    state.pan.x = event.clientX - rect.left - before.x * state.zoom;
    state.pan.y = event.clientY - rect.top - before.y * state.zoom;
    updateTransform();
  }, { passive: false });

  byId('selectMode').addEventListener('click', () => {
    state.mode = 'select';
    state.pendingLinkNode = null;
    render();
  });
  byId('connectMode').addEventListener('click', () => {
    state.mode = 'connect';
    state.pendingLinkNode = null;
    setStatus(`${linkTypeById(state.connectionType).status}: erstes Gerät wählen`);
    render();
  });
  byId('connectionType').addEventListener('change', (event) => {
    state.connectionType = event.target.value;
    setStatus(`${linkTypeById(state.connectionType).status} ausgewählt`);
    saveLastProject();
  });
  byId('deleteSelection').addEventListener('click', removeSelection);
  byId('undo').addEventListener('click', undo);
  byId('redo').addEventListener('click', redo);
  byId('checkUpdates').addEventListener('click', async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    setStatus('Suche nach Updates...');

    try {
      const result = await window.netzwerkplan.checkForUpdates();
      if (result.status === 'development') {
        setStatus(result.message);
      } else {
        setStatus('Update-Prüfung läuft');
      }
    } catch (_error) {
      setStatus('Update-Prüfung fehlgeschlagen');
    } finally {
      button.disabled = false;
    }
  });
  byId('zoomIn').addEventListener('click', () => {
    state.zoom = Math.min(2.4, state.zoom * 1.15);
    updateTransform();
  });
  byId('zoomOut').addEventListener('click', () => {
    state.zoom = Math.max(0.25, state.zoom / 1.15);
    updateTransform();
  });
  byId('fitView').addEventListener('click', fitView);

  byId('projectName').addEventListener('change', (event) => {
    pushHistory();
    state.projectName = event.target.value || 'Neuer Netzwerkplan';
    renderInspector();
  });
  byId('projectName').addEventListener('input', (event) => {
    state.projectName = event.target.value || 'Neuer Netzwerkplan';
    saveLastProject();
  });

  [
    ['nodeName', 'name'],
    ['nodeIp', 'ip'],
    ['nodeRole', 'role'],
    ['nodeNote', 'note'],
    ['linkLabel', 'label'],
    ['linkType', 'type']
  ].forEach(([id, field]) => {
    byId(id).addEventListener('change', (event) => mutateSelected(field, event.target.value));
    byId(id).addEventListener('input', (event) => {
      updateSelectedField(field, event.target.value);
      saveLastProject();
    });
  });

  byId('newProject').addEventListener('click', () => {
    pushHistory();
    state.projectName = 'Neuer Netzwerkplan';
    state.filePath = '';
    state.nodes = [];
    state.links = [];
    state.selected = null;
    render();
    setStatus('Neuer Plan erstellt');
  });

  byId('saveProject').addEventListener('click', async () => {
    const result = await window.netzwerkplan.saveProject({
      currentPath: state.filePath,
      project: serializeProject()
    });
    if (!result.canceled) {
      state.filePath = result.filePath;
      setStatus('Gespeichert');
      renderInspector();
    }
  });

  byId('openProject').addEventListener('click', async () => {
    const result = await window.netzwerkplan.openProject();
    if (!result.canceled) {
      state.filePath = result.filePath;
      restore({ ...result.project, filePath: result.filePath });
      setStatus('Projekt geladen');
    }
  });

  byId('exportSvg').addEventListener('click', async () => {
    await window.netzwerkplan.exportText({
      title: 'Als SVG exportieren',
      defaultPath: 'netzwerkplan.svg',
      filters: [{ name: 'SVG', extensions: ['svg'] }],
      contents: exportSvgString()
    });
  });
  byId('exportPng').addEventListener('click', exportPng);

  window.addEventListener('keydown', (event) => {
    const mod = event.metaKey || event.ctrlKey;
    if (mod && event.key.toLowerCase() === 'z' && !event.shiftKey) undo();
    if ((mod && event.key.toLowerCase() === 'y') || (mod && event.shiftKey && event.key.toLowerCase() === 'z')) redo();
    if (event.key === 'Escape') {
      state.pendingLinkNode = null;
      state.mode = 'select';
      render();
    }
  });
  window.addEventListener('beforeunload', () => {
    syncInspectorDraft();
    saveLastProject();
  });
}

function seedProject() {
  state.nodes = [
    { id: 'node-router', type: 'router', name: 'Edge Router', ip: '10.0.0.1', role: 'WAN', note: '', x: 160, y: 120 },
    { id: 'node-firewall', type: 'firewall', name: 'Firewall', ip: '10.0.0.2', role: 'Security', note: '', x: 390, y: 120 },
    { id: 'node-switch', type: 'switch', name: 'Core Switch', ip: '10.0.1.1', role: 'Core', note: '', x: 620, y: 120 },
    { id: 'node-server', type: 'server', name: 'Server', ip: '10.0.2.20', role: 'Services', note: '', x: 620, y: 270 },
    { id: 'node-pc', type: 'pc', name: 'Clients', ip: '10.0.10.0/24', role: 'LAN', note: '', x: 850, y: 120 }
  ];
  state.links = [
    { id: 'link-1', from: 'node-router', to: 'node-firewall', label: 'WAN', type: 'ethernet' },
    { id: 'link-2', from: 'node-firewall', to: 'node-switch', label: 'Trunk', type: 'fiber' },
    { id: 'link-3', from: 'node-switch', to: 'node-server', label: 'VLAN 20', type: 'ethernet' },
    { id: 'link-4', from: 'node-switch', to: 'node-pc', label: 'VLAN 10', type: 'ethernet' }
  ];
}

renderPalette();
renderConnectionTypes();
bindEvents();
const lastProject = loadLastProject();
if (lastProject) {
  restore(lastProject);
  setStatus('Letzten Stand geladen');
} else {
  seedProject();
  render();
  requestAnimationFrame(fitView);
}
