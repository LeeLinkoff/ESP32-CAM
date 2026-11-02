// Bounded, in-memory diagnostic log. Never store serial payloads, JPEGs or credentials.
export class DiagnosticsLog {
  constructor(capacity = 500, mirrorToConsole = true) {
    this.capacity = capacity;
    this.mirrorToConsole = mirrorToConsole;
    this.entries = [];
    this.nextId = 1;
  }

  write(level, source, message, details = {}) {
    const entry = {
      id: this.nextId++,
      time: new Date().toISOString(),
      level,
      source,
      message,
      details,
    };
    this.entries.push(entry);
    if (this.entries.length > this.capacity) this.entries.shift();
    if (this.mirrorToConsole && level !== 'debug') {
      const output = level === 'error' ? console.error : level === 'warn' ? console.warn : console.info;
      output(`[${entry.time}] [${level.toUpperCase()}] [${source}] ${message}`,
        Object.keys(details).length ? details : '');
    }
    return entry;
  }

  debug(source, message, details) { return this.write('debug', source, message, details); }
  info(source, message, details) { return this.write('info', source, message, details); }
  warn(source, message, details) { return this.write('warn', source, message, details); }
  error(source, message, details) { return this.write('error', source, message, details); }

  list(afterId = 0) {
    return {
      entries: this.entries.filter((entry) => entry.id > afterId),
      latestId: this.nextId - 1,
    };
  }

  clear() {
    this.entries = [];
    this.info('diagnostics', 'Log cleared by user');
  }
}
