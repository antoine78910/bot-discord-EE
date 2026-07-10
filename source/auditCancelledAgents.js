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
  formatAuditReport,
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
