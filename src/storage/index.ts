/**
 * IndexedDB storage. Raw IndexedDB, no dependencies.
 * DB "rem-terminal" v1 — stores: alarms(id), sessions(id), reports(id), settings(out-of-line key 'settings'),
 * pending(id), meta(out-of-line key). Every write runs in a single transaction.
 */
import type { Alarm, PendingRealert, Report, Session, Settings } from '../app/contracts';
import type { OpenStorage, RemStorage } from '../app/services';

export const DB_NAME = 'rem-terminal';
export const DB_VERSION = 1;

const S = {
  alarms: 'alarms',
  sessions: 'sessions',
  reports: 'reports',
  settings: 'settings',
  pending: 'pending',
  meta: 'meta',
} as const;
type StoreName = (typeof S)[keyof typeof S];
const ALL_STORES: StoreName[] = Object.values(S);
const SETTINGS_KEY = 'settings';

export type StorageErrorKind = 'quota' | 'unavailable' | 'unknown';

export class StorageError extends Error {
  kind: StorageErrorKind;
  constructor(kind: StorageErrorKind, message?: string, options?: { cause?: unknown }) {
    super(message ?? defaultMessage(kind));
    this.name = 'StorageError';
    this.kind = kind;
    if (options && 'cause' in options) (this as { cause?: unknown }).cause = options.cause;
  }
}

function defaultMessage(kind: StorageErrorKind): string {
  switch (kind) {
    case 'quota':
      return '기기 저장 공간이 부족하여 기록을 저장하지 못했습니다.';
    case 'unavailable':
      return '이 브라우저 환경에서는 로컬 저장소(IndexedDB)를 사용할 수 없습니다. 비공개 모드 또는 저장소 차단 여부를 확인하십시오.';
    default:
      return '로컬 저장소 처리 중 알 수 없는 오류가 발생했습니다.';
  }
}

function toStorageError(err: unknown, fallback: StorageErrorKind = 'unknown'): StorageError {
  if (err instanceof StorageError) return err;
  const name = (err as { name?: string } | null)?.name ?? '';
  if (name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED') {
    return new StorageError('quota', undefined, { cause: err });
  }
  if (name === 'SecurityError') return new StorageError('unavailable', undefined, { cause: err });
  return new StorageError(fallback, undefined, { cause: err });
}

/**
 * Migration hook. Each `if (oldVersion < N)` block upgrades from N-1 to N.
 * Add future versions below; never edit an existing block.
 */
function migrate(db: IDBDatabase, oldVersion: number, _tx: IDBTransaction | null): void {
  if (oldVersion < 1) {
    db.createObjectStore(S.alarms, { keyPath: 'id' });
    db.createObjectStore(S.sessions, { keyPath: 'id' });
    db.createObjectStore(S.reports, { keyPath: 'id' });
    db.createObjectStore(S.settings); // out-of-line key 'settings'
    db.createObjectStore(S.pending, { keyPath: 'id' });
    db.createObjectStore(S.meta); // out-of-line key
  }
  // if (oldVersion < 2) { ... }
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let idb: IDBFactory | undefined;
    try {
      idb = typeof indexedDB !== 'undefined' ? indexedDB : undefined;
    } catch {
      idb = undefined;
    }
    if (!idb) {
      reject(new StorageError('unavailable'));
      return;
    }
    let req: IDBOpenDBRequest;
    try {
      req = idb.open(DB_NAME, DB_VERSION);
    } catch (e) {
      reject(toStorageError(e, 'unavailable'));
      return;
    }
    req.onupgradeneeded = (ev) => {
      try {
        migrate(req.result, ev.oldVersion, req.transaction);
      } catch (e) {
        req.transaction?.abort();
        reject(toStorageError(e, 'unavailable'));
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      // Another tab upgraded the schema: close so it can proceed.
      db.onversionchange = () => db.close();
      resolve(db);
    };
    req.onerror = () => reject(toStorageError(req.error, 'unavailable'));
    req.onblocked = () => reject(new StorageError('unavailable', '다른 탭에서 저장소를 사용 중입니다. 다른 R.E.M. 탭을 닫고 다시 시도하십시오.'));
  });
}

function reqToPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

class IdbStorage implements RemStorage {
  constructor(private db: IDBDatabase) {}

