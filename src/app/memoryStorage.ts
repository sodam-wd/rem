import type { RemStorage } from './services';
import type { Alarm, PendingRealert, Report, Session, Settings } from './contracts';

/** Fallback when IndexedDB is unavailable (e.g. blocked private mode). Data is lost on reload. */
export function createMemoryStorage(): RemStorage {
  const alarms = new Map<string, Alarm>();
  const sessions = new Map<string, Session>();
  const reports = new Map<string, Report>();
  const pending = new Map<string, PendingRealert>();
  const meta = new Map<string, unknown>();
  let settings: Settings | null = null;
  const clone = <T,>(v: T): T => structuredClone(v);
  return {
    async listAlarms() { return [...alarms.values()].map(clone); },
    async putAlarm(a) { alarms.set(a.id, clone(a)); },
    async deleteAlarm(id) { alarms.delete(id); },
    async getSession(id) { const s = sessions.get(id); return s ? clone(s) : null; },
    async putSession(s) { sessions.set(s.id, clone(s)); },
    async listSessions() { return [...sessions.values()].map(clone); },
    async listReports() { return [...reports.values()].map(clone); },
    async putReport(r) { reports.set(r.id, clone(r)); },
    async deleteReport(id) { reports.delete(id); },
    async getSettings() { return settings ? clone(settings) : null; },
    async putSettings(s) { settings = clone(s); },
    async listPending() { return [...pending.values()].map(clone); },
    async putPending(p) { pending.set(p.id, clone(p)); },
    async deletePending(id) { pending.delete(id); },
    async getMeta<T>(key: string) { return meta.get(key) as T | undefined; },
    async setMeta(key, value) { meta.set(key, value); },
    async commit(ops) {
      if (ops.session) sessions.set(ops.session.id, clone(ops.session));
      if (ops.report) reports.set(ops.report.id, clone(ops.report));
      if (ops.alarm) alarms.set(ops.alarm.id, clone(ops.alarm));
      ops.putPending?.forEach((p) => pending.set(p.id, clone(p)));
      ops.deletePending?.forEach((id) => pending.delete(id));
    },
    async clearAll() {
      alarms.clear(); sessions.clear(); reports.clear(); pending.clear(); meta.clear(); settings = null;
    },
  };
}
