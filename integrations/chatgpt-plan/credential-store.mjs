/**
 * @file integrations/chatgpt-plan/credential-store.mjs
 * 本机助手的受保护凭证文件：独占进程锁、拒绝符号链接、原子写入和 Unix 0600 权限。
 * OpenAI 凭证只留在助手目录，不进入扩展、日志或仓库；文件格式由本机运行时管理。
 */
import { constants } from 'node:fs';
import { chmod, lstat, mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

export async function openCredentialStore(directory) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const directoryStat = await lstat(directory);
  if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) throw new Error('UNSAFE_STORAGE_DIRECTORY');
  await chmod(directory, 0o700);
  const path = join(directory, 'credentials.json');
  const lockPath = join(directory, 'bridge.lock');
  let lock;
  try {
    lock = await open(lockPath, 'wx', 0o600);
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    // 串行回收已退出进程的锁，避免两个启动者先读到旧 PID 后删除彼此的新锁。
    const recoveryPath = join(directory, 'bridge-recovery.lock');
    let recovery;
    try { recovery = await open(recoveryPath, 'wx', 0o600); }
    catch (recoveryError) { if (recoveryError.code === 'EEXIST') throw new Error('BRIDGE_ALREADY_RUNNING'); throw recoveryError; }
    try {
      try {
        const stat = await lstat(lockPath);
        if (stat.isSymbolicLink() || !stat.isFile()) throw new Error('UNSAFE_STORAGE_LOCK');
        const pid = Number(await readFile(lockPath, 'utf8'));
        if (!Number.isSafeInteger(pid) || pid < 1) throw new Error('INVALID_STORAGE_LOCK');
        try { process.kill(pid, 0); throw new Error('BRIDGE_ALREADY_RUNNING'); }
        catch (checkError) { if (checkError.code !== 'ESRCH') throw checkError; }
        await unlink(lockPath);
      } catch (missingError) { if (missingError.code !== 'ENOENT') throw missingError; }
      lock = await open(lockPath, 'wx', 0o600);
    } finally { await recovery.close(); await unlink(recoveryPath); }
  }
  await lock.writeFile(String(process.pid));
  let queue = Promise.resolve();
  let closed = false;
  async function read() {
    try {
      const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
      try {
        const stat = await handle.stat();
        if (!stat.isFile() || (process.platform !== 'win32' && (stat.mode & 0o777) !== 0o600)) throw new Error('UNSAFE_CREDENTIAL_PERMISSIONS');
        return JSON.parse(await handle.readFile('utf8'));
      } finally { await handle.close(); }
    } catch (error) { if (error.code === 'ENOENT') return undefined; throw error; }
  }
  function write(value) {
    if (closed) return Promise.reject(new Error('STORAGE_CLOSED'));
    const serialized = JSON.stringify(value);
    const operation = queue.then(async () => {
      const temporaryPath = join(directory, `.credentials-${randomUUID()}.tmp`);
      try {
        const handle = await open(temporaryPath, 'wx', 0o600);
        try { await handle.writeFile(serialized); await handle.sync(); }
        finally { await handle.close(); }
        await rename(temporaryPath, path);
      } finally { await unlink(temporaryPath).catch(() => {}); }
    });
    queue = operation.catch(() => {});
    return operation;
  }
  async function close() {
    closed = true;
    await queue;
    await lock.close();
    await unlink(lockPath);
  }
  return { read, write, close, path };
}
