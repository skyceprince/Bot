const Database = require('better-sqlite3');
const db = new Database('farm.sqlite');

db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  username TEXT NOT NULL,
  mode TEXT NOT NULL CHECK(mode IN ('solo','grupo')),
  group_id INTEGER,
  started_at INTEGER NOT NULL,
  ended_at INTEGER,
  duration_seconds INTEGER DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','closed','forced_closed'))
);

CREATE TABLE IF NOT EXISTS groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL,
  leader_id TEXT NOT NULL,
  leader_name TEXT NOT NULL,
  title TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  ended_at INTEGER,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','closed','forced_closed')),
  channel_id TEXT,
  message_id TEXT
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(guild_id, user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(guild_id, status);
CREATE INDEX IF NOT EXISTS idx_groups_status ON groups(guild_id, status);
`);

function now() { return Date.now(); }
function secondsBetween(a, b) { return Math.max(0, Math.floor((b - a) / 1000)); }

function activeSolo(guildId, userId) {
  return db.prepare(`SELECT * FROM sessions WHERE guild_id=? AND user_id=? AND mode='solo' AND status='active' ORDER BY id DESC LIMIT 1`).get(guildId, userId);
}

function activeGroupSession(guildId, userId, groupId = null) {
  if (groupId) {
    return db.prepare(`SELECT * FROM sessions WHERE guild_id=? AND user_id=? AND mode='grupo' AND group_id=? AND status='active' LIMIT 1`).get(guildId, userId, groupId);
  }
  return db.prepare(`SELECT * FROM sessions WHERE guild_id=? AND user_id=? AND mode='grupo' AND status='active' ORDER BY id DESC LIMIT 1`).get(guildId, userId);
}

function startSolo(guildId, userId, username) {
  if (activeSolo(guildId, userId)) return { ok: false, reason: 'Ya tienes un farmeo solo activo.' };
  if (activeGroupSession(guildId, userId)) return { ok: false, reason: 'Ya estás en un farmeo grupal activo.' };
  const info = db.prepare(`INSERT INTO sessions (guild_id,user_id,username,mode,started_at) VALUES (?,?,?,?,?)`).run(guildId, userId, username, 'solo', now());
  return { ok: true, id: info.lastInsertRowid };
}

function endSolo(guildId, userId) {
  const s = activeSolo(guildId, userId);
  if (!s) return { ok: false, reason: 'No tienes farmeo solo activo.' };
  const end = now();
  const dur = secondsBetween(s.started_at, end);
  db.prepare(`UPDATE sessions SET ended_at=?, duration_seconds=?, status='closed' WHERE id=?`).run(end, dur, s.id);
  return { ok: true, duration_seconds: dur, started_at: s.started_at, ended_at: end };
}

function createGroup(guildId, leaderId, leaderName, title, channelId) {
  if (activeSolo(guildId, leaderId) || activeGroupSession(guildId, leaderId)) {
    return { ok: false, reason: 'Ya tienes una sesión activa. Termínala antes de crear un grupo.' };
  }
  const start = now();
  const g = db.prepare(`INSERT INTO groups (guild_id,leader_id,leader_name,title,started_at,channel_id) VALUES (?,?,?,?,?,?)`).run(guildId, leaderId, leaderName, title, start, channelId);
  db.prepare(`INSERT INTO sessions (guild_id,user_id,username,mode,group_id,started_at) VALUES (?,?,?,?,?,?)`).run(guildId, leaderId, leaderName, 'grupo', g.lastInsertRowid, start);
  return { ok: true, group_id: g.lastInsertRowid };
}

function setGroupMessage(groupId, messageId) {
  db.prepare(`UPDATE groups SET message_id=? WHERE id=?`).run(messageId, groupId);
}

function getGroup(groupId) {
  return db.prepare(`SELECT * FROM groups WHERE id=?`).get(groupId);
}

function joinGroup(guildId, groupId, userId, username) {
  const g = getGroup(groupId);
  if (!g || g.guild_id !== guildId || g.status !== 'active') return { ok: false, reason: 'Ese grupo ya no está activo.' };
  if (activeSolo(guildId, userId)) return { ok: false, reason: 'Tienes un farmeo solo activo. Termínalo antes de unirte.' };
  if (activeGroupSession(guildId, userId, groupId)) return { ok: false, reason: 'Ya estás dentro de este grupo.' };
  if (activeGroupSession(guildId, userId)) return { ok: false, reason: 'Ya estás en otro farmeo grupal activo.' };
  const info = db.prepare(`INSERT INTO sessions (guild_id,user_id,username,mode,group_id,started_at) VALUES (?,?,?,?,?,?)`).run(guildId, userId, username, 'grupo', groupId, now());
  return { ok: true, id: info.lastInsertRowid };
}

function leaveGroup(guildId, groupId, userId) {
  const s = activeGroupSession(guildId, userId, groupId);
  if (!s) return { ok: false, reason: 'No estás activo en este grupo.' };
  const end = now();
  const dur = secondsBetween(s.started_at, end);
  db.prepare(`UPDATE sessions SET ended_at=?, duration_seconds=?, status='closed' WHERE id=?`).run(end, dur, s.id);
  return { ok: true, duration_seconds: dur };
}

function closeGroup(guildId, groupId, closerId, force = false) {
  const g = getGroup(groupId);
  if (!g || g.guild_id !== guildId || g.status !== 'active') return { ok: false, reason: 'Ese grupo ya está cerrado o no existe.' };
  if (!force && g.leader_id !== closerId) return { ok: false, reason: 'Solo el líder del grupo puede terminarlo.' };
  const end = now();
  const active = db.prepare(`SELECT * FROM sessions WHERE guild_id=? AND group_id=? AND mode='grupo' AND status='active'`).all(guildId, groupId);
  const update = db.prepare(`UPDATE sessions SET ended_at=?, duration_seconds=?, status=? WHERE id=?`);
  const status = force ? 'forced_closed' : 'closed';
  for (const s of active) update.run(end, secondsBetween(s.started_at, end), status, s.id);
  db.prepare(`UPDATE groups SET ended_at=?, status=? WHERE id=?`).run(end, status, groupId);
  return { ok: true, closed_count: active.length };
}

function activeStatus(guildId) {
  return {
    solo: db.prepare(`SELECT * FROM sessions WHERE guild_id=? AND mode='solo' AND status='active' ORDER BY started_at ASC`).all(guildId),
    grupos: db.prepare(`SELECT * FROM groups WHERE guild_id=? AND status='active' ORDER BY started_at ASC`).all(guildId)
  };
}

function groupParticipants(groupId, includeClosed = true) {
  const where = includeClosed ? `group_id=?` : `group_id=? AND status='active'`;
  return db.prepare(`SELECT * FROM sessions WHERE ${where} ORDER BY started_at ASC`).all(groupId);
}

function ranking(guildId, since) {
  return db.prepare(`
    SELECT user_id, username, SUM(duration_seconds) AS total_seconds, COUNT(*) AS sesiones
    FROM sessions
    WHERE guild_id=? AND status IN ('closed','forced_closed') AND started_at >= ?
    GROUP BY user_id
    ORDER BY total_seconds DESC
    LIMIT 15
  `).all(guildId, since);
}

function history(guildId, userId, limit = 10) {
  return db.prepare(`SELECT * FROM sessions WHERE guild_id=? AND user_id=? ORDER BY started_at DESC LIMIT ?`).all(guildId, userId, limit);
}

function forceCloseUser(guildId, userId) {
  const active = db.prepare(`SELECT * FROM sessions WHERE guild_id=? AND user_id=? AND status='active'`).all(guildId, userId);
  if (active.length === 0) return { ok: false, reason: 'Ese usuario no tiene sesiones activas.' };
  const end = now();
  const upd = db.prepare(`UPDATE sessions SET ended_at=?, duration_seconds=?, status='forced_closed' WHERE id=?`);
  for (const s of active) upd.run(end, secondsBetween(s.started_at, end), s.id);
  return { ok: true, closed_count: active.length };
}

module.exports = {
  startSolo, endSolo, createGroup, setGroupMessage, getGroup, joinGroup, leaveGroup, closeGroup,
  activeStatus, groupParticipants, ranking, history, forceCloseUser
};
