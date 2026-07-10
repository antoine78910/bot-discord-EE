/**
 * Audit Ecom Agent Discord members against legacy Stripe (Sublaunch).
 * Shared by bot slash command and CLI: node bot/auditCancelledAgents.js
 */
const Stripe = require('stripe');

const ECOM_AGENT_ROLE_ID = String(process.env.DISCORD_ECOM_AGENT_ROLE_ID || '1244916325294542858').trim();

function pickDiscordIdFromMetadata(meta) {
  if (!meta || typeof meta !== 'object') return null;
  const keys = ['discord_user_id', 'discord_id', 'discordUserId', 'discordId'];
  for (const k of keys) {
    const v = String(meta[k] || '').trim();
    if (/^\d{17,20}$/.test(v)) return v;
  }
  return null;
}

function isBadLegacySub(sub) {
  if (!sub) return false;
  if (sub.status === 'canceled') return true;
  if (sub.cancel_at_period_end) return true;
  return false;
}

function hasActiveLegacySub(sub) {
  if (!sub) return false;
  if (sub.status === 'active' || sub.status === 'trialing') {
    return !sub.cancel_at_period_end;
  }
  return false;
}

function subEntryFromStripeSub(sub) {
  const customer = typeof sub.customer === 'object' ? sub.customer : null;
  const customerId = customer?.id || (typeof sub.customer === 'string' ? sub.customer : null);
  const email = String(customer?.email || '').trim().toLowerCase() || null;
  const discordId = pickDiscordIdFromMetadata(customer?.metadata);
  return {
    subscriptionId: sub.id,
    status: sub.status,
    cancelAtPeriodEnd: Boolean(sub.cancel_at_period_end),
    created: sub.created,
    currentPeriodEnd: sub.current_period_end
      ? new Date(sub.current_period_end * 1000).toISOString()
      : null,
    customerId,
    email,
    discordId,
  };
}

function upsertLatest(map, key, entry) {
  if (!key || !entry) return;
  const prev = map.get(key);
  if (!prev || entry.created > prev.created) {
    map.set(key, entry);
  }
}

async function listAllLegacySubscriptions(stripe) {
  const subs = [];
  let startingAfter;
  while (true) {
    const page = await stripe.subscriptions.list({
      status: 'all',
      limit: 100,
      expand: ['data.customer'],
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    });
    subs.push(...page.data);
    if (!page.has_more) break;
    startingAfter = page.data[page.data.length - 1].id;
  }
  return subs;
}

async function listAllLegacyCustomers(stripe) {
  const customers = [];
  let startingAfter;
  while (true) {
    const page = await stripe.customers.list({
      limit: 100,
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    });
    customers.push(...page.data);
    if (!page.has_more) break;
    startingAfter = page.data[page.data.length - 1].id;
  }
  return customers;
}

function normalizeEmailLocal(email) {
  const local = String(email || '').split('@')[0].toLowerCase().replace(/\./g, '');
  return local;
}

function normalizeUsername(username) {
  return String(username || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function emailLocalMatchesUsername(email, username) {
  const local = normalizeEmailLocal(email);
  const user = normalizeUsername(username);
  if (!local || !user) return false;
  if (local === user) return true;
  // Gmail-style: username may omit dots that appear in the email local part.
  if (local.replace(/\./g, '') === user) return true;
  return false;
}

async function listSupabaseUsersByEmail() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return [];

  let createClient;
  try {
    ({ createClient } = require('@supabase/supabase-js'));
  } catch {
    return [];
  }

  const supabase = createClient(url, key, { auth: { persistSession: false } });
  const rows = [];
  let page = 1;
  const perPage = 200;

  while (true) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage });
    if (error) break;
    const users = data?.users || [];
    if (!users.length) break;

    for (const u of users) {
      const email = String(u.email || '').trim().toLowerCase();
      if (!email) continue;
      rows.push({
        email,
        discordId: pickDiscordIdFromMetadata(u.user_metadata || {}),
      });
    }

    if (users.length < perPage) break;
    page += 1;
  }

  return rows;
}

