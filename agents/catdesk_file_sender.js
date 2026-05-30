/**
 * CatDesk 文件直发脚本 v1
 * 
 * 功能：轮询 GitHub 队列文件，把方案文件通过大象发给提交者
 * 运行环境：CatDesk（本地 Windows，有内网 + 大象登录态）
 * 
 * 使用方法：
 *   node catdesk_file_sender.js          # 手动跑一次
 *   node catdesk_file_sender.js --watch  # 持续监听（每60秒一次）
 * 
 * 依赖：
 *   - GH_TOKEN 环境变量（GitHub Personal Access Token）
 *   - 大象 CatDesk 客户端已登录
 */

import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';

const GH_TOKEN = process.env.GH_TOKEN || '';
const GH_REPO = 'maoliang-mt/maoliang-crm';
const QUEUE_FILE_PATH = 'crm/file_send_queue.json';
const POLL_INTERVAL_MS = 60 * 1000; // 60秒轮询一次
const TEMP_DIR = process.env.TEMP || '/tmp';

// ── GitHub 操作 ──────────────────────────────────────────────────────

async function readQueue() {
  const headers = {
    'Authorization': `token ${GH_TOKEN}`,
    'Accept': 'application/vnd.github.v3+json',
    'User-Agent': 'catdesk-file-sender'
  };
  const res = await fetch(`https://api.github.com/repos/${GH_REPO}/contents/${QUEUE_FILE_PATH}`, { headers });
  if (!res.ok) throw new Error(`读取队列失败: ${res.status}`);
  const data = await res.json();
  const content = JSON.parse(Buffer.from(data.content, 'base64').toString('utf8'));
  return { queue: content, sha: data.sha };
}

async function writeQueue(queue, sha, commitMsg) {
  const headers = {
    'Authorization': `token ${GH_TOKEN}`,
    'Accept': 'application/vnd.github.v3+json',
    'User-Agent': 'catdesk-file-sender',
    'Content-Type': 'application/json'
  };
  const res = await fetch(`https://api.github.com/repos/${GH_REPO}/contents/${QUEUE_FILE_PATH}`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({
      message: commitMsg,
      content: Buffer.from(JSON.stringify(queue, null, 2)).toString('base64'),
      sha
    })
  });
  if (!res.ok) throw new Error(`写入队列失败: ${res.status} ${await res.text()}`);
  return await res.json();
}

// ── 文件下载 ─────────────────────────────────────────────────────────

async function downloadFile(url, destPath) {
  // 优先用 CatDesk 内置浏览器下载（内网地址需要）
  // 如果是 raw.githubusercontent.com 可以直接 fetch
  if (url.includes('raw.githubusercontent.com') || url.includes('maoliang-mt.github.io')) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`下载失败 ${res.status}: ${url}`);
    const buf = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(destPath, buf);
    return destPath;
  }

  // 内网地址：用 curl（CatDesk 内网环境可以访问）
  const r = spawnSync('curl', ['-sL', '-o', destPath, url], {
    encoding: 'utf8',
    timeout: 60000
  });
  if (r.status !== 0 || !fs.existsSync(destPath)) {
    throw new Error(`curl 下载失败: ${r.stderr?.slice(0, 200)}`);
  }
  return destPath;
}

// ── MIS → UID 映射（用于大象发送）───────────────────────────────────

// 从 mis_uid_map.json 读取（优先），否则调接口查
let MIS_UID_MAP = {};
try {
  const mapPath = new URL('./mis_uid_map.json', import.meta.url).pathname;
  MIS_UID_MAP = JSON.parse(fs.readFileSync(mapPath, 'utf8'));
} catch { /* 不存在时为空 */ }

async function getUidByMis(mis) {
  // 1. 查静态映射表
  if (MIS_UID_MAP[mis]) return String(MIS_UID_MAP[mis]);

  // 2. 调大象接口查
  try {
    const tokenRes = await fetch('https://ssosv.sankuai.com/sson/auth/oidc/v1/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: 'aed2320a23',
        client_secret: '4294bffbd10b41c3a1057501794077e4',
        scope: 'client_id:xm-xai'
      })
    });
    const { access_token } = await tokenRes.json();
    const queryRes = await fetch('https://xopen.sankuai.com/open-apis/dx/queryEmpIdentityByMisList', {
      method: 'POST',
      headers: { 'Authorization': access_token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ misList: [mis] })
    });
    const data = await queryRes.json();
    const uid = data?.data?.data?.[mis]?.empId;
    if (uid) return String(uid);
  } catch (e) {
    console.log(`[UID查询] ${mis} 查询失败: ${e.message}`);
  }
  return null;
}

// ── 大象文件发送（通过 catdesk CLI）─────────────────────────────────

