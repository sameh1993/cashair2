const session = require('express-session');
const db = require('./db');

class MySqlSessionStore extends session.Store {
  constructor() {
    super();
    this.ready = this.ensureTable();
  }

  async ensureTable() {
    await db.query(`
      CREATE TABLE IF NOT EXISTS sessions (
        sid VARCHAR(128) PRIMARY KEY,
        sess LONGTEXT NOT NULL,
        expires BIGINT NOT NULL,
        INDEX idx_sessions_expires (expires)
      )
    `);
  }

  async get(sid, callback) {
    try {
      await this.ready;
      const [rows] = await db.query(
        'SELECT sess, expires FROM sessions WHERE sid = ? LIMIT 1',
        [sid]
      );

      if (!rows.length) return callback(null, null);

      const row = rows[0];
      if (Number(row.expires) <= Date.now()) {
        await this.destroy(sid, () => { });
        return callback(null, null);
      }

      const sess = typeof row.sess === 'string' ? JSON.parse(row.sess) : row.sess;
      callback(null, sess);
    } catch (error) {
      callback(error);
    }
  }

  async set(sid, sess, callback) {
    try {
      await this.ready;
      const expires = this.getExpires(sess);
      await db.query(
        `INSERT INTO sessions (sid, sess, expires)
         VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE sess = VALUES(sess), expires = VALUES(expires)`,
        [sid, JSON.stringify(sess), expires]
      );
      callback(null);
    } catch (error) {
      callback(error);
    }
  }

  async destroy(sid, callback) {
    try {
      await this.ready;
      await db.query('DELETE FROM sessions WHERE sid = ?', [sid]);
      callback(null);
    } catch (error) {
      callback(error);
    }
  }

  async touch(sid, sess, callback) {
    try {
      await this.ready;
      const expires = this.getExpires(sess);
      await db.query('UPDATE sessions SET expires = ? WHERE sid = ?', [expires, sid]);
      callback(null);
    } catch (error) {
      callback(error);
    }
  }

  getExpires(sess) {
    const expires = sess?.cookie?.expires;
    if (expires) return new Date(expires).getTime();

    const maxAge = Number(sess?.cookie?.originalMaxAge) || 8 * 60 * 60 * 1000;
    return Date.now() + maxAge;
  }
}

const bcrypt = require('bcryptjs');

exports.getResolve = async () => {
  bcrypt.hash("333", 10, async function (err, hash) {
    // console.log(hash)
    const user = await db.query(`INSERT IGNORE INTO users (username, password, full_name, role)
                VALUES ('admin', ${hash}, 'المدير', 'admin')`)

    if (!user) throw err
    else return user
  });
}

module.exports = MySqlSessionStore;