function findEmailsForAgent(agent, supabaseUsers) {
  const matches = [];
  for (const row of supabaseUsers) {
    if (row.discordId && row.discordId === agent.id) {
      matches.push({ email: row.email, via: 'supabase_discord_id' });
      continue;
    }
    if (emailLocalMatchesUsername(row.email, agent.username)) {
      matches.push({ email: row.email, via: 'username_email_match' });
    }
  }
  const deduped = new Map();
  for (const m of matches) {
    if (!deduped.has(m.email)) deduped.set(m.email, m);
  }
  return [...deduped.values()];
}

function escapeEmailForStripeSearch(email) {
  return String(email || '').trim().replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function stripeCustomerSearchEmailVariants(raw) {
  const s = String(raw || '').trim();
  if (!s) return [];
  const lower = s.toLowerCase();
  const out = [];
  const push = (e) => {
    const t = e.trim();
    if (!t) return;
    if (!out.some((x) => x.toLowerCase() === t.toLowerCase())) out.push(t);
  };
  push(s);
  if (lower !== s) push(lower);
  const m = lower.match(/^([^@]+)@(gmail|googlemail)\.com$/);
  if (m) {
    const local = m[1];
    const noDots = local.replace(/\./g, '');
    for (const dom of ['gmail.com', 'googlemail.com']) {
      push(`${local}@${dom}`);
      push(`${noDots}@${dom}`);
    }
  }
  return out;
}

async function searchCustomersByEmailMerged(stripe, email) {
  const variants = stripeCustomerSearchEmailVariants(email);
  const byId = new Map();
  for (const variant of variants) {
    const q = escapeEmailForStripeSearch(variant);
    if (!q) continue;
    let page;
    for (;;) {
      const res = await stripe.customers.search({
        query: `email:'${q}'`,
        limit: 100,
        ...(page ? { page } : {}),
      });
      for (const c of res.data || []) {
        if (c.id) byId.set(c.id, c);
      }
      page = res.next_page;
      if (!page) break;
    }
  }
  return [...byId.values()];
}

async function lookupLegacyStripeForEmail(stripe, email) {
  const normalized = String(email || '').trim().toLowerCase();
  if (!normalized || !normalized.includes('@')) {
    return { found: false, email: normalized || null };
  }

  const customers = await searchCustomersByEmailMerged(stripe, normalized);
  if (!customers.length) {
    return { found: false, email: normalized };
  }

  let best = null;
  for (const customer of customers) {
    if (!customer.id) continue;
    const subs = await stripe.subscriptions.list({ customer: customer.id, status: 'all', limit: 100 });
    const sorted = [...subs.data].sort((a, b) => b.created - a.created);
    for (const sub of sorted) {
      const entry = subEntryFromStripeSub({ ...sub, customer });
      if (!best || entry.created > best.created) best = entry;
      break;
    }
  }

  if (!best) {
    return { found: false, email: normalized, customerId: customers[0]?.id || null };
  }

  return {
    found: true,
    email: normalized,
    customerId: best.customerId,
    subscriptionId: best.subscriptionId,
    status: best.status,
    cancelAtPeriodEnd: best.cancelAtPeriodEnd,
    currentPeriodEnd: best.currentPeriodEnd,
    isCanceled: isBadLegacySub({ status: best.status, cancel_at_period_end: best.cancelAtPeriodEnd }),
    isActive: hasActiveLegacySub({ status: best.status, cancel_at_period_end: best.cancelAtPeriodEnd }),
  };
}

function parseCsvLine(line) {
  const cells = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      continue;
    }
    if (ch === ',') {
      cells.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  cells.push(cur);
  return cells.map((c) => c.trim());
}

function parseCsv(text) {
  const raw = String(text || '').replace(/^\uFEFF/, '');
  const lines = raw.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (!lines.length) return { headers: [], rows: [] };

  const headers = parseCsvLine(lines[0]);
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = parseCsvLine(lines[i]);
    const row = {};
    for (let j = 0; j < headers.length; j++) {
      row[headers[j]] = cells[j] ?? '';
    }
    rows.push(row);
  }
  return { headers, rows };
}