async function sendFileToDaxiang(uid, filePath, message) {
  // catdesk daxiang send --uid <uid> --file <path> --message <text>
  // 具体命令格式以 CatDesk 实际 CLI 为准
  const r = spawnSync('catdesk', [
    'daxiang', 'send',
    '--uid', uid,
    '--file', filePath,
    '--message', message
  ], {
    encoding: 'utf8',
    timeout: 30000
  });

  if (r.status === 0) {
    console.log(`✅ 文件发送成功 → uid=${uid} file=${path.basename(filePath)}`);
    return true;
  }

  // 如果 catdesk CLI 不支持文件发送，降级用 openclaw message send
  console.log(`catdesk 发送失败，降级到 openclaw message...`);
  const r2 = spawnSync('openclaw', [
    'message', 'send',
    '--channel', 'daxiang',
    '--to', `user:${uid}`,
    '--media', filePath,
    '--message', message
  ], {
    encoding: 'utf8',
    timeout: 30000
  });

  if (r2.status === 0) {
    console.log(`✅ 文件发送成功（openclaw）→ uid=${uid}`);
    return true;
  }

  throw new Error(`文件发送失败: ${(r2.stderr || r.stderr || '').slice(0, 200)}`);
}

// ── 处理单个任务 ─────────────────────────────────────────────────────

async function processTask(task) {
  console.log(`\n[任务 ${task.id}] 处理中: ${task.shopName} (${task.fileType})`);
  console.log(`  MIS: ${task.mis}`);
  console.log(`  文件: ${task.fileUrl}`);

  // 1. 查 UID
  const uid = await getUidByMis(task.mis);
  if (!uid) {
    throw new Error(`无法解析 UID: mis=${task.mis}`);
  }

  // 2. 下载文件到临时目录
  const tempFile = path.join(TEMP_DIR, task.fileName || `plan_${task.planId}.${task.fileType || 'html'}`);
  await downloadFile(task.fileUrl, tempFile);
  console.log(`  已下载: ${tempFile} (${fs.statSync(tempFile).size} bytes)`);

  // 3. 发大象文件消息
  const message = `📋 您的「${task.shopName}」运营方案已生成，请查收附件～`;
  await sendFileToDaxiang(uid, tempFile, message);

  // 4. 清理临时文件
  try { fs.unlinkSync(tempFile); } catch (e) {}

  console.log(`  ✅ 完成`);
}

// ── 主循环 ────────────────────────────────────────────────────────────

async function runOnce() {
  console.log(`\n[${new Date().toLocaleString('zh-CN')}] 检查文件发送队列...`);

  const { queue, sha } = await readQueue();
  const pending = queue.filter(t => t.status === 'pending');

  if (pending.length === 0) {
    console.log('  队列为空，无待处理任务');
    return;
  }

  console.log(`  发现 ${pending.length} 个待处理任务`);
  let updated = false;

  for (const task of pending) {
    try {
      await processTask(task);
      // 标记成功
      const idx = queue.findIndex(t => t.id === task.id);
      if (idx >= 0) {
        queue[idx].status = 'sent';
        queue[idx].sentAt = new Date().toISOString();
        updated = true;
      }
    } catch (e) {
      console.error(`  ❌ 任务 ${task.id} 失败: ${e.message}`);
      const idx = queue.findIndex(t => t.id === task.id);
      if (idx >= 0) {
        queue[idx].status = 'failed';
        queue[idx].error = e.message;
        queue[idx].sentAt = new Date().toISOString();
        updated = true;
      }
    }
  }

  // 写回队列（保留最近100条，清理旧记录）
  if (updated) {
    const kept = queue.slice(-100); // 只保留最近100条
    // 重新读 sha（可能有并发写）
    let latestSha = sha;
    try {
      const latest = await readQueue();
      latestSha = latest.sha;
    } catch (e) { /* 用原 sha */ }

    await writeQueue(kept, latestSha, `[catdesk] 处理文件发送队列 ${new Date().toISOString()}`);
    console.log(`  队列已更新`);
  }
}

async function main() {
  const watchMode = process.argv.includes('--watch');

  if (!GH_TOKEN) {
    console.error('错误：请设置 GH_TOKEN 环境变量');
    process.exit(1);
  }

  if (watchMode) {
    console.log(`🔄 监听模式启动，每 ${POLL_INTERVAL_MS / 1000} 秒检查一次`);
    // 立即跑一次
    await runOnce().catch(e => console.error('运行失败:', e.message));
    // 然后定时
    setInterval(async () => {
      await runOnce().catch(e => console.error('运行失败:', e.message));
    }, POLL_INTERVAL_MS);
  } else {
    await runOnce();
    console.log('\n完成。');
  }
}

main().catch(e => {
  console.error('脚本异常:', e.message);
  process.exit(1);
});