  /** Runs `body` in one transaction; resolves with body's result after the transaction COMPLETES. */
  private run<T>(stores: StoreName[], mode: IDBTransactionMode, body: (tx: IDBTransaction) => T | Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      let tx: IDBTransaction;
      try {
        tx = this.db.transaction(stores, mode);
      } catch (e) {
        reject(toStorageError(e));
        return;
      }
      let result: T;
      let failed = false;
      tx.oncomplete = () => {
        if (!failed) resolve(result);
      };
      tx.onabort = () => {
        failed = true;
        reject(toStorageError(tx.error));
      };
      tx.onerror = (ev) => {
        // Let onabort report; prevent unhandled error bubbling noise.
        ev.preventDefault?.();
        failed = true;
        try {
          tx.abort();
        } catch {
          /* already aborting */
        }
      };
      try {
        const r = body(tx);
        if (r instanceof Promise) {
          r.then(
            (v) => {
              result = v;
            },
            (e) => {
              failed = true;
              try {
                tx.abort();
              } catch {
                /* noop */
              }
              reject(toStorageError(e));
            },
          );
        } else {
          result = r;
        }
      } catch (e) {
        failed = true;
        try {
          tx.abort();
        } catch {
          /* noop */
        }
        reject(toStorageError(e));
      }
    });
  }

  private getAll<T>(store: StoreName): Promise<T[]> {
    return this.run([store], 'readonly', (tx) => reqToPromise(tx.objectStore(store).getAll() as IDBRequest<T[]>));
  }

  private getOne<T>(store: StoreName, key: IDBValidKey): Promise<T | undefined> {
    return this.run([store], 'readonly', (tx) => reqToPromise(tx.objectStore(store).get(key) as IDBRequest<T | undefined>));
  }

  private putOne(store: StoreName, value: unknown, key?: IDBValidKey): Promise<void> {
    return this.run([store], 'readwrite', (tx) => {
      tx.objectStore(store).put(value, key);
    });
  }

  private deleteOne(store: StoreName, key: IDBValidKey): Promise<void> {
    return this.run([store], 'readwrite', (tx) => {
      tx.objectStore(store).delete(key);
    });
  }

  async listAlarms(): Promise<Alarm[]> {
    const list = await this.getAll<Alarm>(S.alarms);
    return list.sort((a, b) => a.createdAt - b.createdAt);
  }
  putAlarm(a: Alarm): Promise<void> {
    return this.putOne(S.alarms, a);
  }
  deleteAlarm(id: string): Promise<void> {
    return this.deleteOne(S.alarms, id);
  }

  async getSession(id: string): Promise<Session | null> {
    return (await this.getOne<Session>(S.sessions, id)) ?? null;
  }
  putSession(s: Session): Promise<void> {
    return this.putOne(S.sessions, s);
  }
  async listSessions(): Promise<Session[]> {
    const list = await this.getAll<Session>(S.sessions);
    return list.sort((a, b) => b.startedAt - a.startedAt);
  }

  async listReports(): Promise<Report[]> {
    const list = await this.getAll<Report>(S.reports);
    return list.sort((a, b) => b.createdAt - a.createdAt);
  }
  putReport(r: Report): Promise<void> {
    return this.putOne(S.reports, r);
  }
  deleteReport(id: string): Promise<void> {
    return this.deleteOne(S.reports, id);
  }

  async getSettings(): Promise<Settings | null> {
    return (await this.getOne<Settings>(S.settings, SETTINGS_KEY)) ?? null;
  }
  putSettings(s: Settings): Promise<void> {
    return this.putOne(S.settings, s, SETTINGS_KEY);
  }

  async listPending(): Promise<PendingRealert[]> {
    const list = await this.getAll<PendingRealert>(S.pending);
    return list.sort((a, b) => a.at - b.at);
  }
  putPending(p: PendingRealert): Promise<void> {
    return this.putOne(S.pending, p);
  }
  deletePending(id: string): Promise<void> {
    return this.deleteOne(S.pending, id);
  }

  getMeta<T = unknown>(key: string): Promise<T | undefined> {
    return this.getOne<T>(S.meta, key);
  }
  setMeta(key: string, value: unknown): Promise<void> {
    return this.putOne(S.meta, value, key);
  }

  commit(ops: {
    session?: Session;
    report?: Report;
    putPending?: PendingRealert[];
    deletePending?: string[];
    alarm?: Alarm;
  }): Promise<void> {
    return this.run([S.sessions, S.reports, S.pending, S.alarms], 'readwrite', (tx) => {
      if (ops.session) tx.objectStore(S.sessions).put(ops.session);
      if (ops.report) tx.objectStore(S.reports).put(ops.report);
      if (ops.alarm) tx.objectStore(S.alarms).put(ops.alarm);
      const pending = tx.objectStore(S.pending);
      for (const id of ops.deletePending ?? []) pending.delete(id);
      for (const p of ops.putPending ?? []) pending.put(p);
    });
  }

  clearAll(): Promise<void> {
    return this.run(ALL_STORES, 'readwrite', (tx) => {
      for (const name of ALL_STORES) tx.objectStore(name).clear();
    });
  }
}

export const openStorage: OpenStorage = async () => {
  const db = await openDb();
  return new IdbStorage(db);
};