function normalizeHeaderKey(header) {
  return String(header || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function pickColumnName(headers, candidates) {
  const byNorm = new Map(headers.map((h) => [normalizeHeaderKey(h), h]));
  for (const candidate of candidates) {
    const hit = byNorm.get(candidate);
    if (hit) return hit;
  }
  for (const header of headers) {
    const norm = normalizeHeaderKey(header);
    if (candidates.some((c) => norm.includes(c) || c.includes(norm))) return header;
  }
  return null;
}

function pickExactColumn(headers, expectedName) {
  const target = normalizeHeaderKey(expectedName);
  return headers.find((h) => normalizeHeaderKey(h) === target) || null;
}

function extractDiscordId(value) {
  const s = String(value || '').trim();
  const m = s.match(/\d{17,20}/);
  return m ? m[0] : null;
}

async function lookupLegacyStripeForCustomerId(stripe, customerId) {
  const id = String(customerId || '').trim();
  if (!id) {
    return { found: false, customerId: null };
  }

  try {
    const customer = await stripe.customers.retrieve(id);
    const subs = await stripe.subscriptions.list({ customer: id, status: 'all', limit: 100 });
    const sorted = [...subs.data].sort((a, b) => b.created - a.created);
    if (!sorted.length) {
      return {
        found: false,
        customerId: id,
        email: String(customer.email || '').trim().toLowerCase() || null,
      };
    }

    const best = subEntryFromStripeSub({ ...sorted[0], customer });
    return {
      found: true,
      customerId: id,
      email: best.email || String(customer.email || '').trim().toLowerCase() || null,
      subscriptionId: best.subscriptionId,
      status: best.status,
      cancelAtPeriodEnd: best.cancelAtPeriodEnd,
      currentPeriodEnd: best.currentPeriodEnd,
      isCanceled: isBadLegacySub({ status: best.status, cancel_at_period_end: best.cancelAtPeriodEnd }),
      isActive: hasActiveLegacySub({ status: best.status, cancel_at_period_end: best.cancelAtPeriodEnd }),
    };
  } catch {
    return { found: false, customerId: id };
  }
}

function normalizeCsvCancelStatus(value) {
  const s = String(value || '').trim().toLowerCase();
  if (!s) return '';
  if (s === 'cancelled' || s === 'canceled') return 'canceled';
  if (s === 'active') return 'active';
  if (/(cancel_at_period_end|cancel at period end|pending_cancel|pending cancel)/.test(s)) {
    return 'cancel_at_period_end';
  }
  return s;
}

function csvStatusMatchesStripe(csvStatus, stripeResult) {
  if (!csvStatus || !stripeResult?.found) return '';
  const csvCanceled = csvStatus === 'canceled' || csvStatus === 'cancel_at_period_end';
  const csvActive = csvStatus === 'active';
  if (csvCanceled && stripeResult.isCanceled) return 'yes';
  if (csvActive && stripeResult.isActive) return 'yes';
  if (csvCanceled && stripeResult.isActive) return 'no';
  if (csvActive && stripeResult.isCanceled) return 'no';
  return 'partial';
}

function csvEscape(value) {
  const s = String(value ?? '');
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function rowsToCsv(headers, rows) {
  const lines = [headers.map(csvEscape).join(',')];
  for (const row of rows) {
    lines.push(headers.map((h) => csvEscape(row[h] ?? '')).join(','));
  }
  return lines.join('\n');
}

async function mapWithConcurrency(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, limit) }, async () => {
    while (true) {
      const idx = next++;
      if (idx >= items.length) break;
      out[idx] = await fn(items[idx], idx);
    }
  });
  await Promise.all(workers);
  return out;
}

const DISCORD_ID_COLUMN_CANDIDATES = ['discordid', 'discord_id', 'discord_user_id'];
const STATUS_COLUMN_CANDIDATES = ['status', 'subscription_status'];
const CUSTOMER_STRIPE_ID_COLUMN_CANDIDATES = ['customerstripeid', 'customer_stripe_id', 'stripe_customer_id'];

