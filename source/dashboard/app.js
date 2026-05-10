const REFRESH_INTERVAL_MS = 10000;

const els = {
  botStatus: document.getElementById('botStatus'),
  knowledgeStatus: document.getElementById('knowledgeStatus'),
  kpiTickets: document.getElementById('kpiTickets'),
  kpiQuestions: document.getElementById('kpiQuestions'),
  kpiReplies: document.getElementById('kpiReplies'),
  kpiEscalations: document.getElementById('kpiEscalations'),
  lastRefreshed: document.getElementById('lastRefreshed'),
  refreshBtn: document.getElementById('refreshBtn'),
  ticketList: document.getElementById('ticketList'),
  ticketPane: document.getElementById('ticketPane'),
  search: document.getElementById('search'),
  statusFilter: document.getElementById('statusFilter'),
};

const state = {
  tickets: [],
  selectedId: null,
  selectedTicket: null,
  search: '',
  statusFilter: '',
};

function fmtRelative(iso) {
  if (!iso) return '';
  const date = new Date(iso);
  const diff = Date.now() - date.getTime();
  const sec = Math.round(diff / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  return `${day}d ago`;
}

function fmtDateTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

async function fetchHealth() {
  try {
    const res = await fetch('/api/health');
    if (!res.ok) throw new Error('health failed');
    const data = await res.json();
    if (data.botReady && data.aiEnabled) {
      els.botStatus.className = 'brand-sub ok';
      els.botStatus.textContent = 'Bot online · AI active';
    } else if (data.botReady) {
      els.botStatus.className = 'brand-sub warn';
      els.botStatus.textContent = 'Bot online · AI disabled';
    } else {
      els.botStatus.className = 'brand-sub bad';
      els.botStatus.textContent = 'Bot offline';
    }
    if (els.knowledgeStatus) {
      if (data.knowledgeBuilding) {
        els.knowledgeStatus.textContent = 'Knowledge: indexing…';
      } else if (data.knowledge) {
        const k = data.knowledge;
        els.knowledgeStatus.textContent = `Knowledge: ${k.channelCount} channels · ${k.charCount} chars · ${fmtRelative(k.generatedAt)}`;
      } else {
        els.knowledgeStatus.textContent = 'Knowledge: not indexed yet';
      }
    }
  } catch {
    els.botStatus.className = 'brand-sub bad';
    els.botStatus.textContent = 'Dashboard offline';
  }
}

async function fetchTickets() {
  try {
    const res = await fetch('/api/tickets');
    if (!res.ok) throw new Error('tickets failed');
    const data = await res.json();
    state.tickets = data.tickets || [];
    els.kpiTickets.textContent = data.totals?.tickets ?? 0;
    els.kpiQuestions.textContent = data.totals?.userMessages ?? 0;
    els.kpiReplies.textContent = data.totals?.aiReplies ?? 0;
    els.kpiEscalations.textContent = data.totals?.escalations ?? 0;
    renderTicketList();
    els.lastRefreshed.textContent = `Updated ${new Date().toLocaleTimeString()}`;
  } catch (err) {
    console.warn('fetch tickets failed', err);
  }
}

function getFilteredTickets() {
  const q = state.search.trim().toLowerCase();
  const sf = state.statusFilter;
  return state.tickets.filter((t) => {
    if (sf && t.status !== sf) return false;
    if (q && !(t.channelName || '').toLowerCase().includes(q)) return false;
    return true;
  });
}

function renderTicketList() {
  const tickets = getFilteredTickets();
  if (tickets.length === 0) {
    els.ticketList.innerHTML = '<div class="empty">No tickets match your filters.</div>';
    return;
  }
  els.ticketList.innerHTML = tickets
    .map((t) => {
      const status = t.status || 'active';
      const statusLabel = status === 'ai_paused' ? 'AI paused' : status;
      const isActive = state.selectedId === t.channelId ? 'active' : '';
      return `
        <div class="ticket-card ${isActive}" data-id="${escapeHtml(t.channelId)}">
          <div class="ticket-name">
            <span title="${escapeHtml(t.channelName)}">#${escapeHtml(t.channelName)}</span>
            <span class="badge ${status}">${escapeHtml(statusLabel)}</span>
          </div>
          <div class="ticket-stats">
            <span>${t.stats?.userMessages ?? 0} questions</span>
            <span>·</span>
            <span>${t.stats?.aiReplies ?? 0} replies</span>
            ${t.stats?.escalations ? `<span>·</span><span style="color:var(--red)">${t.stats.escalations} escalation${t.stats.escalations > 1 ? 's' : ''}</span>` : ''}
          </div>
          <div class="ticket-meta">
            <span>${fmtRelative(t.lastMessageAt)}</span>
            <span>${t.messageCount} msgs</span>
          </div>
        </div>
      `;
    })
    .join('');

  els.ticketList.querySelectorAll('.ticket-card').forEach((card) => {
    card.addEventListener('click', () => selectTicket(card.dataset.id));
  });
}

async function selectTicket(channelId) {
  state.selectedId = channelId;
  renderTicketList();
  els.ticketPane.innerHTML = '<div class="empty-pane"><div class="empty-pane-title"><span class="spinner"></span> Loading conversation…</div></div>';
  try {
    const res = await fetch(`/api/tickets/${encodeURIComponent(channelId)}`);
    if (!res.ok) throw new Error('not found');
    state.selectedTicket = await res.json();
    renderTicketDetail();
  } catch (err) {
    els.ticketPane.innerHTML = '<div class="empty-pane"><div class="empty-pane-title">Could not load ticket</div></div>';
  }
}

function renderTicketDetail() {
  const t = state.selectedTicket;
  if (!t) return;
  const status = t.status || 'active';
  const statusLabel = status === 'ai_paused' ? 'AI paused' : status;
  const userList = t.userIds && t.userIds.length
    ? `<span class="user-list">User IDs: ${t.userIds.map(escapeHtml).join(', ')}</span>`
    : '';
  const messages = (t.messages || []).map(renderMessage).join('');

  els.ticketPane.innerHTML = `
    <div class="ticket-header">
      <div class="ticket-header-top">
        <div class="ticket-header-title">#${escapeHtml(t.channelName)}</div>
        <span class="badge ${status}">${escapeHtml(statusLabel)}</span>
      </div>
      <div class="ticket-header-meta">
        <span>Created ${fmtDateTime(t.createdAt)}</span>
        <span>Last activity ${fmtRelative(t.lastMessageAt)}</span>
        <span>${t.stats?.userMessages ?? 0} questions · ${t.stats?.aiReplies ?? 0} AI replies · ${t.stats?.escalations ?? 0} escalations</span>
      </div>
      ${userList}
    </div>
    <div class="conversation" id="conversation">
      ${messages || '<div class="empty">No messages yet.</div>'}
    </div>
  `;
  const convo = document.getElementById('conversation');
  if (convo) convo.scrollTop = convo.scrollHeight;
}

function renderMessage(msg) {
  if (msg.role === 'event') {
    const evt = msg.eventType || 'event';
    return `
      <div class="event-line ${evt}">
        ${escapeHtml(msg.content || evt)} · ${fmtDateTime(msg.createdAt)}
      </div>
    `;
  }
  const role = msg.role === 'staff' ? 'staff' : msg.role === 'assistant' ? 'assistant' : 'user';
  const author = msg.authorName || (role === 'assistant' ? 'AI' : role === 'staff' ? 'Staff' : 'User');
  return `
    <div class="bubble ${role}">
      <div class="author">${escapeHtml(author)}${role === 'assistant' ? ' · AI' : role === 'staff' ? ' · staff' : ''}</div>
      <div class="content">${escapeHtml(msg.content || '')}</div>
      <div class="ts">${fmtDateTime(msg.createdAt)}</div>
    </div>
  `;
}

els.refreshBtn.addEventListener('click', () => {
  fetchHealth();
  fetchTickets().then(() => {
    if (state.selectedId) selectTicket(state.selectedId);
  });
});

els.search.addEventListener('input', (e) => {
  state.search = e.target.value;
  renderTicketList();
});
els.statusFilter.addEventListener('change', (e) => {
  state.statusFilter = e.target.value;
  renderTicketList();
});

async function tick() {
  await fetchHealth();
  await fetchTickets();
  if (state.selectedId) {
    try {
      const res = await fetch(`/api/tickets/${encodeURIComponent(state.selectedId)}`);
      if (res.ok) {
        state.selectedTicket = await res.json();
        renderTicketDetail();
      }
    } catch {}
  }
}

tick();
setInterval(tick, REFRESH_INTERVAL_MS);