const AUDIT_OUTPUT_COLUMNS = [
  'audit_discord_id',
  'audit_csv_status',
  'audit_csv_status_normalized',
  'audit_customer_stripe_id',
  'audit_discord_in_guild',
  'audit_discord_username',
  'audit_has_ecom_agent_role',
  'audit_stripe_found',
  'audit_stripe_status',
  'audit_stripe_cancel_at_period_end',
  'audit_stripe_period_end',
  'audit_stripe_subscription_id',
  'audit_stripe_email',
  'audit_csv_matches_stripe',
  'audit_is_ghost_agent',
  'audit_notes',
];

/**
 * @param {import('discord.js').Guild} guild
 * @param {string} csvText
 */
async function runCsvCancelledAgentsAudit(guild, csvText) {
  const legacyKey = process.env.STRIPE_SECRET_KEY_LEGACY;
  if (!legacyKey) {
    throw new Error('STRIPE_SECRET_KEY_LEGACY is not configured');
  }

  const parsed = parseCsv(csvText);
  if (!parsed.rows.length) {
    throw new Error('CSV is empty or has no data rows');
  }

  const discordCol =
    pickExactColumn(parsed.headers, 'discordId') ||
    pickColumnName(parsed.headers, DISCORD_ID_COLUMN_CANDIDATES);
  const statusCol =
    pickExactColumn(parsed.headers, 'status') ||
    pickColumnName(parsed.headers, STATUS_COLUMN_CANDIDATES);
  const customerStripeCol =
    pickExactColumn(parsed.headers, 'customerStripeId') ||
    pickColumnName(parsed.headers, CUSTOMER_STRIPE_ID_COLUMN_CANDIDATES);

  if (!discordCol || !statusCol || !customerStripeCol) {
    throw new Error(
      'CSV must include columns: discordId, status (cancelled|active), customerStripeId.'
    );
  }

  const stripe = new Stripe(legacyKey, { apiVersion: '2025-08-27.basil' });
  const stripeCache = new Map();

  async function getStripeForCustomerId(customerId) {
    const key = String(customerId || '').trim();
    if (!key) return { found: false, customerId: null };
    if (stripeCache.has(key)) return stripeCache.get(key);
    const result = await lookupLegacyStripeForCustomerId(stripe, key);
    stripeCache.set(key, result);
    return result;
  }

  const enriched = await mapWithConcurrency(parsed.rows, 4, async (sourceRow) => {
    const out = { ...sourceRow };
    const discordId = extractDiscordId(sourceRow[discordCol]);
    const customerStripeId = String(sourceRow[customerStripeCol] || '').trim();
    const csvStatusRaw = String(sourceRow[statusCol] || '').trim();
    const csvStatus = normalizeCsvCancelStatus(csvStatusRaw);

    let discordInGuild = 'no';
    let discordUsername = '';
    let hasEcomAgentRole = 'no';
    const notes = [];

    if (discordId) {
      try {
        const member = await guild.members.fetch(discordId);
        discordInGuild = 'yes';
        discordUsername = member.user.username || '';
        hasEcomAgentRole = member.roles.cache.has(ECOM_AGENT_ROLE_ID) ? 'yes' : 'no';
      } catch {
        discordInGuild = 'no';
        hasEcomAgentRole = 'no';
        notes.push('discord_member_not_found');
      }
    } else {
      notes.push('missing_discord_id');
    }

    let stripeResult = { found: false };
    if (customerStripeId) {
      stripeResult = await getStripeForCustomerId(customerStripeId);
      if (!stripeResult.found) notes.push('stripe_customer_not_found');
    } else {
      notes.push('missing_customer_stripe_id');
    }

    const stripeCanceled = Boolean(stripeResult.found && stripeResult.isCanceled);
    const csvCanceled = csvStatus === 'canceled' || csvStatus === 'cancel_at_period_end';
    const statusMatch = csvStatusMatchesStripe(csvStatus, stripeResult);

    const isGhost = hasEcomAgentRole === 'yes' && stripeCanceled ? 'yes' : 'no';

    if (isGhost === 'yes') {
      notes.push('ghost_agent');
    }
    if (statusMatch === 'no') {
      notes.push('csv_status_mismatch_stripe');
    }
    if (csvCanceled && hasEcomAgentRole === 'yes') {
      notes.push('cancelled_still_has_role');
    }

    out.audit_discord_id = discordId || '';
    out.audit_csv_status = csvStatusRaw;
    out.audit_csv_status_normalized = csvStatus;
    out.audit_customer_stripe_id = customerStripeId;
    out.audit_discord_in_guild = discordInGuild;
    out.audit_discord_username = discordUsername;
    out.audit_has_ecom_agent_role = hasEcomAgentRole;
    out.audit_stripe_found = stripeResult.found ? 'yes' : 'no';
    out.audit_stripe_status = stripeResult.status || '';
    out.audit_stripe_cancel_at_period_end = stripeResult.found
      ? stripeResult.cancelAtPeriodEnd
        ? 'yes'
        : 'no'
      : '';
    out.audit_stripe_period_end = stripeResult.currentPeriodEnd || '';
    out.audit_stripe_subscription_id = stripeResult.subscriptionId || '';
    out.audit_stripe_email = stripeResult.email || '';
    out.audit_csv_matches_stripe = statusMatch;
    out.audit_is_ghost_agent = isGhost;
    out.audit_notes = notes.join(';');

    return out;
  });

  const ghostCount = enriched.filter((r) => r.audit_is_ghost_agent === 'yes').length;
  const stillHasRoleCount = enriched.filter((r) => r.audit_has_ecom_agent_role === 'yes').length;
  const stripeCanceledCount = enriched.filter(
    (r) =>
      r.audit_stripe_found === 'yes' &&
      (r.audit_stripe_status === 'canceled' || r.audit_stripe_cancel_at_period_end === 'yes')
  ).length;
  const csvCancelledCount = enriched.filter((r) => r.audit_csv_status_normalized === 'canceled').length;
  const mismatchCount = enriched.filter((r) => r.audit_csv_matches_stripe === 'no').length;

  const outputHeaders = [...parsed.headers];
  for (const col of AUDIT_OUTPUT_COLUMNS) {
    if (!outputHeaders.includes(col)) outputHeaders.push(col);
  }

  return {
    scannedAt: new Date().toISOString(),
    rowCount: enriched.length,
    ghostCount,
    stillHasRoleCount,
    stripeCanceledCount,
    csvCancelledCount,
    mismatchCount,
    detectedColumns: { discordCol, statusCol, customerStripeCol },
    rows: enriched,
    csv: rowsToCsv(outputHeaders, enriched),
  };
}

function formatCsvAuditSummary(result) {
  const lines = [];
  lines.push(`**CSV ghost agent audit** (${result.scannedAt})`);
  lines.push(`Rows processed: **${result.rowCount}**`);
  lines.push(`Detected columns: discordId=\`${result.detectedColumns.discordCol}\`, status=\`${result.detectedColumns.statusCol}\`, customerStripeId=\`${result.detectedColumns.customerStripeCol}\``);
  lines.push(`Still have Ecom Agent role: **${result.stillHasRoleCount}**`);
  lines.push(`CSV status cancelled (rows): **${result.csvCancelledCount}**`);
  lines.push(`Stripe canceled / end-of-period: **${result.stripeCanceledCount}**`);
  lines.push(`CSV vs Stripe mismatches: **${result.mismatchCount}**`);
  lines.push(`**Ghost agents (canceled + still have role): ${result.ghostCount}**`);
  lines.push('');
  lines.push('Full results are attached as CSV (`audit-ghost-agents-*.csv`).');
  return lines.join('\n');
}

/**
 * @param {import('discord.js').Guild} guild
 */
async function runCancelledAgentsAudit(guild) {
  const legacyKey = process.env.STRIPE_SECRET_KEY_LEGACY;
  if (!legacyKey) {
    throw new Error('STRIPE_SECRET_KEY_LEGACY is not configured');
  }

  const stripe = new Stripe(legacyKey, { apiVersion: '2025-08-27.basil' });

  await guild.members.fetch();
  const agents = guild.members.cache.filter((m) => m.roles.cache.has(ECOM_AGENT_ROLE_ID));
  const agentById = new Map(
    [...agents.values()].map((m) => [
      m.id,
      {
        id: m.id,
        username: m.user.username,
        globalName: m.user.globalName || null,
        nick: m.nickname || null,
      },
    ])
  );

  const legacySubs = await listAllLegacySubscriptions(stripe);
  const discordIdToSub = new Map();
  const emailToSub = new Map();

  for (const sub of legacySubs) {
    const entry = subEntryFromStripeSub(sub);
    if (entry.discordId) upsertLatest(discordIdToSub, entry.discordId, entry);
    if (entry.email) upsertLatest(emailToSub, entry.email, entry);
  }

  const legacyCustomers = await listAllLegacyCustomers(stripe);
  const customerEmailByDiscordId = new Map();
  for (const c of legacyCustomers) {
    const discordId = pickDiscordIdFromMetadata(c.metadata);
    const email = String(c.email || '').trim().toLowerCase();
    if (discordId && email) customerEmailByDiscordId.set(discordId, email);
    if (discordId && emailToSub.has(email)) {
      upsertLatest(discordIdToSub, discordId, emailToSub.get(email));
    }
  }

  const supabaseUsers = await listSupabaseUsersByEmail();

  const ghosts = [];
  const activeOk = [];
  const noStripeMatch = [];
  const ambiguous = [];

  for (const agent of agentById.values()) {
    let subEntry = discordIdToSub.get(agent.id);
    let matchVia = subEntry ? 'stripe_discord_metadata' : null;

    if (!subEntry) {
      const bridgedEmail = customerEmailByDiscordId.get(agent.id);
      if (bridgedEmail && emailToSub.has(bridgedEmail)) {
        subEntry = emailToSub.get(bridgedEmail);
        matchVia = 'customer_discord_metadata';
      }
    }

    if (!subEntry) {
      const supabaseDiscordEmail = findEmailsForAgent(agent, supabaseUsers).find(
        (m) => m.via === 'supabase_discord_id'
      )?.email;
      if (supabaseDiscordEmail && emailToSub.has(supabaseDiscordEmail)) {
        subEntry = emailToSub.get(supabaseDiscordEmail);
        matchVia = 'supabase_discord_id';
      }
    }

    if (!subEntry) {
      const emailMatches = findEmailsForAgent(agent, supabaseUsers);
      const linked = emailMatches
        .map((m) => ({ ...m, sub: emailToSub.get(m.email) }))
        .filter((m) => m.sub);

      if (linked.length === 1) {
        subEntry = linked[0].sub;
        matchVia = linked[0].via;
      } else if (linked.length > 1) {
        ambiguous.push({
          ...agent,
          candidates: linked.map((l) => ({
            email: l.email,
            via: l.via,
            stripeStatus: l.sub.status,
            cancelAtPeriodEnd: l.sub.cancelAtPeriodEnd,
          })),
        });
        continue;
      }
    }

    if (!subEntry) {
      // Last resort: legacy Stripe customer email local part matches Discord username.
      for (const [email, sub] of emailToSub.entries()) {
        if (emailLocalMatchesUsername(email, agent.username)) {
          subEntry = sub;
          matchVia = 'legacy_stripe_username_match';
          break;
        }
      }
    }

    if (!subEntry) {
      noStripeMatch.push({ ...agent, matchVia: 'no_stripe_link' });
      continue;
    }

    const row = {
      ...agent,
      matchVia,
      email: subEntry.email,
      customerId: subEntry.customerId,
      subscriptionId: subEntry.subscriptionId,
      stripeStatus: subEntry.status,
      cancelAtPeriodEnd: subEntry.cancelAtPeriodEnd,
      currentPeriodEnd: subEntry.currentPeriodEnd,
    };

    if (isBadLegacySub({ status: subEntry.status, cancel_at_period_end: subEntry.cancelAtPeriodEnd })) {
      ghosts.push(row);
    } else if (hasActiveLegacySub({ status: subEntry.status, cancel_at_period_end: subEntry.cancelAtPeriodEnd })) {
      activeOk.push(row);
    } else {
      noStripeMatch.push({ ...row, matchVia: `${matchVia}_unclear` });
    }
  }

  return {
    scannedAt: new Date().toISOString(),
    agentCount: agentById.size,
    legacySubscriptionCount: legacySubs.length,
    activeOkCount: activeOk.length,
    ghostCount: ghosts.length,
    noStripeMatchCount: noStripeMatch.length,
    ambiguousCount: ambiguous.length,
    ghosts: ghosts.sort((a, b) => (a.username || '').localeCompare(b.username || '')),
    noStripeMatch: noStripeMatch.sort((a, b) => (a.username || '').localeCompare(b.username || '')),
    ambiguous,
  };
}

function formatAuditReport(result) {
  const lines = [];
  lines.push(`**Ghost Ecom Agent audit** (${result.scannedAt})`);
  lines.push(`Agents with role: **${result.agentCount}**`);
  lines.push(`Legacy Stripe subs scanned: **${result.legacySubscriptionCount}**`);
  lines.push(`Active OK: **${result.activeOkCount}**`);
  lines.push(`**Ghost (canceled / end-of-period): ${result.ghostCount}**`);
  lines.push(`No Stripe link: **${result.noStripeMatchCount}**`);
  if (result.ambiguousCount) {
    lines.push(`Ambiguous email match: **${result.ambiguousCount}**`);
  }

  if (result.ghosts.length) {
    lines.push('');
    lines.push('**Ghost agents** (still have role):');
    for (const g of result.ghosts.slice(0, 25)) {
      const cancelNote = g.cancelAtPeriodEnd ? 'cancel_at_period_end' : g.stripeStatus;
      lines.push(
        `• <@${g.id}> (\`${g.username}\`) — ${g.email || 'no email'} — \`${cancelNote}\`${g.currentPeriodEnd ? ` until ${g.currentPeriodEnd.slice(0, 10)}` : ''}`
      );
    }
    if (result.ghosts.length > 25) {
      lines.push(`… and ${result.ghosts.length - 25} more (see CLI JSON export).`);
    }
  } else {
    lines.push('');
    lines.push('No ghost agents found among Stripe-linked members.');
  }

  if (result.noStripeMatchCount > 0) {
    lines.push('');
    lines.push(`**${result.noStripeMatchCount}** agents have no legacy Stripe link (manual check).`);
  }

  return lines.join('\n');
}

module.exports = {
  ECOM_AGENT_ROLE_ID,
  runCancelledAgentsAudit,
  runCsvCancelledAgentsAudit,
  formatAuditReport,
  formatCsvAuditSummary,
};

if (require.main === module) {
  const path = require('path');
  const fs = require('fs');
  let dotenv;
  try {
    dotenv = require('dotenv');
  } catch {}

  const candidates = [
    path.resolve(__dirname, '.env.local'),
    path.resolve(__dirname, '.env'),
    path.resolve(__dirname, '..', '.env.local'),
    path.resolve(__dirname, '..', '.env'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p) && dotenv?.config) dotenv.config({ path: p });
  }

  const { Client, GatewayIntentBits } = require('discord.js');
  const token = process.env.DISCORD_BOT_TOKEN;
  const guildId = process.env.DISCORD_GUILD_ID || process.env.DISCORD_SERVER_ID;

  if (!token || !guildId) {
    console.error('Missing DISCORD_BOT_TOKEN or DISCORD_GUILD_ID / DISCORD_SERVER_ID');
    process.exit(1);
  }

  const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers] });
  client.once('ready', async () => {
    try {
      const guild = await client.guilds.fetch(guildId);
      const result = await runCancelledAgentsAudit(guild);
      console.log(formatAuditReport(result).replace(/\*\*/g, ''));
      if (result.ghosts.length) {
        console.log('\nJSON ghosts:');
        console.log(JSON.stringify(result.ghosts, null, 2));
      }
    } catch (e) {
      console.error(e);
      process.exitCode = 1;
    } finally {
      client.destroy();
    }
  });
  client.login(token);
}
